// Covers the Name This Tune / Picture Round question kinds added to the
// custom quiz editor: cycling the per-row type control, save-time refusal
// when a tune/picture row has no matching attachment, and — end to end,
// like media-upload-test.mjs — that a saved tune/picture question actually
// renders with the hero-sized media and the right badge during play.
import WS from 'ws';
const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || ('QK' + Math.floor(Math.random() * 9000 + 1000));
const IMG_PATH = 'D:\\WinTemp\\late-signal\\test-image.png';
const AUDIO_PATH = 'D:\\WinTemp\\late-signal\\test-audio.wav';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l) : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

class Tab {
  constructor(n) { this.name = n; this.id = 0; this.pending = new Map(); this.exceptions = []; }
  async open() {
    const r = await fetch(CDP + '/json/new?about:blank', { method: 'PUT' });
    const t = await r.json(); this.target = t;
    this.ws = new WS(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') this.exceptions.push(m.params.exceptionDetails.exception?.description);
    });
    await this.cmd('Runtime.enable'); await this.cmd('Page.enable'); await this.cmd('DOM.enable');
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
  async setFile(selector, path) {
    await this.ev(`document.querySelector(${JSON.stringify(selector)}).setAttribute('data-test-marker', '1'); return true;`);
    const doc = await this.cmd('DOM.getDocument', {});
    const found = await this.cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-test-marker="1"]' });
    await this.cmd('DOM.setFileInputFiles', { files: [path], nodeId: found.nodeId });
    await this.ev(`document.querySelector(${JSON.stringify(selector)}).removeAttribute('data-test-marker'); return true;`);
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
  await A.ev("document.getElementById('quizAddBtn').click(); return true;");
  await sleep(200);

  // --- Cycling the per-row type control: Standard -> Tune -> Picture -> Standard.
  // Each click rebuilds the row (renderQuizEditor), so the button has to be
  // re-queried fresh every time — reusing the pre-click reference reads a
  // now-detached node whose textContent was only ever set once, at birth.
  const cycled = [await A.ev("return document.querySelector('.quiz-kind').textContent;")];
  for (let i = 0; i < 3; i++) {
    await A.ev("document.querySelector('.quiz-kind').click(); return true;");
    cycled.push(await A.ev("return document.querySelector('.quiz-kind').textContent;"));
  }
  ok(cycled[0] === 'Standard', 'row starts as Standard', cycled[0]);
  ok(/Name This Tune/.test(cycled[1]), 'first click cycles to Name This Tune', cycled[1]);
  ok(/Picture Round/.test(cycled[2]), 'second click cycles to Picture Round', cycled[2]);
  ok(cycled[3] === 'Standard', 'third click cycles back to Standard', cycled[3]);

  // --- Land on Tune, fill the row, try to save with NO audio attached.
  await A.ev(`
    var row = document.querySelector('.quiz-row');
    row.querySelector('.quiz-kind').click(); // -> tune
    var textInput = row.querySelector('input[type=text]');
    textInput.value = 'Name this tune';
    textInput.dispatchEvent(new Event('input', { bubbles: true }));
    var choiceInputs = row.querySelectorAll('.quiz-choice input[type=text]');
    var vals = ['Song A', 'Song B', 'Song C', 'Song D'];
    for (var i = 0; i < 4; i++) { choiceInputs[i].value = vals[i]; choiceInputs[i].dispatchEvent(new Event('input', { bubbles: true })); }
    var radios = row.querySelectorAll('.quiz-choice input[type=radio]');
    radios[0].checked = true;
    radios[0].dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `);
  const mediaInputAccept = await A.ev("return document.querySelector('.quiz-media-input').accept;");
  ok(mediaInputAccept === 'audio/*', 'file picker is restricted to audio/* once kind is tune', mediaInputAccept);

  await A.ev("document.getElementById('quizSaveBtn').click(); return true;");
  await sleep(400);
  const refusedStatus = await A.ev("return document.getElementById('quizStatus').textContent;");
  ok(refusedStatus === 'Not saved yet', 'save is refused locally when Tune has no audio attached', refusedStatus);
  const refusalToast = await A.ev("var t = document.querySelector('.toast'); return t ? t.textContent : null;");
  ok(!!refusalToast && /audio clip/i.test(refusalToast), 'toast explains the Tune row needs an audio clip', refusalToast);

  // --- Attach the audio fixture, save should now succeed.
  await A.setFile('.quiz-media-input', AUDIO_PATH);
  await sleep(500);
  ok(A.exceptions.length === 0, 'no console exceptions after selecting the audio file', A.exceptions);
  const audioStatus = await A.ev("var s = document.querySelector('.quiz-media-status'); return s ? s.textContent : null;");
  ok(audioStatus === 'Sound attached', 'media status updates to "Sound attached"', audioStatus);

  await A.ev("document.getElementById('quizSaveBtn').click(); return true;");
  await sleep(600);
  const savedOne = await A.ev("return document.getElementById('quizStatus').textContent;");
  ok(savedOne.indexOf('1') >= 0, 'quiz saved with the Tune question', savedOne);

  // --- Add a Picture row, attach the image fixture, save both.
  await A.ev("document.getElementById('quizAddBtn').click(); return true;");
  await sleep(200);
  await A.ev(`
    var rows = document.querySelectorAll('.quiz-row');
    var row = rows[1];
    row.querySelector('.quiz-kind').click(); // -> tune
    row.querySelector('.quiz-kind').click(); // -> picture
    var textInput = row.querySelector('input[type=text]');
    textInput.value = 'What is pictured here?';
    textInput.dispatchEvent(new Event('input', { bubbles: true }));
    var choiceInputs = row.querySelectorAll('.quiz-choice input[type=text]');
    var vals = ['A pixel', 'A cat', 'A dog', 'A house'];
    for (var i = 0; i < 4; i++) { choiceInputs[i].value = vals[i]; choiceInputs[i].dispatchEvent(new Event('input', { bubbles: true })); }
    var radios = row.querySelectorAll('.quiz-choice input[type=radio]');
    radios[0].checked = true;
    radios[0].dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `);
  await A.setFile('.quiz-row:nth-of-type(2) .quiz-media-input', IMG_PATH);
  await sleep(500);
  ok(A.exceptions.length === 0, 'no console exceptions after selecting the image file', A.exceptions);

  await A.ev("document.getElementById('quizSaveBtn').click(); return true;");
  await sleep(600);
  const savedTwo = await A.ev("return document.getElementById('quizStatus').textContent;");
  ok(savedTwo.indexOf('2') >= 0, 'quiz saved with both the Tune and Picture questions', savedTwo);

  // --- Shrink the round to exactly these 2 questions, 5s per question, so
  // the end-to-end render check below doesn't wait out a 20s x 10 default.
  // Each click computes its new value from state.settings as last updated
  // by the SERVER's echo, so clicks must be spaced out — firing them in a
  // tight synchronous loop has every click read the same stale base and
  // all land on the same one-step-down value instead of compounding.
  for (let i = 0; i < 8; i++) {
    await A.ev("document.getElementById('perRoundDown').click(); return true;");
    await sleep(250);
  }
  for (let i = 0; i < 3; i++) {
    await A.ev("document.getElementById('timerDown').click(); return true;");
    await sleep(250);
  }
  const shrunk = await A.ev(`
    return { perRound: document.getElementById('perRoundVal').textContent,
             timer: document.getElementById('timerVal').textContent };
  `);
  ok(shrunk.perRound === '2', 'questions per round shrunk to 2', shrunk);
  ok(shrunk.timer === '5s', 'timer shrunk to 5s', shrunk);

  await A.ev("document.getElementById('teamSetupBtn').click(); return true;");
  await sleep(500);

  const B = new Tab('B');
  await B.open();
  await B.cmd('Page.navigate', { url: PAGE });
  await sleep(1300);
  await B.ev(`
    document.getElementById('nameInput').value = 'Bea';
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click(); return true;`);
  await sleep(1000);
  await B.ev("document.querySelector('.team-join').click(); return true;");
  await sleep(500);

  // Two clicks now: first opens the event (standby), second fires question 1.
  await A.ev("document.getElementById('startBtn').click(); return true;");
  await sleep(600);
  await A.ev("document.getElementById('startBtn').click(); return true;");
  await sleep(1500);

  // onStart shuffles g.customQuestions, so which of our 2 saved questions
  // lands first is NOT deterministic — read each one's own category badge
  // to know which kind it actually is, rather than assuming an order.
  async function readMediaState(tab) {
    return tab.ev(`
      var m = document.getElementById('questionMedia');
      var a = m ? m.querySelector('audio') : null;
      var img = m ? m.querySelector('img') : null;
      var ar = a ? a.getBoundingClientRect() : null;
      var ir = img ? img.getBoundingClientRect() : null;
      return {
        hero: m ? m.classList.contains('q-media--hero') : false,
        hasAudio: !!a, audioWidth: ar ? ar.width : 0, audioHeight: ar ? ar.height : 0,
        imgSrc: img ? img.src.slice(0, 20) : null, imgWidth: ir ? ir.width : 0, imgHeight: ir ? ir.height : 0,
        cat: document.getElementById('catText').textContent,
      };
    `);
  }
  function checkQuestionMedia(q) {
    ok(q.hero === true, 'question gets the hero-sized media class', q);
    if (/Name This Tune/.test(q.cat)) {
      ok(q.hasAudio === true, 'Tune question renders an <audio> element', q);
      ok(q.audioWidth > 0 && q.audioHeight > 0, 'the <audio> control actually has visible size, not 0x0', q);
      return 'tune';
    }
    if (/Picture Round/.test(q.cat)) {
      ok(q.imgSrc === 'data:image/png;base6', 'Picture question renders an <img> with a data:image/png source', q);
      ok(q.imgWidth > 0 && q.imgHeight > 0, 'the <img> actually has visible size, not 0x0', q);
      return 'picture';
    }
    ok(false, 'category chip shows a Tune or Picture badge', q.cat);
    return null;
  }

  const q1 = await readMediaState(A);
  const kind1 = checkQuestionMedia(q1);

  // Advance past the 5s timer to the scoreboard, then to Q2. Poll for the
  // host's Next button rather than guessing a sleep long enough to cover it.
  let advanced = false;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    advanced = await A.ev("var b = document.querySelector('#boardActions button'); if (b) { b.click(); return true; } return false;");
    if (advanced) break;
  }
  ok(advanced, 'reached the scoreboard and clicked Next within 10s of the 5s timer expiring');
  await sleep(1200);

  const q2 = await readMediaState(A);
  const kind2 = checkQuestionMedia(q2);
  ok(kind1 && kind2 && kind1 !== kind2, 'the two questions were one Tune and one Picture, not a repeat', { kind1, kind2 });

  ok(A.exceptions.length === 0, 'no console exceptions across the whole flow', A.exceptions);

  await A.close(); await B.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.message || e));
}

console.log('\n' + notes.join('\n'));
if (fails.length) console.log('\n' + fails.join('\n'));
console.log('\npassed', notes.length, ' failed', fails.length);
process.exit(fails.length ? 1 : 0);
