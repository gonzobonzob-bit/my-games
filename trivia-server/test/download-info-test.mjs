import WS from 'ws';
const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || 'DWN1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l) : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

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
    const r = await this.cmd('Runtime.evaluate', { expression: `(async function(){${body}})()`, awaitPromise: true, returnByValue: true });
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
  await A.ev("document.getElementById('teamSetupBtn').click(); return true;");
  await sleep(500);

  const result = await A.ev(`
    var capturedHref = null, capturedDownload = null;
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download && this.download.indexOf('late-signal-') === 0) {
        capturedHref = this.href;
        capturedDownload = this.download;
        return; // swallow the actual download attempt (inert in this sandbox anyway)
      }
      return origClick.call(this);
    };
    document.getElementById('downloadInfoBtn').click();
    await new Promise(function(r){ setTimeout(r, 200); });
    if (!capturedHref) return { error: 'no download triggered' };
    var text = await (await fetch(capturedHref)).text();
    return { filename: capturedDownload, text: text };
  `);
  console.log(result.text);

  ok(result.filename === 'late-signal-' + ROOM + '.txt', 'filename includes the room code', result.filename);
  ok(result.text && result.text.indexOf('Room code: ' + ROOM) >= 0, 'file contains the room code');
  ok(result.text && /Host recovery code: [a-z]+-[a-z]+-[a-z]+/.test(result.text), 'file contains a valid-looking host recovery code');
  ok(result.text && result.text.indexOf('Mode: Teams') >= 0, 'file reflects teams mode');
  ok(result.text && result.text.indexOf('Teams (2):') >= 0, 'file lists the 2 default teams');
  ok(result.text && result.text.indexOf('Team 1') >= 0 && result.text.indexOf('Team 2') >= 0, 'file names both teams');
  ok(result.text && /Timer: \d+s per question/.test(result.text), 'file includes the timer setting');

  await A.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.message || e));
}

console.log('\n' + notes.join('\n'));
if (fails.length) console.log('\n' + fails.join('\n'));
console.log('\npassed', notes.length, ' failed', fails.length);
process.exit(fails.length ? 1 : 0);
