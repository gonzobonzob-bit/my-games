import WS from 'ws';
const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || 'UIS1';
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
  await sleep(400);

  // Rounds/per-round steppers
  await A.ev("document.getElementById('roundsUp').click(); return true;");
  await A.ev("document.getElementById('roundsUp').click(); return true;");
  await sleep(300);
  const roundsVal = await A.ev("return document.getElementById('roundsVal').textContent;");
  ok(roundsVal === '3', 'rounds stepper reaches 3 after two clicks', roundsVal);

  await A.ev("document.getElementById('perRoundDown').click(); return true;");
  await sleep(300);
  const perRoundVal = await A.ev("return document.getElementById('perRoundVal').textContent;");
  ok(perRoundVal === '9', 'questions-per-round stepper decrements to 9', perRoundVal);

  await A.ev("document.getElementById('timerUp').click(); return true;");
  await A.ev("document.getElementById('timerUp').click(); return true;");
  await sleep(300);
  const timerVal = await A.ev("return document.getElementById('timerVal').textContent;");
  ok(timerVal === '30s', 'timer stepper reaches 30s after two +5s clicks', timerVal);

  // Confirm an unrelated settings tap (difficulty) does NOT reset rounds —
  // this is exactly the sendSettings() bug that was just fixed.
  await A.ev("document.getElementById('diffSlot').click(); return true;");
  await sleep(300);
  const roundsAfterDiff = await A.ev("return document.getElementById('roundsVal').textContent;");
  ok(roundsAfterDiff === '3', 'rounds survives an unrelated settings change (difficulty tap)', roundsAfterDiff);
  const timerAfterDiff = await A.ev("return document.getElementById('timerVal').textContent;");
  ok(timerAfterDiff === '30s', 'timer survives an unrelated settings change too', timerAfterDiff);

  // Team setup, then add/remove/rename
  await A.ev("document.getElementById('teamSetupBtn').click(); return true;");
  await sleep(500);
  let teamCount = await A.ev("return document.querySelectorAll('.team-card').length;");
  ok(teamCount === 2, 'teamSetup creates 2 teams by default', teamCount);

  await A.ev("document.querySelector('.team-add-btn').click(); return true;");
  await sleep(500);
  teamCount = await A.ev("return document.querySelectorAll('.team-card').length;");
  ok(teamCount === 3, 'Add team button adds a third team', teamCount);

  const firstTeamName = await A.ev("return document.querySelector('.team-name').textContent;");
  ok(firstTeamName === 'Team 1', 'first team kept its default name after adding a third', firstTeamName);

  // Rename the first team, then add ANOTHER team — the rename must survive.
  await A.ev(`
    var btn = document.querySelector('.team-name-edit');
    btn.click();
    var input = document.querySelector('.team-name-input');
    input.value = 'The Quizzlers';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  `);
  await sleep(500);
  const renamedName = await A.ev("return document.querySelector('.team-name').textContent;");
  ok(renamedName === 'The Quizzlers', 'team rename took effect', renamedName);

  await A.ev("document.querySelector('.team-add-btn').click(); return true;");
  await sleep(500);
  const nameAfterAnotherAdd = await A.ev("return document.querySelector('.team-name').textContent;");
  ok(nameAfterAnotherAdd === 'The Quizzlers', 'the renamed team survives adding yet another team (not reset)', nameAfterAnotherAdd);
  teamCount = await A.ev("return document.querySelectorAll('.team-card').length;");
  ok(teamCount === 4, 'now 4 teams total', teamCount);

  // Remove a team — the renamed one must still be there, untouched.
  const removeBtns = await A.ev("return document.querySelectorAll('.team-remove-btn').length;");
  ok(removeBtns === 4, 'every team card has a remove button for the host', removeBtns);
  await A.ev("document.querySelectorAll('.team-remove-btn')[3].click(); return true;");
  await sleep(500);
  teamCount = await A.ev("return document.querySelectorAll('.team-card').length;");
  ok(teamCount === 3, 'removing one team leaves 3', teamCount);
  const nameAfterRemove = await A.ev("return document.querySelector('.team-name').textContent;");
  ok(nameAfterRemove === 'The Quizzlers', 'the renamed team is untouched by removing a different one', nameAfterRemove);

  await A.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.message || e));
}

console.log('\n' + notes.join('\n'));
if (fails.length) console.log('\n' + fails.join('\n'));
console.log('\npassed', notes.length, ' failed', fails.length);
process.exit(fails.length ? 1 : 0);
