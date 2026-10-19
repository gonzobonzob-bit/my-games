import WS from 'ws';
const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || 'MED1';
const IMG_PATH = 'D:\\WinTemp\\late-signal\\test-image.png';
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

  // Fill in the question text/choices first (reusing the already-verified path).
  await A.ev(`
    var row = document.querySelector('.quiz-row');
    var textInput = row.querySelector('input[type=text]');
    textInput.value = 'What is this a picture of?';
    textInput.dispatchEvent(new Event('input', { bubbles: true }));
    var choiceInputs = row.querySelectorAll('.quiz-choice input[type=text]');
    var vals = ['A pixel', 'A cat', 'A dog', 'A house'];
    for (var i = 0; i < 4; i++) { choiceInputs[i].value = vals[i]; choiceInputs[i].dispatchEvent(new Event('input', { bubbles: true })); }
    var radios = row.querySelectorAll('.quiz-choice input[type=radio]');
    radios[0].checked = true;
    radios[0].dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `);

  // Real file selection via CDP — a file input's .files cannot be set from
  // page JS directly (browser security), this is the actual supported way
  // to simulate a user picking a file.
  await A.ev(`
    document.querySelector('.quiz-media-input').setAttribute('data-test-marker', '1');
    return true;
  `);
  const doc = await A.cmd('DOM.getDocument', {});
  const found = await A.cmd('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '[data-test-marker="1"]' });
  const inputNodeId = found.nodeId;
  await A.cmd('DOM.setFileInputFiles', { files: [IMG_PATH], nodeId: inputNodeId });
  await sleep(500);

  ok(A.exceptions.length === 0, 'no console exceptions after selecting the image file', A.exceptions);
  const statusText = await A.ev("var s = document.querySelector('.quiz-media-status'); return s ? s.textContent : null;");
  ok(statusText === 'Photo attached', 'media status updates to "Photo attached"', statusText);

  await A.ev("document.getElementById('quizSaveBtn').click(); return true;");
  await sleep(800);
  const saveStatus = await A.ev("return document.getElementById('quizStatus').textContent;");
  ok(saveStatus.indexOf('1') >= 0, 'quiz saved with the media-attached question', saveStatus);

  // Teams mode needs an actual team member (host never plays) to start.
  await A.ev("document.getElementById('teamSetupBtn').click(); return true;");
  await sleep(500);

  // Join the team ourselves isn't allowed (host), so open a second tab.
  const B3 = new Tab('B');
  await B3.open();
  await B3.cmd('Page.navigate', { url: PAGE });
  await sleep(1300);
  await B3.ev(`
    document.getElementById('nameInput').value = 'Bea';
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click(); return true;`);
  await sleep(1000);
  await B3.ev("document.querySelector('.team-join').click(); return true;");
  await sleep(500);

  // Two clicks now: first opens the event (standby — config locked, teams
  // still joinable), second actually fires question 1.
  await A.ev("document.getElementById('startBtn').click(); return true;");
  await sleep(600);
  await A.ev("document.getElementById('startBtn').click(); return true;");
  await sleep(1500);

  const mediaVisible = await A.ev("var m = document.getElementById('questionMedia'); return m ? !m.hidden : false;");
  const imgSrc = await A.ev("var img = document.querySelector('#questionMedia img'); return img ? img.src.slice(0, 30) : null;");
  const mediaDiag = await A.ev(`
    var m = document.getElementById('questionMedia');
    return { exists: !!m, hidden: m ? m.hidden : null, innerHTML: m ? m.innerHTML.slice(0,100) : null, screen: document.querySelector('.screen.on') ? document.querySelector('.screen.on').id : 'none' };
  `);
  console.log('media diag:', JSON.stringify(mediaDiag));
  console.log('question screen body snippet:', (await A.ev("return document.body.innerText.slice(0,200);")).replace(/\n/g,' | '));
  ok(mediaVisible === true, 'the question-media container is visible once the game starts', mediaVisible);
  ok(imgSrc && imgSrc.indexOf('data:image/png') === 0, 'the rendered element is an <img> with a data:image/png source', imgSrc);

  ok(A.exceptions.length === 0, 'no console exceptions across the whole upload-to-playback flow', A.exceptions);

  await A.close(); await B3.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.message || e));
}

console.log('\n' + notes.join('\n'));
if (fails.length) console.log('\n' + fails.join('\n'));
console.log('\npassed', notes.length, ' failed', fails.length);
process.exit(fails.length ? 1 : 0);
