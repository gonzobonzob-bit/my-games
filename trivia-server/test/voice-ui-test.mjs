import WS from 'ws';
const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || 'VUI1';
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
      if (m.method === 'Runtime.exceptionThrown') {
        this.exceptions.push(m.params.exceptionDetails.exception?.description || JSON.stringify(m.params.exceptionDetails));
      }
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
  const A = new Tab('A'), B = new Tab('B');
  await A.open(); await B.open();
  await A.cmd('Page.navigate', { url: PAGE });
  await B.cmd('Page.navigate', { url: PAGE });
  await sleep(1300);
  await A.ev("try{localStorage.clear()}catch(e){} return true;");
  await A.cmd('Page.reload');
  await B.cmd('Page.reload');
  await sleep(900);

  await A.ev(`
    document.getElementById('nameInput').value = 'Ada';
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click(); return true;`);
  await sleep(1000);
  ok(A.exceptions.length === 0, 'no console exceptions after host joins', A.exceptions);

  await A.ev("document.getElementById('modeSlot').click(); return true;");
  await sleep(300);
  ok(A.exceptions.length === 0, 'no console exceptions after switching to teams mode', A.exceptions);

  const micHiddenBeforeTeams = await A.ev("return document.getElementById('micBtn').hidden;");
  const micLabelHost = await A.ev("return document.getElementById('micLabel').textContent;");
  ok(micHiddenBeforeTeams === false, 'host sees the mic button once in teams mode', micHiddenBeforeTeams);
  ok(micLabelHost === 'Talk', 'host mic button is labeled for host broadcast', micLabelHost);

  const whisperHiddenForHost = await A.ev("return document.getElementById('whisperBtn').hidden;");
  ok(whisperHiddenForHost === true, 'the host never sees the "ask host" button', whisperHiddenForHost);

  // Second player joins, picks a team
  await B.ev(`
    document.getElementById('nameInput').value = 'Bea';
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click(); return true;`);
  await sleep(1000);

  const micHiddenNoTeam = await B.ev("return document.getElementById('micBtn').hidden;");
  ok(micHiddenNoTeam === true, 'a teams-mode player not yet on a team sees no mic button', micHiddenNoTeam);

  await A.ev("document.getElementById('teamSetupBtn').click(); return true;");
  await sleep(500);
  await B.ev("document.querySelector('.team-join').click(); return true;");
  await sleep(500);

  const micHiddenAfterJoinTeam = await B.ev("return document.getElementById('micBtn').hidden;");
  const micLabelTeam = await B.ev("return document.getElementById('micLabel').textContent;");
  ok(micHiddenAfterJoinTeam === false, 'the mic button appears once Bea joins a team', micHiddenAfterJoinTeam);
  ok(micLabelTeam === 'Talk to team', 'team member mic button is labeled for team channel', micLabelTeam);

  const whisperVisibleForTeamMember = await B.ev("return document.getElementById('whisperBtn').hidden;");
  ok(whisperVisibleForTeamMember === false, 'a team member sees the "ask host" button', whisperVisibleForTeamMember);

  // Exercise the whisper flow end to end through the real UI.
  await B.ev("document.getElementById('whisperBtn').click(); return true;");
  await sleep(200);
  const fieldVisible = await B.ev("return document.getElementById('whisperField').hidden;");
  ok(fieldVisible === false, 'clicking "Ask host" reveals the input field', fieldVisible);

  await B.ev(`
    var i = document.getElementById('whisperInput');
    i.value = 'can we get a hint';
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  `);
  await sleep(500);
  const hostToast = await A.ev("var t = document.querySelector('.toast'); return t ? t.textContent : null;");
  ok(hostToast && hostToast.includes('Bea') && hostToast.includes('can we get a hint'),
     'the host sees the whisper as a toast with sender identity', hostToast);

  ok(A.exceptions.length === 0 && B.exceptions.length === 0, 'no console exceptions across the whole flow',
     { a: A.exceptions, b: B.exceptions });

  await A.close(); await B.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.message || e));
}

console.log('\n' + notes.join('\n'));
if (fails.length) console.log('\n' + fails.join('\n'));
console.log('\npassed', notes.length, ' failed', fails.length);
process.exit(fails.length ? 1 : 0);
