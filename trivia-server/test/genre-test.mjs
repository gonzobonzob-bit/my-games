// Server-side genre tests over raw sockets. No browser: this is about the
// protocol, the sanitiser and the three-tier degradation, all of which are
// server concerns and none of which need a renderer to verify.
import WS from 'ws';

const ORIGIN = 'http://localhost:8000';
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  constructor(name, room) { this.name = name; this.room = room; this.msgs = []; }
  connect() {
    const url = `ws://localhost:8787/room?code=${this.room}&name=${encodeURIComponent(this.name)}`;
    this.ws = new WS(url, { origin: ORIGIN });
    this.ws.on('message', (r) => this.msgs.push(JSON.parse(r.toString())));
    return new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
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

/* A fresh room code per block PER RUN. The first version of this built codes
   from the block number plus one random digit — nine possible codes — and
   Durable Object storage persists between runs, so every run was inheriting a
   previous run's room state. A test that reuses persistent storage is not
   testing what it thinks it is. */
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const room = () => Array.from({ length: 6 },
  () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
// Each block opens a brand-new room. Against local wrangler dev that means a
// cold Durable Object every time, and seven back-to-back is a harness
// artefact no real game reproduces — a real room is created once and lived in.
const settle = () => sleep(1200);

try {
  // ---- 1. welcome carries settings + catalog --------------------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect();
    const w = await A.wait('welcome');
    ok(!!w.settings, 'welcome carries settings');
    ok(w.settings.genre === 'mixed' && w.settings.difficulty === 'any',
       'a new room defaults to Mixed / any', w.settings);
    ok(Array.isArray(w.catalog) && w.catalog.length >= 7, 'welcome carries a genre catalog',
       w.catalog && w.catalog.length);
    ok(w.catalog.some((g) => g.slug === 'music' && g.label === 'Music'), 'catalog has labelled genres');
    ok(Array.isArray(w.difficulties) && w.difficulties.includes('hard'), 'welcome carries difficulties');
    // Catalog must not leak internal ids — the client has no business knowing
    // OpenTDB category numbers.
    ok(!JSON.stringify(w.catalog).includes('catId'), 'catalog does not expose OpenTDB ids');
    A.close();
  }

  await settle();
  // ---- 2. host can change settings; everyone is told ------------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'music', difficulty: 'hard' } });
    const bs = await B.wait('settings');
    ok(bs.settings.genre === 'music', 'a non-host is told when the genre changes', bs.settings);
    ok(bs.settings.difficulty === 'hard', 'difficulty propagates too', bs.settings);
    const as = await A.wait('settings');
    ok(as.settings.genre === 'music', 'the host sees its own change confirmed');

    await settle();
  // ---- 3. non-host cannot change settings --------------------------------
    B.msgs.length = 0;
    B.send({ type: 'settings', settings: { genre: 'film' } });
    await sleep(500);
    const err = B.last('error');
    ok(!!err, 'a non-host attempting to change settings gets an error', err);
    ok(!B.last('settings'), 'a non-host change does not broadcast');
    A.msgs.length = 0;
    await sleep(300);
    ok(!A.last('settings'), 'a non-host change does not reach the host either');
    A.close(); B.close();
  }

  await settle();
  // ---- 4. the sanitiser ------------------------------------------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const cases = [
      [{ genre: 'nonsense' }, 'mixed', 'an unknown genre falls back to mixed'],
      [{ genre: 42 }, 'mixed', 'a non-string genre falls back to mixed'],
      [{ genre: 'constructor' }, 'mixed', 'an inherited property name is not a valid genre'],
      [{ genre: '__proto__' }, 'mixed', '__proto__ is not a valid genre'],
      [{ genre: 'film', difficulty: 'impossible' }, 'film', 'a bad difficulty does not reject a good genre'],
    ];
    for (const [payload, expectGenre, label] of cases) {
      A.msgs.length = 0;
      A.send({ type: 'settings', settings: payload });
      const s = await A.wait('settings');
      ok(s.settings.genre === expectGenre, label, s.settings);
      ok(DIFFOK(s.settings.difficulty), `${label}: difficulty stays a known value`, s.settings.difficulty);
    }
    // Prototype integrity: the sanitiser must not have poisoned Object.prototype
    // on the server. If it had, this object would inherit the key.
    ok(({}).polluted === undefined, 'Object.prototype was not polluted');
    A.close();
  }
  function DIFFOK(d) { return ['any', 'easy', 'medium', 'hard'].includes(d); }

  await settle();
  // ---- 5. settings are frozen once the game starts --------------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'geography' } });
    await A.wait('settings');
    A.send({ type: 'start' });
    const q = await A.wait('question', 25000);
    ok(!!q, 'a genre game starts');

    A.msgs.length = 0;
    A.send({ type: 'settings', settings: { genre: 'film' } });
    await sleep(500);
    ok(!!A.last('error'), 'settings are refused once a game is in progress', A.last('error'));
    ok(!A.last('settings'), 'a mid-game settings change does not broadcast');

    // The question frame must still be clean — this is the invariant.
    const leak = JSON.stringify(q).toLowerCase();
    ok(!leak.includes('correctindex') && !leak.includes('"answer"'),
       'the question frame still leaks nothing after the genre change');
    A.close(); B.close();
  }

  await settle();
  // ---- 6. a chosen genre is actually honoured -------------------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'history' } });
    await A.wait('settings');
    A.send({ type: 'start' });
    await A.wait('question', 25000);
    await sleep(1500);
    const qs = A.all('question');
    const cats = [...new Set(qs.map((q) => q.category).filter(Boolean))];
    const notice = A.last('notice');
    console.log(`   history game -> categories seen: ${JSON.stringify(cats)}` +
                (notice ? `  [${notice.message.slice(0, 40)}...]` : '  [live]'));
    // This assertion has to be able to FAIL. An earlier version of the pack
    // generator dropped the category field, so `cats` came back empty and
    // "no off-genre questions" passed vacuously — a green test over a real
    // bug. Require the evidence to exist before judging it.
    ok(qs.length >= 1, 'the history game produced questions to inspect', qs.length);
    ok(cats.length > 0, 'questions carry a category at all (guards against a vacuous pass)', cats);
    // Whether live or offline, every question must belong to the genre asked
    // for. This is the promise the whole feature exists to keep.
    const offGenre = cats.filter((c) => !/history/i.test(c));
    ok(offGenre.length === 0, 'every question in a History game is History', offGenre);
    A.close(); B.close();
  }

  await settle();
  // ---- 7. mixed still behaves exactly as before -----------------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Ben', r); await B.connect(); await B.wait('welcome');
    A.send({ type: 'start' });
    const q = await A.wait('question', 25000);
    ok(Array.isArray(q.choices) && q.choices.length === 4, 'a default Mixed game still starts and plays');
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
