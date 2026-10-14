// Drives the actual quiz-editor DOM (not the wire protocol — teams-test.mjs
// already covers that) to catch bugs that only exist in the authoring UI
// itself. Found this way once already: buildQuizRow()'s four choice-input
// listeners all closed over the shared `var choiceInput` instead of the
// specific element each was attached to, so by the time any 'input' event
// fired, every handler read whichever choice field was created LAST —
// typing into choices 1-3 silently wrote into the wrong slot (or nowhere),
// and only the 4th field's value ever reliably saved. No wire-protocol test
// could ever see this; it lived entirely in the DOM wiring.
import WS from 'ws';

const CDP = process.env.LS_CDP || 'http://127.0.0.1:9222';
const PAGE = process.env.LS_PAGE || 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || ('QE' + Math.floor(Math.random() * 90 + 10));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

class Tab {
  constructor(n) { this.name = n; this.id = 0; this.pending = new Map(); }
  async open() {
    const r = await fetch(CDP + '/json/new?about:blank', { method: 'PUT' });
    const t = await r.json(); this.target = t;
    this.ws = new WS(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    });
    await this.cmd('Runtime.enable'); await this.cmd('Page.enable');
  }
  cmd(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(this.name + ' timeout ' + method)), 40000);
      this.pending.set(id, (m) => { clearTimeout(to); m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m.result); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(body) {
    const r = await this.cmd('Runtime.evaluate', { expression: `(function(){${body}})()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  async close() { try { await fetch(CDP + '/json/close/' + this.target.id); } catch {} }
}

try {
  const A = new Tab('A');
  await A.open();
  await A.cmd('Page.navigate', { url: PAGE });
  await sleep(1300);
  await A.ev("try{localStorage.clear()}catch(e){} return true;");
  await A.cmd('Page.reload');
  await sleep(900);
  await A.ev(`
    document.getElementById('nameInput').value = 'Ada';
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click(); return true;`);
  await sleep(1200);

  await A.ev("document.getElementById('modeSlot').click(); return true;");
  await sleep(300);
  await A.ev("document.getElementById('sourceSlot').click(); return true;");
  await sleep(300);

  // Add TWO questions so a bug that only corrupts "whichever row/field was
  // built last" can't hide behind a single-row test.
  await A.ev("document.getElementById('quizAddBtn').click(); return true;");
  await A.ev("document.getElementById('quizAddBtn').click(); return true;");
  await sleep(200);

  const fillResult = await A.ev(`
    var rows = document.querySelectorAll('.quiz-row');
    if (rows.length !== 2) return 'expected 2 rows, got ' + rows.length;
    var data = [
      { text: 'What color is the sky?', choices: ['Blue','Green','Red','Purple'], correct: 0 },
      { text: 'What is 2+2?', choices: ['3','4','5','6'], correct: 1 },
    ];
    for (var r = 0; r < 2; r++) {
      var row = rows[r];
      var textInput = row.querySelector('input[type=text]');
      textInput.value = data[r].text;
      textInput.dispatchEvent(new Event('input', { bubbles: true }));
      var choiceInputs = row.querySelectorAll('.quiz-choice input[type=text]');
      for (var c = 0; c < 4; c++) {
        choiceInputs[c].value = data[r].choices[c];
        choiceInputs[c].dispatchEvent(new Event('input', { bubbles: true }));
      }
      var radios = row.querySelectorAll('.quiz-choice input[type=radio]');
      radios[data[r].correct].checked = true;
      radios[data[r].correct].dispatchEvent(new Event('change', { bubbles: true }));
    }
    return 'ok';
  `);
  ok(fillResult === 'ok', 'filled both quiz rows without error', fillResult);

  await A.ev("document.getElementById('quizSaveBtn').click(); return true;");
  await sleep(800);

  const status = await A.ev("return document.getElementById('quizStatus').textContent;");
  ok(/2/.test(status), 'quiz editor reports 2 questions saved, not refused as incomplete', status);

  const toast = await A.ev("var t = document.querySelector('.toast'); return t ? t.textContent : null;");
  ok(!toast || !/incomplete/i.test(toast), 'no "incomplete" refusal toast', toast);

  await A.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.message || e));
}

console.log('\n' + notes.join('\n'));
if (fails.length) console.log('\n' + fails.join('\n'));
console.log('\npassed', notes.length, ' failed', fails.length);
process.exit(fails.length ? 1 : 0);
