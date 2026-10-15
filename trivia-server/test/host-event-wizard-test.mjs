import WS from 'ws';
const CDP = process.env.LS_CDP || 'http://127.0.0.1:9222';
const PAGE = process.env.LS_PAGE || 'http://localhost:8000/trivia/';
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
    document.getElementById('hostEventBtn').click();
    return true;`);
  await sleep(1200);

  // Step 1 — Teams
  ok(await A.ev("return document.getElementById('wizardBar').hidden;") === false,
     'the wizard bar is visible right after Host an Event');
  ok(await A.ev("return document.getElementById('wizardStepLabel').textContent;") === 'Step 1 of 4 — Teams',
     'step label reads "Step 1 of 4 — Teams"');
  ok(await A.ev("return document.getElementById('modeVal').textContent;") === 'Teams',
     'mode auto-switched to Teams for the event wizard');
  ok(await A.ev("return document.getElementById('teamsSetup').hidden;") === false, 'teams-setup controls are visible on step 1');
  ok(await A.ev("return document.getElementById('callSheet').hidden;") === true, 'genre/difficulty are hidden on step 1');
  ok(await A.ev("return document.getElementById('roundsSetup').hidden;") === true, 'rounds/timer are hidden on step 1');
  ok(await A.ev("return document.getElementById('lobbyPlayers').hidden;") === true, 'the host seat display is hidden during the wizard');
  ok(await A.ev("return document.querySelector('.board-actions').hidden;") === true, 'start/wait controls are hidden during the wizard');
  ok(await A.ev("return document.getElementById('wizardBackBtn').hidden;") === true, 'Back is hidden on the first step');

  // Actually set up teams on step 1, confirm it still works inside the wizard.
  await A.ev("document.getElementById('teamCountUp').click(); return true;"); // 2 -> 3
  await A.ev("document.getElementById('teamSetupBtn').click(); return true;");
  await sleep(500);
  ok(await A.ev("return document.querySelectorAll('.team-card').length;") === 3, 'teamSetup works normally inside the wizard (3 teams)');

  // Step 2 — Questions
  await A.ev("document.getElementById('wizardNextBtn').click(); return true;");
  await sleep(300);
  ok(await A.ev("return document.getElementById('wizardStepLabel').textContent;") === 'Step 2 of 4 — Questions',
     'advanced to step 2 (Questions)');
  ok(await A.ev("return document.getElementById('teamsSetup').hidden;") === true, 'teams-setup hidden again on step 2');
  ok(await A.ev("return document.getElementById('callSheet').hidden;") === false, 'genre/difficulty visible on step 2');
  ok(await A.ev("return document.getElementById('wizardBackBtn').hidden;") === false, 'Back appears once past step 1');

  // Step 3 — Timing
  await A.ev("document.getElementById('wizardNextBtn').click(); return true;");
  await sleep(300);
  ok(await A.ev("return document.getElementById('wizardStepLabel').textContent;") === 'Step 3 of 4 — Timing',
     'advanced to step 3 (Timing)');
  ok(await A.ev("return document.getElementById('callSheet').hidden;") === true, 'genre/difficulty hidden again on step 3');
  ok(await A.ev("return document.getElementById('roundsSetup').hidden;") === false, 'rounds/questionsPerRound/timer visible on step 3');

  // Actually adjust a timing setting inside the wizard.
  await A.ev("document.getElementById('roundsUp').click(); return true;");
  await sleep(300);
  ok(await A.ev("return document.getElementById('roundsVal').textContent;") === '2', 'rounds stepper works normally inside the wizard');

  // Back navigation
  await A.ev("document.getElementById('wizardBackBtn').click(); return true;");
  await sleep(300);
  ok(await A.ev("return document.getElementById('wizardStepLabel').textContent;") === 'Step 2 of 4 — Questions',
     'Back returns to step 2');
  await A.ev("document.getElementById('wizardNextBtn').click(); return true;"); // back to step 3
  await sleep(200);

  // Step 4 — Review
  await A.ev("document.getElementById('wizardNextBtn').click(); return true;");
  await sleep(300);
  ok(await A.ev("return document.getElementById('wizardStepLabel').textContent;") === 'Step 4 of 4 — Review',
     'advanced to step 4 (Review)');
  ok(await A.ev("return document.getElementById('codeTiles').children.length;") > 0, 'room code is visible on the review step');
  ok(await A.ev("return document.getElementById('hostCodeBtn').hidden;") === false, 'host recovery code control is visible on review');
  ok(await A.ev("return document.getElementById('wizardNextBtn').textContent;") === 'Done — enter the lobby',
     'final step button reads "Done — enter the lobby"');

  // Finish the wizard — everything should now behave like a normal lobby.
  await A.ev("document.getElementById('wizardNextBtn').click(); return true;");
  await sleep(300);
  ok(await A.ev("return document.getElementById('wizardBar').hidden;") === true, 'wizard bar disappears once done');
  ok(await A.ev("return document.getElementById('lobbyPlayers').hidden;") === false, 'host seat display reappears after the wizard');
  ok(await A.ev("return document.getElementById('startBtn').hidden;") === false, 'Start button is visible again after the wizard');
  ok(await A.ev("return document.getElementById('teamsSetup').hidden;") === false, 'teams-setup is visible normally (no longer step-gated)');
  // Settings made during the wizard must have actually persisted.
  ok(await A.ev("return document.querySelectorAll('.team-card').length;") === 3, 'the 3 teams set up during the wizard are still there');
  ok(await A.ev("return document.getElementById('roundsVal').textContent;") === '2', 'the rounds setting from the wizard is still there');

  ok(A.exceptions.length === 0, 'no console exceptions across the whole wizard flow', A.exceptions);

  await A.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.message || e));
}

console.log('\n' + notes.join('\n'));
if (fails.length) console.log('\n' + fails.join('\n'));
console.log('\npassed', notes.length, ' failed', fails.length);
process.exit(fails.length ? 1 : 0);
