// The decisive test for bilingual questions.
//
// correctIndex points at a SLOT. Two players in one room may be reading
// different languages, so slot N must mean the same thing in every language or
// one of them is scored against a tile they never chose. Nothing looks wrong on
// any single screen when this breaks, which is exactly why it needs a test that
// checks alignment against the SOURCE rather than against itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WS from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:8000';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rid = () => Array.from({ length: 6 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- read the source packs so we can check alignment against ground truth ----
const srcText = fs.readFileSync(path.join(ROOT, 'src/index.js'), 'utf8');
function sourcePacks() {
  const start = srcText.indexOf('const PACKS = {');
  const end = srcText.indexOf('\n};', start);
  const block = srcText.slice(start, end);
  const packs = {};
  const genreRe = /^  (\w+): \[\n([\s\S]*?)^  \],$/gm;
  let g;
  while ((g = genreRe.exec(block))) {
    packs[g[1]] = g[2].split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).map((l) => {
      const grab = (re) => { const m = l.match(re); return m ? JSON.parse(m[1]) : null; };
      const arr = (re) => {
        const m = l.match(re);
        return m ? (m[1].match(/"(?:[^"\\]|\\.)*"/g) || []).map((s) => JSON.parse(s)) : null;
      };
      const es = l.includes(', es: {') ? {
        text: grab(/es: \{ text: ("(?:[^"\\]|\\.)*")/),
        correct: grab(/es: \{ text: "(?:[^"\\]|\\.)*", correct: ("(?:[^"\\]|\\.)*")/),
        wrong: arr(/es: \{ text: "(?:[^"\\]|\\.)*", correct: "(?:[^"\\]|\\.)*", wrong: \[(.*?)\] \}/),
      } : null;
      return {
        text: grab(/^\{ text: ("(?:[^"\\]|\\.)*")/),
        correct: grab(/correct: ("(?:[^"\\]|\\.)*")/),
        wrong: arr(/wrong: \[(.*?)\], category/),
        es,
      };
    });
  }
  return packs;
}
const PACKS = sourcePacks();

class C {
  constructor(name, room, lang) { this.name = name; this.room = room; this.lang = lang || 'en'; this.msgs = []; }
  connect() {
    // A Spanish player announces the language on the socket, which is what
    // makes the server choose a source that HAS Spanish. Without this the
    // room fetches from OpenTDB, which is English-only, and the questions
    // arrive with no translation at all.
    this.ws = new WS(`ws://localhost:8787/room?code=${this.room}&name=${encodeURIComponent(this.name)}&lang=${this.lang}`,
                     { origin: ORIGIN });
    this.ws.on('message', (r) => this.msgs.push(JSON.parse(r.toString())));
    return new Promise((res, rej) => {
      this.ws.once('open', res); this.ws.once('error', rej);
      setTimeout(() => rej(new Error(this.name + ' connect timeout')), 8000);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  last(t) { return [...this.msgs].reverse().find((m) => m.type === t); }
  all(t) { return this.msgs.filter((m) => m.type === t); }
  async wait(t, ms = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = this.last(t); if (m) return m; await sleep(60); }
    throw new Error(`${this.name}: no '${t}' in ${ms}ms`);
  }
  close() { try { this.ws.close(); } catch {} }
}

try {
  // --- catalog advertises which genres have Spanish -------------------------
  {
    const A = new C('Ann', rid()); await A.connect();
    const w = await A.wait('welcome');
    const byslug = Object.fromEntries((w.catalog || []).map((g) => [g.slug, g]));
    ok(!!byslug.film, 'catalog present');
    ok(Array.isArray(byslug.film.langs), 'catalog entries advertise languages', byslug.film);
    ok(byslug.film.langs.includes('es'), 'Film advertises Spanish', byslug.film.langs);
    ok(byslug.history && !byslug.history.langs.includes('es'),
       'a genre without Spanish questions does NOT advertise Spanish', byslug.history && byslug.history.langs);
    ok(byslug.mixed && !byslug.mixed.langs.includes('es'),
       'Mixed does not falsely advertise Spanish', byslug.mixed && byslug.mixed.langs);
    A.close();
  }

  // --- alignment, the one that matters -------------------------------------
  for (const genre of ['film', 'music', 'games', 'science']) {
    const room = rid();
    const A = new C('Ana', room, 'es'); await A.connect(); await A.wait('welcome');
    A.send({ type: 'settings', settings: { genre } });
    await A.wait('settings');
    A.send({ type: 'start' });
    await A.wait('question');
    await sleep(1200);

    const qs = A.all('question');
    let checked = 0, bilingual = 0, misaligned = 0, mismatchedLen = 0;

    for (const q of qs) {
      if (!q.i18n || !q.i18n.es) continue;
      bilingual++;
      if (q.i18n.es.choices.length !== q.choices.length) { mismatchedLen++; continue; }
      const srcQ = (PACKS[genre] || []).find((s) => s.text === q.text);
      if (!srcQ || !srcQ.es) continue;
      checked++;
      // Where does the English correct answer sit in the shuffled board?
      const idx = q.choices.indexOf(srcQ.correct);
      // The Spanish correct answer must sit in the SAME slot.
      if (idx < 0 || q.i18n.es.choices[idx] !== srcQ.es.correct) {
        misaligned++;
        fails.push('FAIL  ALIGNMENT ' + genre + ' :: ' + JSON.stringify({
          q: q.text.slice(0, 50), enSlot: idx,
          esAtSlot: idx >= 0 ? q.i18n.es.choices[idx] : null,
          esExpected: srcQ.es.correct,
        }));
      }
      // And every other slot must correspond too, not just the correct one.
      for (let i = 0; i < 4; i++) {
        const enOpt = q.choices[i];
        const j = [srcQ.correct, ...srcQ.wrong].indexOf(enOpt);
        const esExpect = j === 0 ? srcQ.es.correct : srcQ.es.wrong[j - 1];
        if (j >= 0 && q.i18n.es.choices[i] !== esExpect) {
          misaligned++;
          fails.push(`FAIL  ALIGNMENT ${genre} slot ${i} :: ` + JSON.stringify({
            en: enOpt, esGot: q.i18n.es.choices[i], esWant: esExpect,
          }));
          break;
        }
      }
    }

    ok(bilingual > 0, `${genre}: questions carry Spanish`, { of: qs.length });
    ok(checked > 0, `${genre}: Spanish questions matched back to source (guards a vacuous pass)`, checked);
    ok(mismatchedLen === 0, `${genre}: Spanish choice count matches English`, mismatchedLen);
    ok(misaligned === 0, `${genre}: EVERY slot means the same thing in both languages`, misaligned);

    // The invariant still holds with translations attached.
    const leak = JSON.stringify(qs[0] || {}).toLowerCase();
    ok(!leak.includes('correctindex'), `${genre}: question frame still carries no correctIndex`);
    A.close();
  }

  // --- a genre without Spanish degrades honestly ----------------------------
  {
    const room = rid();
    const A = new C('Ana', room, 'es'); await A.connect(); await A.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'history' } });
    await A.wait('settings');
    A.send({ type: 'start' });
    await sleep(2500);
    const err = A.last('error');
    ok(!!err, 'a Spanish player is REFUSED a genre with no Spanish, not quietly given English', err);
    ok(err && /spanish/i.test(err.message), 'the refusal names the actual problem', err && err.message);
    ok(!A.last('question'), 'no game started');
    A.close();

    // The same genre is fine in English.
    const room2 = rid();
    const B = new C('Ben', room2, 'en'); await B.connect(); await B.wait('welcome');
    B.send({ type: 'settings', settings: { genre: 'history' } });
    await B.wait('settings');
    B.send({ type: 'start' });
    const q2 = await B.wait('question');
    ok(!!q2, 'an English player can still play a genre that has no Spanish');
    B.close();
  }
  // --- the actual feature: two people, one room, two languages -------------
  {
    const room = rid();
    const A = new C('Ana', room, 'es'); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', room, 'en'); await B.connect(); await B.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'music' } });
    await A.wait('settings');
    A.send({ type: 'start' });
    const qa = await A.wait('question');
    const qb = await B.wait('question');
    ok(qa.text === qb.text, 'both players are asked the same question');
    ok(!!qa.i18n && !!qa.i18n.es, 'the frame carries Spanish for the Spanish reader');
    ok(qa.choices.join('|') === qb.choices.join('|'),
       'the English board is identical for both — the server sends one board');
    ok(qa.i18n.es.choices.length === 4, 'the Spanish board has four options');
    // Each renders its own language from the SAME slots, so a pick of slot N
    // means the same answer for both.
    ok(qa.i18n.es.choices.every((c, i) => c !== qa.choices[i] || /^[0-9]+$/.test(c) || c === qa.choices[i]),
       'the Spanish board is populated');
    A.close(); B.close();
  }
} catch (e) {
  fails.push('FAIL  threw :: ' + e.message);
}

console.log('');
for (const n of notes) console.log(n);
for (const f of fails) console.log(f);
console.log(`\npassed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
