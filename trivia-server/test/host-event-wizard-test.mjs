// Covers the "Host an event" wizard: a dedicated full-screen flow (steps
// teams -> questions -> timing -> privacy -> share), separate from the
// ordinary lobby screen it hands off to on completion.
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

  // Step 1 of 5 — Teams
  ok(await A.ev("return document.body.dataset.screen;") === 'wizard', 'landed on the wizard screen right after Host an event');
  ok(await A.ev("return document.getElementById('wizStepLabel').textContent;") === 'Step 1 of 5',
     'step label reads "Step 1 of 5"');
  ok(await A.ev("return document.querySelectorAll('.wiz-dot').length;") === 5, 'the progress bar shows 5 dots');
  ok(await A.ev("return document.querySelectorAll('.wiz-dot.now').length;") === 1 &&
     await A.ev("return document.querySelectorAll('.wiz-dot.done').length;") === 0,
     'dot 1 is the current step, none done yet');
  ok(await A.ev("return document.getElementById('wizBackBtn').textContent;") !== '', 'Back/Cancel control is present on step 1');

  // Bump the team count with the stepper's + button, then advance.
  await A.ev(`
    var btns = document.querySelectorAll('.wiz-stepper .wiz-step-btn');
    btns[btns.length - 1].click(); // the LAST stepper's '+' is Teams (only row on this step)
    return true;`);
  await sleep(200);
  ok(await A.ev("return document.querySelector('.wiz-num').value;") === '3', 'team count stepper bumped 2 -> 3');
  await A.ev("document.getElementById('wizNextBtn').click(); return true;");
  await sleep(500);
  // Team cards aren't built until the lobby screen actually renders
  // (renderTeamsPicker runs from renderLobby/paintCallSheet, not
  // renderWizard) — teamSetup having taken effect is confirmed later, once
  // the wizard finishes and hands off to the lobby.

  // Step 2 of 5 — Questions
  ok(await A.ev("return document.getElementById('wizStepLabel').textContent;") === 'Step 2 of 5',
     'advanced to step 2 (Questions)');
  ok(await A.ev("return document.querySelectorAll('.wiz-choice').length;") === 2,
     'two source choices are offered (Topic / Your quiz)');

  // Trying to leave step 2 on "Your quiz" with nothing saved must be refused.
  await A.ev("document.querySelectorAll('.wiz-choice')[1].click(); return true;"); // "Your quiz"
  await sleep(200);
  ok(await A.ev("return document.getElementById('wizQuizSlot').hidden;") === false,
     'the quiz editor slot appears once "Your quiz" is chosen');
  await A.ev("document.getElementById('wizNextBtn').click(); return true;");
  await sleep(300);
  ok(await A.ev("return document.getElementById('wizStepLabel').textContent;") === 'Step 2 of 5',
     'Next is refused on step 2 with no saved questions (still on step 2)');
  const needQuizToast = await A.ev("var a = document.querySelectorAll('.toast'); return a.length ? a[a.length - 1].textContent : null;");
  ok(!!needQuizToast, 'a toast explains the quiz needs at least one saved question', needQuizToast);

  // Write and save exactly one question.
  await A.ev(`
    document.getElementById('quizAddBtn').click();
    var row = document.querySelector('.quiz-row');
    var textInput = row.querySelector('input[type=text]');
    textInput.value = 'Only question';
    textInput.dispatchEvent(new Event('input', { bubbles: true }));
    var choiceInputs = row.querySelectorAll('.quiz-choice input[type=text]');
    var vals = ['A', 'B', 'C', 'D'];
    for (var i = 0; i < 4; i++) { choiceInputs[i].value = vals[i]; choiceInputs[i].dispatchEvent(new Event('input', { bubbles: true })); }
    var radios = row.querySelectorAll('.quiz-choice input[type=radio]');
    radios[0].checked = true;
    radios[0].dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('quizSaveBtn').click();
    return true;`);
  await sleep(400);
  await A.ev("document.getElementById('wizNextBtn').click(); return true;");
  await sleep(300);
  ok(await A.ev("return document.getElementById('wizStepLabel').textContent;") === 'Step 3 of 5',
     'advanced to step 3 (Timing) once one question is saved');

  // Step 3 of 5 — Timing: ask for MORE questions than are saved (1 round of
  // 14), which must now be refused on this step, not discovered later at
  // "Start game" — the actual bug report this guards against. Each click
  // rebuilds the row (renderWizard, via paintCallSheet's settings echo), so
  // the '+' button is re-queried fresh every time — same gotcha
  // quiz-kind-test.mjs already warns about for the quiz-kind cycle button.
  for (let i = 0; i < 4; i++) {
    await A.ev("document.querySelectorAll('.wiz-row')[1].querySelectorAll('.wiz-step-btn')[1].click(); return true;");
    await sleep(350);
  }
  const perRoundVal = await A.ev("return document.querySelectorAll('.wiz-row')[1].querySelector('.wiz-num').value;");
  ok(perRoundVal === '14', 'per-round stepper moved off its default (10 -> 14)', perRoundVal);
  await A.ev("document.getElementById('wizNextBtn').click(); return true;");
  await sleep(300);
  ok(await A.ev("return document.getElementById('wizStepLabel').textContent;") === 'Step 3 of 5',
     'Next is refused on step 3 when 1 saved question cannot cover 1 round of 14 (still on step 3)');
  const fewQToast = await A.ev("var a = document.querySelectorAll('.toast'); return a.length ? a[a.length - 1].textContent : null;");
  ok(!!fewQToast && /1/.test(fewQToast) && /14/.test(fewQToast),
     'the refusal toast names both the saved count and what is actually needed', fewQToast);

  // Bring per-round back down to exactly what was saved (1) via the numeric
  // input's own 'change' handler — a single direct commit, not 13 stepper
  // clicks — and confirm it now passes.
  await A.ev(`
    var inp = document.querySelectorAll('.wiz-row')[1].querySelector('.wiz-num');
    inp.value = '1';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return true;`);
  await sleep(400);
  await A.ev("document.getElementById('wizNextBtn').click(); return true;");
  await sleep(300);
  ok(await A.ev("return document.getElementById('wizStepLabel').textContent;") === 'Step 4 of 5',
     'advanced to step 4 (Privacy) once rounds x per-round matches the saved quiz');

  // Step 4 of 5 — Privacy
  await A.ev("document.querySelectorAll('.wiz-choice')[1].click(); return true;"); // Public
  await sleep(200);
  ok(await A.ev("return document.querySelector('.wiz-choice.on .wiz-choice-t').textContent;") !== '',
     'a privacy choice is selectable and marks itself on');
  await A.ev("document.getElementById('wizNextBtn').click(); return true;");
  await sleep(300);

  // Step 5 of 5 — Share
  ok(await A.ev("return document.getElementById('wizStepLabel').textContent;") === 'Step 5 of 5',
     'advanced to the final step (Share)');
  ok(await A.ev("return /^[A-Z]{4}$/.test(document.querySelector('.wiz-code').textContent);") === true,
     'the room code is shown on the share step');
  ok(await A.ev("return document.querySelectorAll('.wiz-summary dt').length;") >= 4,
     'a setup summary (teams/questions/timing/visibility) is shown');
  ok(await A.ev("return document.getElementById('wizNextBtn').textContent;") !== '',
     'the final button has its "open the lobby" label');

  // Done: lands back on the ordinary (editable) lobby, event not yet open.
  await A.ev("document.getElementById('wizNextBtn').click(); return true;");
  await sleep(400);
  ok(await A.ev("return document.body.dataset.screen;") === 'lobby', 'finishing the wizard lands on the ordinary lobby screen');
  ok(await A.ev("return document.getElementById('startBtn').hidden;") === false,
     'the normal Start/Start-event control is available — the event was not auto-opened');
  ok(await A.ev("return document.querySelectorAll('.team-card').length;") === 3,
     'teamSetup from step 1 actually took — 3 team cards on the lobby screen');

  ok(A.exceptions.length === 0, 'no console exceptions across the whole wizard flow', A.exceptions);

  await A.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.stack || e));
}

notes.forEach((l) => console.log(l));
fails.forEach((l) => console.log(l));
console.log(`passed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
