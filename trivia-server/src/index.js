/**
 * Trivia rooms — server-authoritative game.
 *
 * The client is a renderer. It never learns the correct answer until the
 * server says the question is over. Everything that decides an outcome —
 * which answers are right, when time is up, what a correct answer is worth —
 * lives in here, in one Durable Object per room code.
 *
 * THE INVARIANT: the 'question' message carries text, choices, and a deadline.
 * It carries nothing from which the correct choice can be derived. Choices are
 * shuffled server-side; correctIndex is stored only in the Durable Object and
 * only ever appears in a 'reveal', which is only sent once the timer has
 * expired or every connected player has locked in. If that ever stops being
 * true, this project has no reason to exist.
 *
 * Hibernation: the object gets evicted while people are reading a question.
 * So all game state is persisted under one storage key, reloaded in the
 * constructor, and the question timer is a storage alarm rather than a
 * setTimeout that would die with the isolate.
 */

const ROOM_CODE = /^[A-Z0-9]{4,6}$/;

const MAX_PLAYERS = 8;
// The brief says 2-8 players. Set this to 1 if you want to smoke-test a full
// game from a single browser tab.
const MIN_PLAYERS = 2;

const QUESTION_COUNT = 10;
const QUESTION_MS = 20_000;
const BASE_POINTS = 500; // flat award for a correct answer
const SPEED_POINTS = 500; // additional, scaled linearly on time remaining

const OPENTDB_URL =
  'https://opentdb.com/api.php?amount=10&type=multiple&encode=url3986';
const OPENTDB_TIMEOUT_MS = 6000;
// If a 'start' somehow strands the loading flag (isolate evicted mid-fetch),
// don't wedge the room forever.
const LOADING_STALE_MS = 15_000;

const ALLOWED_ORIGIN = 'https://gonzobonzob-bit.github.io';

/* ------------------------------------------------------------------ *
 * Worker entry — routing, origin check, room-code fan-out
 * ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }

    if (url.pathname !== '/room') {
      return new Response('not found', { status: 404 });
    }

    // Without this, any page on the internet could open a socket against this
    // backend and use it as free realtime infrastructure. Browsers always send
    // Origin on a WebSocket handshake, so a missing one is not a browser.
    if (!originAllowed(request.headers.get('Origin'))) {
      return new Response('forbidden origin', { status: 403 });
    }

    const code = (url.searchParams.get('code') || '').toUpperCase();
    if (!ROOM_CODE.test(code)) {
      return new Response('bad room code', { status: 400 });
    }

    // idFromName is deterministic: the same code always reaches the same
    // object, from anywhere in the world. That is the whole trick.
    const id = env.ROOM.idFromName(code);
    return env.ROOM.get(id).fetch(request);
  },
};

function originAllowed(origin) {
  if (!origin) return false;
  let u;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.origin === ALLOWED_ORIGIN) return true;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/* ------------------------------------------------------------------ *
 * Room
 * ------------------------------------------------------------------ */

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.game = null;

    // Runs before any handler, including after a hibernation wake. The whole
    // game is one storage value, so this is one read.
    ctx.blockConcurrencyWhile(async () => {
      this.game = (await ctx.storage.get('game')) || freshGame();
    });
  }

  async ensure() {
    if (!this.game) {
      this.game = (await this.ctx.storage.get('game')) || freshGame();
    }
    return this.game;
  }

  async save() {
    await this.ctx.storage.put('game', this.game);
  }

  /* ---------------- connection ---------------- */

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }

    const g = await this.ensure();
    const url = new URL(request.url);
    const name = sanitizeName(url.searchParams.get('name'));
    const key = name.toLowerCase();

    // Ghost records only earn their keep once a game is running (they hold a
    // score for a reconnect). In the lobby they are just clutter blocking seats.
    if (g.phase === 'lobby') this.pruneDisconnected();

    let player = Object.values(g.players).find((p) => p.key === key);
    const rejoin = Boolean(player);

    if (!player) {
      if (Object.keys(g.players).length >= MAX_PLAYERS) {
        return new Response('room full', { status: 403 });
      }
      player = {
        id: crypto.randomUUID(),
        key,
        name,
        score: 0,
        joinedAt: Date.now(),
        connectedAt: Date.now(),
      };
      g.players[player.id] = player;
    } else {
      player.name = name; // keep the latest capitalisation
      player.connectedAt = Date.now();
    }

    // First player in is host; also covers the case where the stored host is
    // no longer a player at all.
    if (!g.hostId || !g.players[g.hostId]) g.hostId = player.id;

    const [client, server] = Object.values(new WebSocketPair());

    // Hibernation API: the object can be evicted from memory while these
    // sockets stay open, so a room full of people thinking about a question
    // costs nothing. Plain .accept() would keep it resident and billing.
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ pid: player.id });

    // Same name, same room, second live socket: treat it as a resumed session
    // and drop the stale one. Done AFTER accepting the replacement so the close
    // handler still sees this player as connected and won't reassign the host.
    if (rejoin) {
      for (const s of this.ctx.getWebSockets()) {
        if (s === server) continue;
        const a = s.deserializeAttachment() || {};
        if (a.pid === player.id) {
          try {
            s.close(4000, 'replaced by a newer connection');
          } catch {
            /* already gone */
          }
        }
      }
    }

    await this.save();

    this.send(server, {
      type: 'welcome',
      you: { id: player.id, name: player.name },
      isHost: g.hostId === player.id,
      phase: g.phase,
    });
    this.broadcastRoster();
    this.catchUp(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  /** Bring a socket that arrived mid-game up to the current phase. */
  catchUp(ws) {
    const g = this.game;
    if (g.phase === 'question' && g.questions[g.qIndex]) {
      this.send(ws, this.questionMessage());
      // Replay who has already locked in — playerId only, no answer content.
      for (const pid of Object.keys(g.answers)) {
        this.send(ws, { type: 'answered', playerId: pid });
      }
    } else if (g.phase === 'reveal' && g.lastReveal) {
      this.send(ws, g.lastReveal);
    } else if (g.phase === 'final') {
      this.send(ws, this.finalMessage());
    }
  }

  /* ---------------- messaging ---------------- */

  send(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // socket already gone; the close handler tidies the roster
    }
  }

  broadcast(payload, sockets = null) {
    const msg = JSON.stringify(payload);
    for (const ws of sockets || this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  connectedPids(sockets = null) {
    const set = new Set();
    for (const ws of sockets || this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.pid) set.add(a.pid);
    }
    return set;
  }

  roster(sockets = null) {
    const g = this.game;
    const connected = this.connectedPids(sockets);
    return Object.values(g.players)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        isHost: p.id === g.hostId,
        connected: connected.has(p.id),
      }));
  }

  broadcastRoster(sockets = null) {
    this.broadcast({ type: 'roster', players: this.roster(sockets) }, sockets);
  }

  pruneDisconnected() {
    const g = this.game;
    const connected = this.connectedPids();
    for (const pid of Object.keys(g.players)) {
      if (!connected.has(pid)) delete g.players[pid];
    }
    if (!g.players[g.hostId]) g.hostId = null;
  }

  /** The only place a question is turned into something a client may see. */
  questionMessage() {
    const g = this.game;
    const q = g.questions[g.qIndex];
    // Built field by field on purpose. No spread, no serialising the stored
    // record — that is how correctIndex leaks.
    return {
      type: 'question',
      index: g.qIndex,
      total: g.questions.length,
      text: q.text,
      choices: q.choices.slice(),
      endsAt: g.endsAt,
      category: q.category,
      difficulty: q.difficulty,
    };
  }

  finalMessage() {
    const g = this.game;
    const standings = Object.values(g.players)
      .map((p) => ({ id: p.id, name: p.name, score: p.score }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return { type: 'final', standings };
  }

  /* ---------------- client -> server ---------------- */

  async webSocketMessage(ws, raw) {
    try {
      const g = await this.ensure();
      const a = ws.deserializeAttachment() || {};
      const me = g.players[a.pid];
      if (!me) return;

      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        return this.send(ws, { type: 'error', message: 'malformed message' });
      }
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'start':
          return await this.onStart(ws, me);
        case 'answer':
          return await this.onAnswer(ws, me, data);
        case 'next':
          return await this.onNext(ws, me);
        case 'again':
          return await this.onAgain(ws, me);
        default:
          return this.send(ws, { type: 'error', message: 'unknown message type' });
      }
    } catch (err) {
      this.send(ws, { type: 'error', message: 'server error' });
    }
  }

  async onStart(ws, me) {
    const g = this.game;
    if (me.id !== g.hostId) {
      return this.send(ws, { type: 'error', message: 'only the host can start the game' });
    }
    if (g.phase !== 'lobby') {
      return this.send(ws, { type: 'error', message: 'a game is already in progress' });
    }
    if (g.loadingAt && Date.now() - g.loadingAt < LOADING_STALE_MS) {
      return this.send(ws, { type: 'error', message: 'already fetching questions' });
    }
    const connected = this.connectedPids().size;
    if (connected < MIN_PLAYERS) {
      return this.send(ws, {
        type: 'error',
        message: `need at least ${MIN_PLAYERS} players to start`,
      });
    }

    g.loadingAt = Date.now();
    await this.save();

    let questions;
    try {
      questions = await this.loadQuestions();
    } finally {
      g.loadingAt = 0;
    }

    // A start is also a reset: nobody carries a score in from a previous round.
    for (const p of Object.values(g.players)) p.score = 0;
    g.questions = questions;
    g.answers = {};
    g.lastReveal = null;
    await this.save();

    await this.beginQuestion(0);
  }

  async onAnswer(ws, me, data) {
    const g = this.game;
    if (g.phase !== 'question') {
      return this.send(ws, { type: 'error', message: 'no question is open' });
    }
    // The index guard is the whole point of shipping index in the message:
    // an answer for the previous question must not land on this one.
    if (!Number.isInteger(data.index) || data.index !== g.qIndex) return;

    const choice = data.choice;
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) {
      return this.send(ws, { type: 'error', message: 'bad choice' });
    }
    if (g.answers[me.id]) {
      return this.send(ws, { type: 'error', message: 'you already answered' });
    }

    // Phase is the authority on whether the window is open, not the clock —
    // a click at 19.9s that arrives at 20.1s still counts, and the speed bonus
    // clamps to zero rather than going negative.
    g.answers[me.id] = { choice, at: Date.now() };
    await this.save();

    this.broadcast({ type: 'answered', playerId: me.id });

    if (this.allConnectedAnswered()) await this.doReveal();
  }

  async onNext(ws, me) {
    const g = this.game;
    if (me.id !== g.hostId) {
      return this.send(ws, { type: 'error', message: 'only the host can advance' });
    }
    if (g.phase !== 'reveal') {
      return this.send(ws, { type: 'error', message: 'nothing to advance from' });
    }
    const next = g.qIndex + 1;
    if (next >= g.questions.length) return await this.finish();
    return await this.beginQuestion(next);
  }

  async onAgain(ws, me) {
    const g = this.game;
    if (me.id !== g.hostId) {
      return this.send(ws, { type: 'error', message: 'only the host can restart' });
    }
    if (g.phase !== 'final') {
      return this.send(ws, { type: 'error', message: 'the game is not over' });
    }
    for (const p of Object.values(g.players)) p.score = 0;
    g.phase = 'lobby';
    g.questions = [];
    g.qIndex = -1;
    g.endsAt = 0;
    g.answers = {};
    g.lastReveal = null;
    this.pruneDisconnected();
    if (!g.hostId) g.hostId = me.id;
    await this.ctx.storage.deleteAlarm();
    await this.save();

    this.broadcast({ type: 'phase', phase: 'lobby' });
    this.broadcastRoster();
  }

  /* ---------------- state machine ---------------- */

  async beginQuestion(index) {
    const g = this.game;
    g.qIndex = index;
    g.phase = 'question';
    g.answers = {};
    g.lastReveal = null;
    g.endsAt = Date.now() + QUESTION_MS;
    await this.save();

    // An alarm, not a timer: it survives the object being evicted while eight
    // people stare at a question for twenty seconds.
    await this.ctx.storage.setAlarm(g.endsAt);

    this.broadcast({ type: 'phase', phase: 'question' });
    this.broadcast(this.questionMessage());
  }

  allConnectedAnswered() {
    const g = this.game;
    const pids = [...this.connectedPids()];
    if (pids.length === 0) return false; // let the alarm handle an empty room
    return pids.every((pid) => Boolean(g.answers[pid]));
  }

  async doReveal() {
    const g = this.game;
    if (g.phase !== 'question') return;
    const q = g.questions[g.qIndex];
    if (!q) return;

    const perPlayer = [];
    const scores = [];
    for (const p of Object.values(g.players)) {
      const ans = g.answers[p.id];
      const choice = ans ? ans.choice : null;
      const correct = choice !== null && choice === q.correctIndex;
      let gained = 0;
      if (correct) {
        const remaining = Math.max(0, Math.min(QUESTION_MS, g.endsAt - ans.at));
        gained = BASE_POINTS + Math.round((SPEED_POINTS * remaining) / QUESTION_MS);
        p.score += gained;
      }
      perPlayer.push({ id: p.id, choice, correct, gained });
      scores.push({ id: p.id, score: p.score });
    }

    g.phase = 'reveal';
    g.lastReveal = { type: 'reveal', correctIndex: q.correctIndex, perPlayer, scores };
    await this.ctx.storage.deleteAlarm();
    await this.save();

    this.broadcast({ type: 'phase', phase: 'reveal' });
    this.broadcast(g.lastReveal);
    this.broadcastRoster();
  }

  async finish() {
    const g = this.game;
    g.phase = 'final';
    g.endsAt = 0;
    await this.ctx.storage.deleteAlarm();
    await this.save();

    this.broadcast({ type: 'phase', phase: 'final' });
    this.broadcast(this.finalMessage());
  }

  async alarm() {
    const g = await this.ensure();
    if (g.phase !== 'question') return;
    // Alarms can fire a little early after a rescheduling; re-arm rather than
    // cutting a question short.
    if (Date.now() < g.endsAt - 50) {
      await this.ctx.storage.setAlarm(g.endsAt);
      return;
    }
    await this.doReveal();
  }

  /* ---------------- disconnects ---------------- */

  async webSocketClose(ws) {
    const g = await this.ensure();

    // getWebSockets() still includes this socket during the close handler,
    // so filter it out rather than trusting the raw list.
    const remaining = this.ctx.getWebSockets().filter((s) => s !== ws);
    const connected = this.connectedPids(remaining);

    // Host left: promote the player who has been connected the longest.
    if (g.hostId && !connected.has(g.hostId)) {
      const candidates = Object.values(g.players)
        .filter((p) => connected.has(p.id))
        .sort((a, b) => a.connectedAt - b.connectedAt || a.joinedAt - b.joinedAt);
      // If the room is empty, keep the record — whoever comes back keeps it.
      if (candidates.length) g.hostId = candidates[0].id;
    }

    // In the lobby a dropped player has nothing worth preserving.
    if (g.phase === 'lobby') {
      for (const pid of Object.keys(g.players)) {
        if (!connected.has(pid)) delete g.players[pid];
      }
      if (!g.players[g.hostId]) {
        const first = Object.values(g.players).sort((a, b) => a.joinedAt - b.joinedAt)[0];
        g.hostId = first ? first.id : null;
      }
    }

    await this.save();
    this.broadcastRoster(remaining);

    // The player who just left may have been the last one still thinking.
    if (g.phase === 'question') {
      const pids = [...connected];
      if (pids.length > 0 && pids.every((pid) => Boolean(g.answers[pid]))) {
        await this.doReveal();
      }
    }
  }

  async webSocketError(ws) {
    return this.webSocketClose(ws);
  }

  /* ---------------- questions ---------------- */

  /**
   * Live batch from Open Trivia DB, topped up or wholly replaced by the
   * bundled pack. The game never hard-fails because a third party is down.
   */
  async loadQuestions() {
    let questions = [];
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), OPENTDB_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(OPENTDB_URL, {
          signal: ctrl.signal,
          headers: { accept: 'application/json' },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) throw new Error('opentdb http ' + res.status);
      const body = await res.json();
      // response_code 0 is the only success code; everything else means the
      // results array is not usable.
      if (body.response_code !== 0 || !Array.isArray(body.results)) {
        throw new Error('opentdb response_code ' + body.response_code);
      }
      questions = body.results.map(fromOpenTdb).filter(Boolean);
    } catch {
      questions = [];
    }

    if (questions.length < QUESTION_COUNT) {
      const seen = new Set(questions.map((q) => q.text));
      for (const src of shuffle(FALLBACK_PACK)) {
        if (questions.length >= QUESTION_COUNT) break;
        if (seen.has(src.text)) continue;
        seen.add(src.text);
        questions.push(buildQuestion(src));
      }
    }

    return questions.slice(0, QUESTION_COUNT);
  }
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function freshGame() {
  return {
    phase: 'lobby',
    players: {}, // id -> {id, key, name, score, joinedAt, connectedAt}
    hostId: null,
    questions: [], // {text, choices[4], correctIndex, category, difficulty}
    qIndex: -1,
    endsAt: 0,
    answers: {}, // playerId -> {choice, at}
    lastReveal: null,
    loadingAt: 0,
  };
}

function sanitizeName(raw) {
  const s = String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 16);
  return s || 'anon';
}

/** A Worker has no DOM, so the API is asked for url3986 and decoded here. */
function decodeField(value) {
  try {
    return decodeURIComponent(String(value == null ? '' : value));
  } catch {
    return String(value == null ? '' : value);
  }
}

function fromOpenTdb(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = decodeField(raw.question).trim();
  const correct = decodeField(raw.correct_answer).trim();
  const wrongAll = Array.isArray(raw.incorrect_answers)
    ? raw.incorrect_answers.map((w) => decodeField(w).trim())
    : [];

  // A distractor identical to the answer would make one of two identical
  // buttons "wrong". Drop the question rather than ship that.
  const wrong = [];
  for (const w of wrongAll) {
    if (!w || w === correct || wrong.includes(w)) continue;
    wrong.push(w);
  }
  if (!text || !correct || wrong.length < 3) return null;

  return buildQuestion({
    text,
    correct,
    wrong: wrong.slice(0, 3),
    category: decodeField(raw.category) || 'General Knowledge',
    difficulty: decodeField(raw.difficulty) || 'medium',
  });
}

/** correctIndex is decided here and never leaves the server. */
function buildQuestion(src) {
  const choices = shuffle([src.correct, ...src.wrong]);
  return {
    text: src.text,
    choices,
    correctIndex: choices.indexOf(src.correct),
    category: src.category,
    difficulty: src.difficulty,
  };
}

function shuffle(input) {
  const a = input.slice();
  if (a.length < 2) return a;
  const rnd = new Uint32Array(a.length);
  crypto.getRandomValues(rnd);
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * Bundled fallback. Used when Open Trivia DB is down, slow, or rate-limited,
 * and to top up a short batch. Deliberately evergreen — no question whose
 * answer changes with time.
 */
const FALLBACK_PACK = [
  {
    text: 'What is the capital city of Australia?',
    correct: 'Canberra',
    wrong: ['Sydney', 'Melbourne', 'Perth'],
    category: 'Geography',
    difficulty: 'easy',
  },
  {
    text: 'Which planet in our solar system is closest to the Sun?',
    correct: 'Mercury',
    wrong: ['Venus', 'Mars', 'Earth'],
    category: 'Science: Nature',
    difficulty: 'easy',
  },
  {
    text: "Who wrote the novel 'Nineteen Eighty-Four'?",
    correct: 'George Orwell',
    wrong: ['Aldous Huxley', 'Ray Bradbury', 'H. G. Wells'],
    category: 'Entertainment: Books',
    difficulty: 'easy',
  },
  {
    text: 'What is the chemical symbol for gold?',
    correct: 'Au',
    wrong: ['Ag', 'Gd', 'Go'],
    category: 'Science & Nature',
    difficulty: 'easy',
  },
  {
    text: 'In which year did the Berlin Wall fall?',
    correct: '1989',
    wrong: ['1987', '1991', '1993'],
    category: 'History',
    difficulty: 'medium',
  },
  {
    text: 'Which element has the atomic number 1?',
    correct: 'Hydrogen',
    wrong: ['Helium', 'Oxygen', 'Carbon'],
    category: 'Science & Nature',
    difficulty: 'easy',
  },
  {
    text: "What is Earth's largest ocean?",
    correct: 'The Pacific Ocean',
    wrong: ['The Atlantic Ocean', 'The Indian Ocean', 'The Arctic Ocean'],
    category: 'Geography',
    difficulty: 'easy',
  },
  {
    text: "Which artist painted 'The Starry Night'?",
    correct: 'Vincent van Gogh',
    wrong: ['Claude Monet', 'Pablo Picasso', 'Salvador Dali'],
    category: 'Art',
    difficulty: 'easy',
  },
  {
    text: 'How many strings does a standard violin have?',
    correct: 'Four',
    wrong: ['Six', 'Five', 'Three'],
    category: 'Entertainment: Music',
    difficulty: 'easy',
  },
  {
    text: 'What is the longest river in South America?',
    correct: 'The Amazon',
    wrong: ['The Parana', 'The Orinoco', 'The Rio Negro'],
    category: 'Geography',
    difficulty: 'medium',
  },
  {
    text: 'Which programming language was created by Brendan Eich in 1995?',
    correct: 'JavaScript',
    wrong: ['Python', 'Java', 'Ruby'],
    category: 'Science: Computers',
    difficulty: 'medium',
  },
  {
    text: 'What is the hardest naturally occurring substance on Earth?',
    correct: 'Diamond',
    wrong: ['Quartz', 'Titanium', 'Obsidian'],
    category: 'Science & Nature',
    difficulty: 'easy',
  },
];
