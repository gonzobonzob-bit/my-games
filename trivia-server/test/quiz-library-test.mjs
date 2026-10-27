// Protocol-level tests for the per-room quiz library: saving a quiz under
// a name, listing/loading/deleting saved quizzes, and that the plain
// unnamed save path (today's existing behavior) is completely unaffected.
// Same raw-socket style as teams-test.mjs.
import WS from 'ws';

const ORIGIN = 'http://localhost:8000';
const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class C {
  constructor(name, room) { this.name = name; this.room = room; this.msgs = []; }
  connect() {
    const url = `ws://localhost:8787/room?code=${this.room}&name=${encodeURIComponent(this.name)}`;
    this.ws = new WS(url, { origin: ORIGIN });
    this.ws.on('message', (r) => this.msgs.push(JSON.parse(r.toString())));
    return new Promise((res, rej) => {
      this.ws.once('open', res);
      this.ws.once('error', rej);
      setTimeout(() => rej(new Error(this.name + ' connect timeout')), 8000);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  last(t) { return [...this.msgs].reverse().find((m) => m.type === t); }
  async wait(t, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = this.last(t); if (m) return m; await sleep(60); }
    throw new Error(`${this.name}: no '${t}' in ${ms}ms`);
  }
  async waitFor(pred, ms = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = this.msgs.find(pred); if (m) return m; await sleep(60); }
    throw new Error(`${this.name}: predicate never matched in ${ms}ms`);
  }
  close() { try { this.ws.close(); } catch {} }
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const room = () => Array.from({ length: 6 },
  () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

function geography() {
  return [{ text: 'Capital of France?', choices: ['Paris', 'Rome', 'Berlin', 'Madrid'], correctIndex: 0 }];
}
function movies() {
  return [
    { text: 'Who directed Jaws?', choices: ['Spielberg', 'Lucas', 'Scorsese', 'Coppola'], correctIndex: 0 },
    { text: 'Year Titanic released?', choices: ['1997', '1999', '1995', '2001'], correctIndex: 0 },
  ];
}

try {
  const r = room();
  const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
  const B = new C('Ben', r); await B.connect(); await B.wait('welcome');

  A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'custom', rounds: 1, questionsPerRound: 1, questionMs: 20000 } });
  await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');

  // ---- Backward compatible: no name, no library entry -------------------
  A.send({ type: 'questions', items: geography() });
  await A.wait('customQuestions');
  A.msgs.length = 0;
  A.send({ type: 'getQuizLibrary' });
  const emptyLib = await A.wait('quizLibrary', 4000);
  ok(emptyLib.items.length === 0, 'an unnamed save creates no library entry — today\'s behavior untouched', emptyLib);

  // ---- Non-host refused everywhere ---------------------------------------
  B.msgs.length = 0;
  B.send({ type: 'getQuizLibrary' });
  const notHost1 = await B.wait('error');
  ok(/only the host/i.test(notHost1.message || ''), 'getQuizLibrary from a non-host is refused', notHost1);
  B.send({ type: 'loadQuiz', id: 'x' });
  const notHost2 = await B.wait('error');
  ok(/only the host/i.test(notHost2.message || ''), 'loadQuiz from a non-host is refused', notHost2);
  B.send({ type: 'deleteQuiz', id: 'x' });
  const notHost3 = await B.wait('error');
  ok(/only the host/i.test(notHost3.message || ''), 'deleteQuiz from a non-host is refused', notHost3);

  // ---- Named save actually creates a library entry -----------------------
  A.send({ type: 'questions', items: geography(), name: 'Geography' });
  await A.wait('customQuestions');
  A.msgs.length = 0;
  A.send({ type: 'getQuizLibrary' });
  const lib1 = await A.wait('quizLibrary', 4000);
  ok(lib1.items.length === 1 && lib1.items[0].name === 'Geography' && lib1.items[0].count === 1,
     'a named save shows up in the library with its name and question count', lib1.items);
  const geoId = lib1.items[0].id;

  // ---- A second, different-named quiz adds, doesn't replace --------------
  A.send({ type: 'questions', items: movies(), name: 'Movies' });
  await A.wait('customQuestions');
  A.msgs.length = 0;
  A.send({ type: 'getQuizLibrary' });
  const lib2 = await A.wait('quizLibrary', 4000);
  ok(lib2.items.length === 2, 'a second named save adds a second entry, not replacing the first', lib2.items);
  const movieEntry = lib2.items.find((q) => q.name === 'Movies');
  ok(movieEntry && movieEntry.count === 2, 'the second entry has its own question count', movieEntry);

  // ---- Re-saving under the SAME name overwrites, not duplicates ----------
  A.send({ type: 'questions', items: [...geography(), { text: 'Extra Q', choices: ['A', 'B', 'C', 'D'], correctIndex: 1 }], name: 'Geography' });
  await A.wait('customQuestions');
  A.msgs.length = 0;
  A.send({ type: 'getQuizLibrary' });
  const lib3 = await A.wait('quizLibrary', 4000);
  ok(lib3.items.length === 2, 'saving under an existing name overwrites it, not a third entry', lib3.items);
  const geoAfter = lib3.items.find((q) => q.name === 'Geography');
  ok(geoAfter && geoAfter.count === 2 && geoAfter.id === geoId,
     'the overwritten entry keeps the SAME id, with the updated question count', geoAfter);

  // ---- Loading a saved quiz makes it the active one AND returns content -
  // First switch the active quiz to Movies, so loading Geography back is a
  // real, visible change.
  A.send({ type: 'questions', items: movies() }); // unnamed — just changes what's active
  await A.wait('customQuestions');
  A.msgs.length = 0;
  A.send({ type: 'loadQuiz', id: geoId });
  const loaded = await A.wait('customQuestionsFull', 4000);
  ok(loaded.id === geoId && loaded.name === 'Geography', 'loadQuiz answers with the id and name of what was loaded', loaded);
  ok(loaded.items.length === 2, 'and the real content, including the edit from the overwrite above', loaded.items);
  const countAfterLoad = await A.wait('customQuestions', 4000);
  ok(countAfterLoad.count === 2, 'loadQuiz also makes it the ACTIVE quiz (onStart would play this one now)', countAfterLoad);

  // ---- loadQuiz on a nonexistent id is refused ---------------------------
  A.msgs.length = 0;
  A.send({ type: 'loadQuiz', id: 'does-not-exist' });
  const noSuchQuiz = await A.wait('error', 4000);
  ok(/no longer exists/i.test(noSuchQuiz.message || ''), 'loadQuiz on an unknown id is refused', noSuchQuiz);

  // ---- Deleting removes the library entry but not the ACTIVE quiz --------
  A.send({ type: 'deleteQuiz', id: geoId });
  const afterDelete = await A.wait('quizLibrary', 4000);
  ok(afterDelete.items.length === 1 && afterDelete.items[0].name === 'Movies',
     'deleteQuiz removes only that entry, Movies is untouched', afterDelete.items);
  A.msgs.length = 0;
  A.send({ type: 'getCustomQuestions' });
  const stillActive = await A.wait('customQuestionsFull', 4000);
  ok(stillActive.items.length === 2 && stillActive.items[0].text === 'Capital of France?',
     'the ACTIVE quiz (still Geography, loaded above) is unaffected by deleting its library entry', stillActive.items);

  // ---- Deleting an already-gone id is refused -----------------------------
  A.msgs.length = 0;
  A.send({ type: 'deleteQuiz', id: geoId });
  const alreadyGone = await A.wait('error', 4000);
  ok(/no longer exists/i.test(alreadyGone.message || ''), 'deleting an already-deleted id is refused, not silently ok', alreadyGone);

  // ---- Lobby-only, same as getCustomQuestions ------------------------------
  A.send({ type: 'teamSetup', count: 1, names: ['Solo'] });
  await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 1);
  B.send({ type: 'joinTeam', teamId: A.last('roster').teams[0].id });
  await B.waitFor((m) => m.type === 'roster');
  A.send({ type: 'openEvent' });
  await A.wait('phase');
  A.msgs.length = 0;
  A.send({ type: 'loadQuiz', id: 'anything' });
  const closedLoad = await A.wait('error', 4000);
  ok(/edit setup/i.test(closedLoad.message || ''), 'loadQuiz is refused once standby has started', closedLoad);
  A.msgs.length = 0;
  A.send({ type: 'deleteQuiz', id: 'anything' });
  const closedDelete = await A.wait('error', 4000);
  ok(/edit setup/i.test(closedDelete.message || ''), 'deleteQuiz is refused once standby has started too', closedDelete);

  A.close(); B.close();
} catch (e) {
  fails.push('FAIL  threw :: ' + (e && e.stack || e));
}

notes.forEach((l) => console.log(l));
fails.forEach((l) => console.log(l));
console.log(`passed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
