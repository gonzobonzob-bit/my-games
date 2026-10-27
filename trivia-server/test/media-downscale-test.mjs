// Covers downscaleImage() — a real phone photo (several MB, 4000px+ on a
// side) gets resized/recompressed client-side before the MEDIA_MAX check,
// so almost nothing a host actually takes with a phone camera gets refused
// as "too big." Built entirely in-page (canvas -> blob -> File -> DataTransfer
// onto the real <input>) rather than via DOM.setFileInputFiles, which chokes
// on anything much above ~1MB in this CDP/Chrome combination — confirmed by
// hand: a plain 1MB file comes through with .size === 0 that way. The
// DataTransfer path exercises the exact same 'change' handler a real pick
// would, just sourced in-page instead of over the wire.
import WS from 'ws';

const CDP = process.env.LS_CDP || 'http://127.0.0.1:9222';
const PAGE = process.env.LS_PAGE || 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || ('MD' + Math.floor(Math.random() * 9000 + 1000));
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

// A gradient-plus-speckle canvas, not pure noise — real photos have spatial
// structure a flat PNG deflate can actually compress, so this decodes and
// re-encodes at realistic speed instead of pathologically slow random noise.
const BUILD_BIG_PHOTO = `
  return new Promise(function(resolve){
    var c = document.createElement('canvas');
    c.width = 4000; c.height = 3000;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, 4000, 3000);
    g.addColorStop(0, '#2b6cb0'); g.addColorStop(1, '#e53e3e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4000, 3000);
    var id = ctx.getImageData(0, 0, 4000, 3000);
    for (var i = 0; i < id.data.length; i += 4) {
      var n = (Math.random() * 40) | 0;
      id.data[i] = Math.min(255, id.data[i] + n);
    }
    ctx.putImageData(id, 0, 0);
    c.toBlob(function (blob) {
      var file = new File([blob], 'photo.png', { type: 'image/png' });
      var input = document.querySelector('.quiz-media-input');
      var dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      resolve({ sourceSize: file.size });
    }, 'image/png');
  });
`;

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

  await A.ev(`
    var row = document.querySelector('.quiz-row');
    var textInput = row.querySelector('input[type=text]');
    textInput.value = 'What color is pictured?';
    textInput.dispatchEvent(new Event('input', { bubbles: true }));
    var choiceInputs = row.querySelectorAll('.quiz-choice input[type=text]');
    var vals = ['Blue to red', 'Green', 'Yellow', 'Purple'];
    for (var i = 0; i < 4; i++) { choiceInputs[i].value = vals[i]; choiceInputs[i].dispatchEvent(new Event('input', { bubbles: true })); }
    var radios = row.querySelectorAll('.quiz-choice input[type=radio]');
    radios[0].checked = true;
    radios[0].dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  `);

  const built = await A.ev(BUILD_BIG_PHOTO);
  ok(built.sourceSize > 10_000_000, 'the synthetic source photo is genuinely large (>10MB)', built);

  var status = null;
  for (let i = 0; i < 10 && status !== 'Photo attached'; i++) {
    await sleep(500);
    status = await A.ev("var s = document.querySelector('.quiz-media-status'); return s ? s.textContent : null;");
  }
  ok(status === 'Photo attached', 'a >10MB source photo still ends up attached, not refused as too big', status);
  ok(A.exceptions.length === 0, 'no console exceptions during downscale', A.exceptions);

  await A.ev("document.getElementById('quizSaveBtn').click(); return true;");
  await sleep(600);
  const saveStatus = await A.ev("return document.getElementById('quizStatus').textContent;");
  ok(saveStatus.indexOf('1') >= 0, 'the downscaled question actually saves', saveStatus);

  await A.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.stack || e));
}

notes.forEach((l) => console.log(l));
fails.forEach((l) => console.log(l));
console.log(`passed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
