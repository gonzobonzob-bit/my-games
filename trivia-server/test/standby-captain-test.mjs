// End-to-end CDP coverage for the standby "doors open" phase and explicit
// team-captain self-claim: host opens the event -> config widgets vanish
// for everyone while team-join/captain-claim stay live -> a teammate other
// than the first-to-join claims captain -> host fires question 1 -> only
// the CLAIMED captain's tiles are actually clickable, not whoever joined
// first. Protocol-level coverage of the same feature already lives in
// teams-test.mjs ("standby phase: doors open..." section); this is the
// real browser/DOM half — the thing players and the host actually see.
import WS from 'ws';
const CDP = process.env.LS_CDP || 'http://127.0.0.1:9222';
const PAGE = process.env.LS_PAGE || 'http://localhost:8000/trivia/';
const ROOM = process.argv[2] || ('SC' + Math.floor(Math.random() * 9000 + 1000));
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
  async join(name, room) {
    await this.cmd('Page.navigate', { url: PAGE });
    await sleep(1300);
    await this.ev(`
      document.getElementById('nameInput').value = ${JSON.stringify(name)};
      document.getElementById('codeInput').value = ${JSON.stringify(room)};
      document.getElementById('joinBtn').click(); return true;`);
    await sleep(1200);
  }
  async close() { try { await fetch(CDP + '/json/close/' + this.target.id); } catch {} }
}

try {
  const A = new Tab('A');
  await A.open();
  await A.cmd('Page.navigate', { url: PAGE });
  await sleep(1300);
  await A.ev("try{localStorage.clear()}catch(e){} return true;");
  await A.join('Ann', ROOM);

  await A.ev("document.getElementById('modeSlot').click(); return true;");
  await sleep(300);
  await A.ev("document.getElementById('teamSetupBtn').click(); return true;");
  await sleep(500);

  // Before the doors open: config widgets are visible for the host.
  const beforeOpen = await A.ev(`
    return {
      modeHidden: document.getElementById('modeSlot').hidden,
      teamsSetupHidden: document.getElementById('teamsSetup') ? document.getElementById('teamsSetup').hidden : true,
      startLabel: document.getElementById('startBtn').textContent,
    };
  `);
  ok(beforeOpen.modeHidden === false, 'mode slot is visible before the event opens', beforeOpen);
  ok(/start event/i.test(beforeOpen.startLabel), 'host sees "Start event" while still in the lobby', beforeOpen);

  // Open the event. Config should vanish; room code / roster / join stay.
  await A.ev("document.getElementById('startBtn').click(); return true;");
  await sleep(800);

  const afterOpen = await A.ev(`
    return {
      modeHidden: document.getElementById('modeSlot').hidden,
      teamsSetupHidden: document.getElementById('teamsSetup') ? document.getElementById('teamsSetup').hidden : true,
      roundsSetupHidden: document.getElementById('roundsSetup') ? document.getElementById('roundsSetup').hidden : true,
      screen: document.body.dataset.screen,
    };
  `);
  ok(afterOpen.modeHidden === true, 'mode slot is hidden once the event is open (standby)', afterOpen);
  ok(afterOpen.teamsSetupHidden === true, 'team-count setup is hidden once the event is open', afterOpen);
  ok(afterOpen.screen === 'lobby', 'standby reuses the lobby screen, not a separate one', afterOpen);

  // Bea joins and takes Team 1 — she'll be the AUTOMATIC default leader.
  const B = new Tab('B'); await B.open();
  await B.join('Bea', ROOM);
  await B.ev("document.querySelector('.team-join').click(); return true;");
  await sleep(500);

  const beaIsDefaultLeader = await B.ev(`
    var m = document.querySelector('.team-member .mname');
    return m ? m.textContent : null;
  `);
  ok(/Bea.*★/.test(beaIsDefaultLeader || ''), 'Bea is the automatic default leader as the first (only) member', beaIsDefaultLeader);

  // Cat joins the SAME team — second member, does NOT get the star by default.
  const C = new Tab('C'); await C.open();
  await C.join('Cat', ROOM);
  await sleep(300);
  await C.ev("document.querySelector('.team-join').click(); return true;");
  await sleep(500);

  // Cat explicitly claims captaincy via the new button.
  const catCaptainBtn = await C.ev(`
    var btn = document.querySelector('.team-captain-claim');
    return btn ? btn.textContent : null;
  `);
  ok(/be captain/i.test(catCaptainBtn || ''), 'Cat sees a "Be captain" button (on the team, not yet captain)', catCaptainBtn);

  await C.ev("document.querySelector('.team-captain-claim').click(); return true;");
  await sleep(700);

  const afterClaim = await A.ev(`
    var names = Array.prototype.map.call(document.querySelectorAll('.team-member .mname'), function (n) { return n.textContent; });
    return names;
  `);
  ok(afterClaim.some((n) => /Cat.*★/.test(n)), 'the host sees the star move to Cat after the claim', afterClaim);
  ok(!afterClaim.some((n) => /Bea.*★/.test(n)), 'the host no longer sees Bea starred', afterClaim);

  // Cat's own view should no longer offer a claim button (already captain).
  await sleep(300);
  const catBtnGone = await C.ev("return !document.querySelector('.team-captain-claim');");
  ok(catBtnGone === true, 'the "Be captain" button disappears for Cat once she already has it', catBtnGone);

  // Shrink the round so this doesn't wait out a 20s default question.
  await A.ev(`
    for (var i = 0; i < 3; i++) document.getElementById('timerDown').click();
    return true;
  `);
  await sleep(300);

  // Fire question 1 — second click on the same button.
  await A.ev("document.getElementById('startBtn').click(); return true;");
  await sleep(1500);

  const tileState = await function (tab) {
    return tab.ev(`
      var t = document.querySelector('.tile');
      return { exists: !!t, disabled: t ? t.disabled : null };
    `);
  }(B);
  const catTileState = await C.ev(`
    var t = document.querySelector('.tile');
    return { exists: !!t, disabled: t ? t.disabled : null };
  `);
  ok(tileState.exists === true && tileState.disabled === true, "Bea's tiles exist but are disabled — she is no longer captain", tileState);
  ok(catTileState.exists === true && catTileState.disabled === false, "Cat's tiles are live — she is the claimed captain", catTileState);

  ok(A.exceptions.length === 0 && B.exceptions.length === 0 && C.exceptions.length === 0,
    'no console exceptions across the whole flow', { a: A.exceptions, b: B.exceptions, c: C.exceptions });

  await A.close(); await B.close(); await C.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.message || e));
}

console.log('\n' + notes.join('\n'));
if (fails.length) console.log('\n' + fails.join('\n'));
console.log('\npassed', notes.length, ' failed', fails.length);
process.exit(fails.length ? 1 : 0);
