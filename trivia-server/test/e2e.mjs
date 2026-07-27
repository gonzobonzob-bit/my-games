// End-to-end: two real headless-Chrome clients against the real Worker.
import WS from 'ws';

const CDP = 'http://127.0.0.1:9222';
const PAGE = 'http://localhost:8000/trivia/';
/* A fresh code every run. Durable Object storage persists between runs, so a
   fixed room code means each run inherits the previous run's room state —
   which produced a deterministic failure in the genre harness that looked
   exactly like flakiness. Override with argv[2] when reproducing one. */
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM = (process.argv[2] || Array.from({ length: 6 },
  () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('')).toUpperCase();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const fails = [];
const notes = [];
function ok(cond, label, extra) {
  if (cond) notes.push('PASS  ' + label);
  else { fails.push('FAIL  ' + label + (extra ? '  :: ' + JSON.stringify(extra) : '')); }
}

// -------- CDP plumbing --------
class Tab {
  constructor(name) { this.name = name; this.id = 0; this.pending = new Map(); }
  async open(url) {
    const r = await fetch(CDP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
    const t = await r.json();
    this.target = t;
    this.ws = new WS(t.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
    });
    await this.cmd('Runtime.enable');
    await this.cmd('Page.enable');
    await this.cmd('Log.enable');
  }
  cmd(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error(this.name + ' CDP timeout ' + method)), 30000);
      this.pending.set(id, (m) => { clearTimeout(to); if (m.error) rej(new Error(method + ': ' + m.error.message)); else res(m.result); });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expr) {
    const r = await this.cmd('Runtime.evaluate', {
      expression: '(function(){' + expr + '})()',
      returnByValue: true, awaitPromise: true
    });
    if (r.exceptionDetails) throw new Error(this.name + ' eval: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async waitFor(expr, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await this.ev('return !!(' + expr + ');')) return true;
      await sleep(120);
    }
    throw new Error(this.name + ' timed out waiting for: ' + (label || expr));
  }
}

// Recorder installed before any page script runs: captures every inbound
// frame with a timestamp, and every outbound one.
const RECORDER = `
window.__rx = []; window.__tx = []; window.__errs = [];
(function(){
  var Native = window.WebSocket;
  function Wrapped(url, protos){
    var s = protos === undefined ? new Native(url) : new Native(url, protos);
    s.addEventListener('message', function(e){
      try { window.__rx.push({ t: Date.now(), m: JSON.parse(e.data) }); } catch(err){}
    });
    var origSend = s.send.bind(s);
    s.send = function(d){ try { window.__tx.push({ t: Date.now(), m: JSON.parse(d) }); } catch(err){} return origSend(d); };
    window.__sock = s;
    return s;
  }
  Wrapped.prototype = Native.prototype;
  ['CONNECTING','OPEN','CLOSING','CLOSED'].forEach(function(k,i){ Wrapped[k] = i; });
  window.WebSocket = Wrapped;
  window.addEventListener('error', function(e){ window.__errs.push(String(e.message)); });
})();
`;

async function boot(tab, name) {
  await tab.open('about:blank');
  await tab.cmd('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER });
  await tab.cmd('Page.navigate', { url: PAGE });
  await sleep(900);
  await tab.ev(`
    document.getElementById('nameInput').value = ${JSON.stringify(name)};
    document.getElementById('codeInput').value = ${JSON.stringify(ROOM)};
    document.getElementById('joinBtn').click();
    return true;
  `);
}

const snap = `
  var tiles = [].slice.call(document.querySelectorAll('#tiles .tile'));
  return {
    screen: document.body.dataset.screen,
    q: (document.getElementById('questionText')||{}).textContent,
    tiles: tiles.map(function(t){ return { i:+t.dataset.i, cls:t.className, txt:t.querySelector('.tile-text').textContent, dis:t.disabled }; }),
    correctTiles: tiles.filter(function(t){ return t.classList.contains('correct'); }).map(function(t){ return +t.dataset.i; }),
    lock: (document.getElementById('lockLine')||{}).textContent,
    rows: document.querySelectorAll('#boardRows .row').length,
    netbar: document.getElementById('netbar').classList.contains('on'),
    netbarText: document.getElementById('netbar').textContent,
    digits: (document.getElementById('digits')||{}).textContent,
    clockCls: document.getElementById('clock').className,
    seats: document.querySelectorAll('#lobbyPlayers .seat .avatar').length,
    startVisible: !document.getElementById('startBtn').hidden,
    startLabel: document.getElementById('startBtn').textContent,
    startDisabled: document.getElementById('startBtn').disabled,
    boardBtn: (function(){ var b=document.querySelector('#boardActions button'); return b?b.textContent:null; })(),
    finalBtn: (function(){ var b=document.querySelector('#finalActions button'); return b?b.textContent:null; })(),
    winner: (document.getElementById('winnerName')||{}).textContent,
    winnerScore: (document.getElementById('winnerScore')||{}).textContent,
    finalRows: document.querySelectorAll('#finalRest .row').length,
    whoGot: (document.getElementById('whoGot')||{}).textContent,
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    errs: window.__errs.slice()
  };
`;

const A = new Tab('A'), B = new Tab('B');

try {
  await boot(A, 'Alpha');
  await sleep(600);
  await boot(B, 'Bravo');

  await A.waitFor("document.body.dataset.screen==='lobby'", 12000, 'A lobby');
  await B.waitFor("document.body.dataset.screen==='lobby'", 12000, 'B lobby');
  await sleep(900);

  let a = await A.ev(snap), b = await B.ev(snap);
  ok(a.seats === 2 && b.seats === 2, 'lobby roster shows both players', { a: a.seats, b: b.seats });
  ok(a.startVisible === true, 'host sees Start');
  ok(b.startVisible === false, 'non-host does NOT see Start');
  ok(a.startDisabled === false, 'Start enabled at 2 players', a.startLabel);
  ok(!a.hscroll && !b.hscroll, 'no horizontal scroll in lobby');
  ok((a.errs || []).length === 0 && (b.errs || []).length === 0, 'no page errors in lobby', { a: a.errs, b: b.errs });

  // room code hero
  const codeChars = await A.ev("return [].slice.call(document.querySelectorAll('#codeTiles .code-ch')).map(function(e){return e.textContent}).join('');");
  ok(codeChars === ROOM, 'room code hero renders the code', codeChars);

  await A.ev("document.getElementById('startBtn').click(); return true;");

  const rounds = [];
  for (let r = 0; r < 10; r++) {
    await A.waitFor("document.body.dataset.screen==='play' && document.querySelectorAll('#tiles .tile').length===4", 20000, 'round ' + r + ' question A');
    await B.waitFor("document.body.dataset.screen==='play'", 20000, 'round ' + r + ' question B');
    await sleep(400);

    a = await A.ev(snap);
    ok(a.tiles.length === 4 && a.tiles.every(t => t.txt.trim().length > 0), 'r' + r + ': four answer tiles with text');
    ok(a.correctTiles.length === 0, 'r' + r + ': NO tile marked correct before reveal', a.correctTiles);
    ok(a.tiles.every(t => !t.dis), 'r' + r + ': tiles interactive before answering');

    // the question frame must carry nothing answer-shaped
    const qframe = await A.ev("var f=window.__rx.filter(function(x){return x.m.type==='question'}); return f.length?f[f.length-1]:null;");
    ok(!!qframe, 'r' + r + ': question frame captured');
    if (qframe) {
      const keys = Object.keys(qframe.m).sort().join(',');
      ok(keys === 'category,choices,difficulty,endsAt,index,text,total,type',
        'r' + r + ': question frame keys are exactly the protocol set', keys);
      ok(JSON.stringify(qframe.m).toLowerCase().indexOf('correct') === -1,
        'r' + r + ': question frame contains no "correct" anywhere');
    }
    // and no reveal may exist yet for this round
    const revBefore = await A.ev("return window.__rx.filter(function(x){return x.m.type==='reveal'}).length;");
    ok(revBefore === r, 'r' + r + ': no reveal received before anyone answered', revBefore);

    // A answers 0, B answers 1 — at most one can be right
    const tA = Date.now();
    await A.ev("document.querySelector('#tiles .tile[data-i=\"0\"]').click(); return true;");
    await sleep(500);
    const midRev = await A.ev("return window.__rx.filter(function(x){return x.m.type==='reveal'}).length;");
    ok(midRev === r, 'r' + r + ': still no reveal when only ONE player has answered', midRev);
    const aAfter = await A.ev(snap);
    ok(/locked/i.test(aAfter.lock), 'r' + r + ': A shows ANSWER LOCKED', aAfter.lock);
    ok(/\blocked\b/.test(aAfter.clockCls), 'r' + r + ': A clock goes calm after locking in', aAfter.clockCls);
    ok(aAfter.tiles.filter(t => /picked/.test(t.cls)).length === 1, 'r' + r + ': exactly one tile shown as your pick');

    // B still sees a live clock and no correct marking
    const bMid = await B.ev(snap);
    ok(bMid.correctTiles.length === 0, 'r' + r + ": B sees no answer while A has locked in");
    ok(!/\blocked\b/.test(bMid.clockCls), 'r' + r + ": B's clock still under pressure", bMid.clockCls);

    await B.ev("document.querySelector('#tiles .tile[data-i=\"1\"]').click(); return true;");
    await A.waitFor("window.__rx.filter(function(x){return x.m.type==='reveal'}).length===" + (r + 1), 8000, 'reveal r' + r);
    const tRev = Date.now();
    rounds.push({ answeredBoth: tA, revealAt: tRev });

    await sleep(1400);
    a = await A.ev(snap);
    const rev = await A.ev("var f=window.__rx.filter(function(x){return x.m.type==='reveal'}); return f[f.length-1].m;");
    ok(a.correctTiles.length === 1, 'r' + r + ': exactly one tile flooded as correct', a.correctTiles);
    ok(a.correctTiles[0] === rev.correctIndex, 'r' + r + ': the flooded tile IS the server correctIndex', { dom: a.correctTiles[0], srv: rev.correctIndex });
    const meA = rev.perPlayer.find(p => p.choice === 0);
    ok(!!meA, 'r' + r + ": reveal carries A's choice back");
    if (meA && !meA.correct) {
      ok(a.tiles.some(t => /mywrong/.test(t.cls)), 'r' + r + ': wrong pick gets the quiet crimson ring');
      ok(!a.tiles.some(t => /mywrong/.test(t.cls) && /drained/.test(t.cls)), 'r' + r + ': your wrong pick is not greyed out');
    }
    ok(/got it|Nobody/.test(a.whoGot), 'r' + r + ': who-got-it row rendered', a.whoGot);

    // scoreboard
    await A.waitFor("document.body.dataset.screen==='board'", 12000, 'board r' + r);
    await B.waitFor("document.body.dataset.screen==='board'", 12000, 'board B r' + r);
    await sleep(4500);   // hidden tabs throttle timers; give the count-up room
    a = await A.ev(snap); b = await B.ev(snap);
    ok(a.rows === 2, 'r' + r + ': scoreboard has a row per player', a.rows);
    ok(!!a.boardBtn, 'r' + r + ': host sees the advance button', a.boardBtn);
    ok(b.boardBtn === null, 'r' + r + ': non-host sees no advance button');
    ok(!a.hscroll && !b.hscroll, 'r' + r + ': no horizontal scroll on scoreboard');

    const scores = await A.ev("return [].slice.call(document.querySelectorAll('#boardRows .row')).map(function(x){return {n:x.querySelector('.row-name').textContent, s:x.querySelector('.row-score').textContent}});");
    const scoresB = await B.ev("return [].slice.call(document.querySelectorAll('#boardRows .row')).map(function(x){return {n:x.querySelector('.row-name').textContent, s:x.querySelector('.row-score').textContent}});");
    ok(scoresB.reduce((s2,x)=>s2+parseInt(x.s,10),0) === rev.scores.reduce((s2,x)=>s2+x.score,0), 'r'+r+': scoreboard totals match on the second client', scoresB);
    const srvScores = rev.scores;
    const domTotal = scores.reduce((s, x) => s + parseInt(x.s, 10), 0);
    const srvTotal = srvScores.reduce((s, x) => s + x.score, 0);
    ok(domTotal === srvTotal, 'r' + r + ': scoreboard totals match the server', { domTotal, srvTotal, scores });

    if (r === 9) ok(/Final/i.test(a.boardBtn), 'last round: host button reads Final standings', a.boardBtn);
    await A.ev("document.querySelector('#boardActions button').click(); return true;");
  }

  // ---- final ----
  await A.waitFor("document.body.dataset.screen==='final'", 15000, 'final A');
  await B.waitFor("document.body.dataset.screen==='final'", 15000, 'final B');
  await sleep(3200);
  a = await A.ev(snap); b = await B.ev(snap);
  const fin = await A.ev("var f=window.__rx.filter(function(x){return x.m.type==='final'}); return f[f.length-1].m;");
  ok(a.winner.trim() === fin.standings[0].name, 'final: winner name matches standings[0]', { dom: a.winner, srv: fin.standings[0].name });
  ok(parseInt(a.winnerScore, 10) === fin.standings[0].score, 'final: winner score counted up to the real total', { dom: a.winnerScore, srv: fin.standings[0].score });
  ok(/again/i.test(a.finalBtn || ''), 'final: host sees Play Again', a.finalBtn);
  ok(b.finalBtn === null, 'final: non-host sees no Play Again');
  ok(a.finalRows >= 1, 'final: runners-up listed', a.finalRows);
  ok(!a.hscroll && !b.hscroll, 'final: no horizontal scroll');

  // ---- the whole-session invariant sweep ----
  for (const [nm, tab] of [['A', A], ['B', B]]) {
    const sweep = await tab.ev(`
      var q = window.__rx.filter(function(x){return x.m.type==='question'});
      var bad = [];
      q.forEach(function(x, i){
        var s = JSON.stringify(x.m).toLowerCase();
        ['correct','answerindex','solution','hash'].forEach(function(k){ if (s.indexOf(k)!==-1) bad.push(i+':'+k); });
      });
      var rev = window.__rx.filter(function(x){return x.m.type==='reveal'});
      var ans = window.__tx.filter(function(x){return x.m.type==='answer'});
      return { questions:q.length, reveals:rev.length, answers:ans.length, leaks:bad,
               order: rev.map(function(r,i){ return ans[i] ? (r.t - ans[i].t) : null; }) };
    `);
    ok(sweep.questions === 10, nm + ': received 10 questions', sweep.questions);
    ok(sweep.reveals === 10, nm + ': received 10 reveals', sweep.reveals);
    ok(sweep.leaks.length === 0, nm + ': ZERO answer-shaped data in any question frame', sweep.leaks);
    ok(sweep.order.every(d => d === null || d > 0), nm + ': every reveal arrived AFTER that round was answered', sweep.order);
  }

  // ---- play again ----
  await A.ev("document.querySelector('#finalActions button').click(); return true;");
  await A.waitFor("document.body.dataset.screen==='lobby'", 10000, 'play again -> lobby A');
  await B.waitFor("document.body.dataset.screen==='lobby'", 10000, 'play again -> lobby B');
  await sleep(700);
  a = await A.ev(snap);
  ok(a.seats === 2, 'play again returns everyone to the lobby', a.seats);

  // ---- reconnect / backoff: sever the socket for real ----
  await B.ev("window.__sock.close(); return true;");
  let sawBar = null;
  for (let i = 0; i < 30; i++) { await sleep(300); const s = await B.ev(snap); if (s.netbar) { sawBar = s; break; } }
  ok(!!sawBar, 'a socket that dies without an onclose is still caught', sawBar);
  ok(sawBar && /Lost the connection/i.test(sawBar.netbarText), 'reconnect copy says what happened and what is being done', sawBar && sawBar.netbarText);
  await B.waitFor("!document.getElementById('netbar').classList.contains('on')", 20000, 'auto-reconnect');
  await sleep(900);
  b = await B.ev(snap);
  ok(b.netbar === false, 'auto-retry gets back in on its own');
  ok(b.seats === 2, 'roster intact after reconnect', b.seats);
  const rejoin = await B.ev("var w=window.__rx.filter(function(x){return x.m.type==='welcome'}); return {welcomes:w.length, host:w[w.length-1].m.isHost};");
  ok(rejoin.welcomes >= 2, 'reconnect produced a fresh welcome', rejoin);
  ok(rejoin.host === false, 'reconnecting player did not steal host', rejoin);

  // ---- mobile portrait ----
  await A.cmd('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(700);
  a = await A.ev(snap);
  ok(!a.hscroll, 'portrait 390x844: no horizontal scroll');
  const tapOK = await A.ev(`
    var b = document.getElementById('startBtn');
    var r = b.getBoundingClientRect();
    return { h: Math.round(r.height), w: Math.round(r.width), fits: r.right <= innerWidth + 1 && r.left >= -1 };
  `);
  ok(tapOK.h >= 44 && tapOK.fits, 'portrait: primary control is a real touch target and fits', tapOK);
  await A.cmd('Emulation.clearDeviceMetricsOverride');

} catch (e) {
  fails.push('THREW  ' + (e && e.stack || e));
}

console.log(notes.join('\n'));
console.log('\n================ RESULT ================');
console.log('passed: ' + notes.length + '   failed: ' + fails.length);
if (fails.length) console.log(fails.join('\n'));
process.exit(fails.length ? 1 : 0);
