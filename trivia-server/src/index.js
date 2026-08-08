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
// One is a legitimate way to play, not just a way to smoke-test. A solo game
// runs the identical loop: the reveal fires as soon as every CONNECTED player
// has answered, and with one player that is immediate — no waiting out the
// clock, which makes solo the fastest version of the game rather than the
// most tedious. Others can still join a room that started alone; catchUp()
// brings them in mid-question.
const MIN_PLAYERS = 1;

const QUESTION_COUNT = 10;
const QUESTION_MS = 20_000;
/* Reveal → next question, measured from the reveal broadcast — including the
 * early reveal when everyone has locked in, which is why solo stays brisk.
 * Six seconds: long enough to read the answer and watch the scores move, not
 * long enough to reach for your phone. The room advances ITSELF on this
 * deadline; the host's Next button survives only as a way to skip the wait,
 * so a game never again stalls on a host who tabbed away. Consequence worth
 * knowing: a room abandoned mid-game now plays itself out to the podium
 * (ten alarms, ~4 minutes) instead of freezing on its last reveal — that is
 * cheaper than special-casing an empty room and risking the one bug this
 * design exists to avoid, a phase nothing ever advances. */
const REVEAL_MS = 6_000;
const BASE_POINTS = 500; // flat award for a correct answer
const SPEED_POINTS = 500; // additional, scaled linearly on time remaining

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
      this.game = normalizeGame((await ctx.storage.get('game')) || freshGame());
    });
  }

  async ensure() {
    if (!this.game) {
      this.game = normalizeGame((await this.ctx.storage.get('game')) || freshGame());
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
        lang: sanitizeLang(url.searchParams.get('lang')),
      };
      g.players[player.id] = player;
    } else {
      player.name = name; // keep the latest capitalisation
      player.connectedAt = Date.now();
      player.lang = sanitizeLang(url.searchParams.get('lang'));
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
      settings: g.settings,
      catalog: catalog(),
      difficulties: DIFFICULTIES.slice(),
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
      // Every language of the SAME question, in the same slot order. This
      // carries no more information than `choices` already does — it is the
      // same four options written twice — so the invariant is untouched.
      // Still built field by field, like everything else in here.
      i18n: q.i18n ? { es: { text: q.i18n.es.text, choices: q.i18n.es.choices.slice() } } : undefined,
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
        case 'lang':
          return await this.onLang(ws, me, data);
        case 'settings':
          return await this.onSettings(ws, me, data);
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

  /* Language is per player, not per room — two people at the same table can
     read different languages. It is only ever a rendering choice, so it may be
     changed at any time, including mid-question; the questions already on the
     wire carry every language. */
  async onLang(ws, me, data) {
    const g = this.game;
    const next = sanitizeLang(data.lang);
    const p = g.players[me.id];
    if (!p || p.lang === next) return;
    p.lang = next;
    await this.save();
    // The lobby needs to know whether the room now requires Spanish questions.
    if (g.phase === 'lobby') this.broadcastRoster();
  }

  /* True when anybody connected is reading something other than English.
     Deliberately a room-level question: the questions are fetched once for
     everyone, so one Spanish reader decides the source for the whole table. */
  needsBilingual() {
    const g = this.game;
    const connected = this.connectedPids();
    for (const pid of connected) {
      const p = g.players[pid];
      if (p && p.lang && p.lang !== 'en') return true;
    }
    return false;
  }

  async onSettings(ws, me, data) {
    const g = this.game;
    if (me.id !== g.hostId) {
      return this.send(ws, { type: 'error', message: 'only the host can change the game' });
    }
    if (g.phase !== 'lobby') {
      return this.send(ws, { type: 'error', message: 'the game has already started' });
    }
    // Changing the genre while loadQuestions() is already in flight would have
    // no effect on the questions being fetched but would tell everyone it did.
    if (g.loadingAt && Date.now() - g.loadingAt < LOADING_STALE_MS) {
      return this.send(ws, { type: 'error', message: 'the game is already starting' });
    }
    g.settings = sanitizeSettings(data.settings);
    await this.save();
    // Everyone sees the choice, not just the host — a lobby where only one
    // person can see what is about to be played is a dead screen for the rest.
    this.broadcast({ type: 'settings', settings: g.settings });
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

    // Frozen BEFORE the await. The host could otherwise change the genre
    // mid-fetch and the questions would not match what the lobby last showed.
    const snap = sanitizeSettings(g.settings);
    // Checked BEFORE anything is fetched or mutated, so the refusal costs
    // nothing and the room stays in the lobby.
    const bilingual = this.needsBilingual();
    if (bilingual && !langsFor(snap.genre).includes('es')) {
      return this.send(ws, {
        type: 'error',
        code: 'noLang', genre: GENRES[snap.genre].label,
        message: GENRES[snap.genre].label + ' has no Spanish questions yet. ' +
                 'Pick another genre, or switch everyone to English.',
      });
    }

    g.loadingAt = Date.now();
    await this.save();

    let loaded;
    try {
      loaded = await this.loadQuestions(snap, new Set(g.recentTexts || []), bilingual);
    } catch (err) {
      // Refusing is the correct outcome, not an error to paper over: the one
      // thing worse than not starting is starting with the wrong genre. The
      // client's existing error handler re-enables the Start button, so the
      // host can just pick something else.
      g.loadingAt = 0;
      await this.save();
      return this.send(ws, {
        type: 'error',
        code: 'noQuestions', genre: GENRES[snap.genre].label, count: QUESTION_COUNT,
        message: 'Could not find ' + QUESTION_COUNT + ' ' + GENRES[snap.genre].label +
                 ' questions right now. Try another genre, or Mixed.',
      });
    } finally {
      g.loadingAt = 0;
    }
    const questions = loaded.questions;

    // A start is also a reset: nobody carries a score in from a previous round.
    for (const p of Object.values(g.players)) p.score = 0;
    g.questions = questions;
    g.answers = {};
    g.lastReveal = null;
    // Remember what was just used so the next game in this room differs.
    g.recentTexts = [...questions.map((q) => q.text), ...(g.recentTexts || [])]
      .slice(0, RECENT_CAP);
    await this.save();

    await this.beginQuestion(0);

    // Said plainly, once, and only when the whole set came from the bundled
    // pack. A partly-topped-up game is still entirely the right genre, so it
    // says nothing — the promise was genre, and the promise held.
    if (loaded.bilingual) {
      // Not a failure: this is the only source that HAS Spanish, so it was
      // never going to come from the live one. Saying "Open Trivia DB did not
      // answer" here would be a lie.
      this.broadcast({
        type: 'notice',
        code: 'bilingual', genre: GENRES[snap.genre].label,
        message: 'Bilingual set — ' + GENRES[snap.genre].label +
                 '. Everyone can read these in their own language.',
      });
    } else if (loaded.offline) {
      this.broadcast({
        type: 'notice',
        code: 'offline', genre: GENRES[snap.genre].label,
        message: 'Offline pack — ' + GENRES[snap.genre].label +
                 '. Open Trivia DB did not answer, so these are from the built-in set.',
      });
    }
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

  /* Since auto-advance, 'next' is a skip, not a necessity: the reveal alarm
     advances the room on its own, and a host in a hurry may jump the queue.
     beginQuestion re-arms the one alarm slot, so the pending reveal deadline
     is overwritten rather than left to fire into the wrong phase. */
  async onNext(ws, me) {
    const g = this.game;
    if (me.id !== g.hostId) {
      return this.send(ws, { type: 'error', message: 'only the host can advance' });
    }
    if (g.phase !== 'reveal') {
      return this.send(ws, { type: 'error', message: 'nothing to advance from' });
    }
    return await this.advance();
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
    g.nextAt = 0;
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
    g.nextAt = 0;
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
    // The one alarm slot changes hands here: the question deadline is done
    // (or cut short by everyone answering) and the reveal deadline takes the
    // slot. setAlarm overwrites, so no deleteAlarm is needed — and nextAt
    // rides in the reveal so every client can draw the same countdown.
    g.nextAt = Date.now() + REVEAL_MS;
    g.lastReveal = {
      type: 'reveal', correctIndex: q.correctIndex, perPlayer, scores,
      nextAt: g.nextAt,
    };
    await this.save();
    await this.ctx.storage.setAlarm(g.nextAt);

    this.broadcast({ type: 'phase', phase: 'reveal' });
    this.broadcast(g.lastReveal);
    this.broadcastRoster();
  }

  /* The one step forward from a reveal, whoever asks for it — the six-second
     alarm or a host in a hurry. Both callers verify phase === 'reveal' is
     still true (the alarm via its dispatch case, onNext via its guard), and
     the check is repeated here so a third caller cannot skip it. */
  async advance() {
    const g = this.game;
    if (g.phase !== 'reveal') return;
    const next = g.qIndex + 1;
    if (next >= g.questions.length) return await this.finish();
    return await this.beginQuestion(next);
  }

  async finish() {
    const g = this.game;
    g.phase = 'final';
    g.endsAt = 0;
    g.nextAt = 0;
    await this.ctx.storage.deleteAlarm();
    await this.save();

    this.broadcast({ type: 'phase', phase: 'final' });
    this.broadcast(this.finalMessage());
  }

  /* A Durable Object has exactly ONE alarm slot, and several phases may need
   * a deadline, so the slot has to be dispatched by phase rather than guarded
   * by one. The previous shape — `if (g.phase !== 'question') return;` — was
   * correct while the question clock was the only deadline in the game, and a
   * trap the moment any other phase armed the slot: the alarm fires, the guard
   * eats it silently, and the room wedges forever in a phase nobody can leave.
   * No error, no log, no toast — just a game that stops. So every phase that
   * can own the alarm slot gets a case here, and adding a deadline to a new
   * phase means adding its case, not editing a guard. */
  async alarm() {
    const g = await this.ensure();
    switch (g.phase) {
      case 'question':
        // Alarms can fire a little early after a rescheduling; re-arm rather than
        // cutting a question short.
        if (Date.now() < g.endsAt - 50) {
          await this.ctx.storage.setAlarm(g.endsAt);
          return;
        }
        return await this.doReveal();
      case 'reveal':
        // Same early-fire tolerance as the question clock, against the
        // reveal's own deadline.
        if (Date.now() < g.nextAt - 50) {
          await this.ctx.storage.setAlarm(g.nextAt);
          return;
        }
        return await this.advance();
      default:
        // A phase with no deadline holds no alarm; reaching here means one
        // outlived its phase (armed for a question that ended early, say).
        // Dropping it is the right move BECAUSE it is now an explicit case,
        // not the accidental fate of every alarm from a phase yet to exist.
        return;
    }
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
  /* Three tiers, and the order is the whole design:
   *   1. live OpenTDB for the chosen genre
   *   2. the bundled offline pack for THAT SAME genre
   *   3. refuse, and say so
   *
   * What is deliberately absent is a fourth tier that tops up from some other
   * genre. That used to be the only behaviour, and it fired far more often
   * than "OpenTDB is down" — fromOpenTdb() returns null for any question whose
   * distractors collide with its answer, so a perfectly successful Music fetch
   * returning seven usable questions used to be topped up with three generic
   * ones. Nobody was ever told.
   */
  async loadQuestions(settings, recent, bilingual) {
    const pack = settings.genre === 'mixed' ? FALLBACK_PACK : (PACKS[settings.genre] || []);
    let questions = [];

    // OpenTDB is English-only — there is no language parameter and passing one
    // is silently ignored (checked, not assumed). So when anyone in the room is
    // reading Spanish there is no point asking: the live source cannot serve
    // them. Skipping the fetch entirely also saves the 6s timeout.
    if (bilingual) {
      const es = pack.filter((s) => s.es);
      const seen = new Set();
      for (const avoidRecent of [true, false]) {
        for (const s of shuffle(es)) {
          if (questions.length >= QUESTION_COUNT) break;
          if (seen.has(s.text)) continue;
          if (avoidRecent && recent && recent.has(s.text)) continue;
          seen.add(s.text);
          questions.push(buildQuestion(s));
        }
        if (questions.length >= QUESTION_COUNT) break;
      }
      if (questions.length < QUESTION_COUNT) {
        throw new Error('short bilingual pack for ' + settings.genre);
      }
      return { questions: questions.slice(0, QUESTION_COUNT), offline: true, bilingual: true };
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), OPENTDB_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(openTdbUrl(settings, QUESTION_COUNT), {
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

    const live = questions.length;
    const seen = new Set(questions.map((q) => q.text));

    // Two passes over the same-genre pack. The first honours the requested
    // difficulty; the second relaxes it. Genre is a promise and difficulty is
    // a preference — a player who asked for Music/Hard and gets Music/Medium
    // got a slightly easier game, but one who gets History got a different
    // game entirely. Only one of those is a broken promise.
    const wanted = settings.difficulty && settings.difficulty !== 'any'
      ? settings.difficulty : null;
    const passes = wanted ? [wanted, null] : [null];

    for (const want of passes) {
      // Prefer questions this room has not seen recently, but never let the
      // recency filter be the reason a game cannot start.
      for (const avoidRecent of [true, false]) {
        for (const src of shuffle(pack)) {
          if (questions.length >= QUESTION_COUNT) break;
          if (seen.has(src.text)) continue;
          if (want && src.difficulty !== want) continue;
          if (avoidRecent && recent && recent.has(src.text)) continue;
          seen.add(src.text);
          questions.push(buildQuestion(src));
        }
        if (questions.length >= QUESTION_COUNT) break;
      }
      if (questions.length >= QUESTION_COUNT) break;
    }

    if (questions.length < QUESTION_COUNT) {
      // Thrown BEFORE any game state is mutated, so the room stays in lobby.
      throw new Error('short pack for genre ' + settings.genre);
    }

    return { questions: questions.slice(0, QUESTION_COUNT), offline: live === 0, bilingual: false };
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
    nextAt: 0, // reveal-phase deadline: when the room advances on its own
    answers: {}, // playerId -> {choice, at}
    lastReveal: null,
    loadingAt: 0,
    settings: sanitizeSettings(null),
    // Texts used recently, so a second game in the same room is not a rerun.
    recentTexts: [],
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
  // Shuffle the POSITIONS, once, and permute every language by that same
  // order. correctIndex then means "slot 0 of the source ended up here", which
  // is true in every language at once.
  //
  // Shuffling each language independently would look completely fine on any
  // single screen and score half the room against the wrong tile. There is no
  // way to notice that by playing in one language, so it is worth being
  // explicit: there is exactly ONE call to shuffle() in this function and
  // there must only ever be one.
  const en = [src.correct, ...src.wrong];
  const order = shuffle(en.map((_, i) => i));
  const q = {
    text: src.text,
    choices: order.map((i) => en[i]),
    correctIndex: order.indexOf(0),
    category: src.category,
    difficulty: src.difficulty,
  };
  if (src.es && src.es.text && src.es.correct && Array.isArray(src.es.wrong) &&
      src.es.wrong.length === 3) {
    const es = [src.es.correct, ...src.es.wrong];
    q.i18n = { es: { text: src.es.text, choices: order.map((i) => es[i]) } };
  }
  return q;
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

/* ------------------------------------------------------------------ *
 * Genres
 *
 * Only genres with a real bundled offline pack are offered. That is a
 * deliberate limit rather than a lack of ambition: OpenTDB rate-limits
 * hard (a second request ~0.5s after the first comes back 429, and
 * Workers egress from shared IPs, so 429 is the LIKELY failure and not
 * the rare one). A genre with no offline pack would have to refuse to
 * start every time that happened, which is worse than not offering it.
 *
 * The rule that matters: a genre is a PROMISE. If you asked for Music you
 * get Music or you get told why not — you never quietly get History. The
 * top-up path below can only draw from the same genre's pack.
 * ------------------------------------------------------------------ */

const GENRES = {
  mixed:     { label: 'Mixed',            catId: null },
  film:      { label: 'Film',             catId: 11 },
  music:     { label: 'Music',            catId: 12 },
  games:     { label: 'Video Games',      catId: 15 },
  science:   { label: 'Science & Nature', catId: 17 },
  history:   { label: 'History',          catId: 23 },
  geography: { label: 'Geography',        catId: 22 },
};

const DIFFICULTIES = ['any', 'easy', 'medium', 'hard'];
const LANGS = ['en', 'es'];

function sanitizeLang(raw) {
  return typeof raw === 'string' && LANGS.includes(raw) ? raw : 'en';
}
const DEFAULT_SETTINGS = { genre: 'mixed', difficulty: 'any' };

/* How many recently-used question texts to remember so a second game in the
 * same room is not the same ten questions. Deliberately small: save() runs on
 * every answer and re-serialises the whole game object, so this array is
 * written up to 80 times a game. */
const RECENT_CAP = 40;

/* Settings arrive from a client and are persisted forever, so they are
 * validated field by field against known-good enums. Never Object.assign or
 * spread the raw value — a JSON-parsed own `__proto__` property poisons the
 * persisted shape, and hasOwnProperty (rather than `in`) keeps inherited
 * names like `constructor` from validating as a genre. */
function sanitizeSettings(raw) {
  const out = { genre: DEFAULT_SETTINGS.genre, difficulty: DEFAULT_SETTINGS.difficulty };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.genre === 'string' &&
      Object.prototype.hasOwnProperty.call(GENRES, raw.genre)) {
    out.genre = raw.genre;
  }
  if (typeof raw.difficulty === 'string' && DIFFICULTIES.includes(raw.difficulty)) {
    out.difficulty = raw.difficulty;
  }
  return out;
}

/* Rooms persisted before settings existed come back without them; a bare read
 * would be undefined. This runs on every load, not just once. */
function normalizeGame(g) {
  if (!g || typeof g !== 'object') return freshGame();
  g.settings = sanitizeSettings(g.settings);
  if (!Array.isArray(g.recentTexts)) g.recentTexts = [];
  // Rooms persisted before auto-advance come back without a reveal deadline.
  // A stale reveal from that era has no alarm armed either — the host's Next
  // still rescues it — but the field must at least be a number to compare.
  if (typeof g.nextAt !== 'number' || !isFinite(g.nextAt)) g.nextAt = 0;
  return g;
}

/* What the lobby is allowed to offer. Sent on welcome so the client can never
 * present a combination the server cannot serve. */
/* The lobby has to be able to say which genres can actually be played in a
   given language, rather than letting someone pick Spanish + a genre that has
   no Spanish questions and only finding out at the reveal. Same principle as
   the genre promise: say it up front. */
function langsFor(slug) {
  const pack = slug === 'mixed' ? FALLBACK_PACK : (PACKS[slug] || []);
  const out = ['en'];
  if (pack.length && pack.every((q) => q.es)) out.push('es');
  return out;
}

function catalog() {
  return Object.keys(GENRES).map((slug) => ({
    slug,
    label: GENRES[slug].label,
    langs: langsFor(slug),
  }));
}

function openTdbUrl(settings, amount) {
  const p = new URLSearchParams({
    amount: String(amount),
    type: 'multiple',
    encode: 'url3986',
  });
  const g = GENRES[settings.genre];
  // Omitting category entirely is what keeps 'mixed' byte-identical to the
  // behaviour every existing room already had.
  if (g && g.catId) p.set('category', String(g.catId));
  if (settings.difficulty && settings.difficulty !== 'any') {
    p.set('difficulty', settings.difficulty);
  }
  return 'https://opentdb.com/api.php?' + p.toString();
}

/* ------------------------------------------------------------------ *
 * Offline packs — 144 questions, one set per genre.
 *
 * These are the answer to "OpenTDB is down and you picked Music". They are
 * NOT a generic backstop: each pack only ever fills a game of its own genre.
 * Authored and then adversarially fact-checked, specifically for distractors
 * that a knowledgeable player could argue for — the failure mode where the
 * person who knows more is the one who gets it wrong.
 * ------------------------------------------------------------------ */

const PACKS = {
  // 'mixed' is served by the original generic pack, defined below.
  music: [
    { text: "Who was the lead singer of the band Queen throughout the 1970s and 1980s?", correct: "Freddie Mercury", wrong: ["Robert Plant", "Roger Daltrey", "David Bowie"], category: "Music: Rock", difficulty: "easy", es: { text: "¿Quién fue el vocalista principal de la banda Queen durante los años 70 y 80?", correct: "Freddie Mercury", wrong: ["Robert Plant", "Roger Daltrey", "David Bowie"] } },
    { text: "Which country did the pop group ABBA form in?", correct: "Sweden", wrong: ["Norway", "Denmark", "Finland"], category: "Music: Pop", difficulty: "easy", es: { text: "¿En qué país se formó el grupo pop ABBA?", correct: "Suecia", wrong: ["Noruega", "Dinamarca", "Finlandia"] } },
    { text: "How many strings does a standard violin have?", correct: "Four", wrong: ["Three", "Five", "Six"], category: "Music: Instruments", difficulty: "easy", es: { text: "¿Cuántas cuerdas tiene un violín estándar?", correct: "Cuatro", wrong: ["Tres", "Cinco", "Seis"] } },
    { text: "In which country did reggae music originate?", correct: "Jamaica", wrong: ["Cuba", "Barbados", "Trinidad and Tobago"], category: "Music: Reggae", difficulty: "easy", es: { text: "¿En qué país se originó el reggae?", correct: "Jamaica", wrong: ["Cuba", "Barbados", "Trinidad y Tobago"] } },
    { text: "Which Beatles album cover shows the band walking across a zebra crossing?", correct: "Abbey Road", wrong: ["Revolver", "Help!", "Let It Be"], category: "Music: Classics", difficulty: "easy", es: { text: "¿Qué portada de un álbum de los Beatles muestra a la banda cruzando un paso de peatones?", correct: "Abbey Road", wrong: ["Revolver", "Help!", "Let It Be"] } },
    { text: "Which band recorded the 1991 single \"Smells Like Teen Spirit\"?", correct: "Nirvana", wrong: ["Pearl Jam", "Soundgarden", "Green Day"], category: "Music: Rock", difficulty: "easy", es: { text: "¿Qué banda grabó el sencillo «Smells Like Teen Spirit» en 1991?", correct: "Nirvana", wrong: ["Pearl Jam", "Soundgarden", "Green Day"] } },
    { text: "Which American singer is nicknamed the King of Pop?", correct: "Michael Jackson", wrong: ["Prince", "James Brown", "Elvis Presley"], category: "Music: Pop", difficulty: "easy", es: { text: "¿Qué cantante estadounidense es apodado el Rey del Pop?", correct: "Michael Jackson", wrong: ["Prince", "James Brown", "Elvis Presley"] } },
    { text: "Whose 2011 album was titled \"21\"?", correct: "Adele", wrong: ["Amy Winehouse", "Rihanna", "Katy Perry"], category: "Music: Pop", difficulty: "easy", es: { text: "¿De quién es el álbum de 2011 titulado «21»?", correct: "Adele", wrong: ["Amy Winehouse", "Rihanna", "Katy Perry"] } },
    { text: "Which composer wrote the opera \"Carmen\"?", correct: "Georges Bizet", wrong: ["Giuseppe Verdi", "Giacomo Puccini", "Richard Wagner"], category: "Music: Classical", difficulty: "medium", es: { text: "¿Qué compositor escribió la ópera «Carmen»?", correct: "Georges Bizet", wrong: ["Giuseppe Verdi", "Giacomo Puccini", "Richard Wagner"] } },
    { text: "How many keys does a standard full-size piano have?", correct: "88", wrong: ["61", "76", "96"], category: "Music: Instruments", difficulty: "medium", es: { text: "¿Cuántas teclas tiene un piano estándar de tamaño completo?", correct: "88", wrong: ["61", "76", "96"] } },
    { text: "What is the musical term for a passage that gradually gets louder?", correct: "Crescendo", wrong: ["Diminuendo", "Staccato", "Legato"], category: "Music: Theory", difficulty: "medium", es: { text: "¿Qué término musical designa un pasaje que aumenta de volumen de forma gradual?", correct: "Crescendo", wrong: ["Diminuendo", "Staccato", "Legato"] } },
    { text: "In which year was the Live Aid benefit concert held?", correct: "1985", wrong: ["1979", "1982", "1990"], category: "Music: History", difficulty: "medium", es: { text: "¿En qué año se celebró el concierto benéfico Live Aid?", correct: "1985", wrong: ["1979", "1982", "1990"] } },
    { text: "Which Detroit record label was founded by Berry Gordy?", correct: "Motown", wrong: ["Stax", "Chess Records", "Sun Records"], category: "Music: Soul", difficulty: "medium", es: { text: "¿Qué sello discográfico de Detroit fundó Berry Gordy?", correct: "Motown", wrong: ["Stax", "Chess Records", "Sun Records"] } },
    { text: "Which American singer-songwriter was born Robert Allen Zimmerman?", correct: "Bob Dylan", wrong: ["Tom Waits", "Neil Young", "Lou Reed"], category: "Music: Folk", difficulty: "medium", es: { text: "¿Qué cantautor estadounidense nació con el nombre de Robert Allen Zimmerman?", correct: "Bob Dylan", wrong: ["Tom Waits", "Neil Young", "Lou Reed"] } },
    { text: "Which instrument did jazz musician John Coltrane play?", correct: "Saxophone", wrong: ["Trumpet", "Piano", "Double bass"], category: "Music: Jazz", difficulty: "medium", es: { text: "¿Qué instrumento tocaba el músico de jazz John Coltrane?", correct: "Saxofón", wrong: ["Trompeta", "Piano", "Contrabajo"] } },
    { text: "Which band recorded the 1973 album \"The Dark Side of the Moon\"?", correct: "Pink Floyd", wrong: ["Led Zeppelin", "Genesis", "The Doors"], category: "Music: Rock", difficulty: "medium", es: { text: "¿Qué banda grabó el álbum «The Dark Side of the Moon» en 1973?", correct: "Pink Floyd", wrong: ["Led Zeppelin", "Genesis", "The Doors"] } },
    { text: "In which American city is the Grand Ole Opry located?", correct: "Nashville", wrong: ["Memphis", "Austin", "New Orleans"], category: "Music: Country", difficulty: "medium", es: { text: "¿En qué ciudad estadounidense se encuentra el Grand Ole Opry?", correct: "Nashville", wrong: ["Memphis", "Austin", "Nueva Orleans"] } },
    { text: "Which hip-hop group released the 1988 album \"Straight Outta Compton\"?", correct: "N.W.A", wrong: ["Public Enemy", "Run-DMC", "Beastie Boys"], category: "Music: Hip-Hop", difficulty: "medium", es: { text: "¿Qué grupo de hip-hop publicó el álbum «Straight Outta Compton» en 1988?", correct: "N.W.A", wrong: ["Public Enemy", "Run-DMC", "Beastie Boys"] } },
    { text: "Which composer wrote the ballet \"The Rite of Spring\", whose 1913 Paris premiere caused an uproar?", correct: "Igor Stravinsky", wrong: ["Claude Debussy", "Maurice Ravel", "Sergei Prokofiev"], category: "Music: Classical", difficulty: "hard", es: { text: "¿Qué compositor escribió el ballet «La consagración de la primavera», cuyo estreno en París en 1913 provocó un escándalo?", correct: "Igor Stravinsky", wrong: ["Claude Debussy", "Maurice Ravel", "Sergei Prokofiev"] } },
    { text: "Which Nigerian musician pioneered the Afrobeat style in the 1970s?", correct: "Fela Kuti", wrong: ["King Sunny Adé", "Youssou N'Dour", "Salif Keita"], category: "Music: World", difficulty: "hard", es: { text: "¿Qué músico nigeriano fue pionero del afrobeat en los años 70?", correct: "Fela Kuti", wrong: ["King Sunny Adé", "Youssou N'Dour", "Salif Keita"] } },
    { text: "How many semitones make up a perfect fifth?", correct: "Seven", wrong: ["Five", "Six", "Eight"], category: "Music: Theory", difficulty: "hard", es: { text: "¿Cuántos semitonos forman una quinta justa?", correct: "Siete", wrong: ["Cinco", "Seis", "Ocho"] } },
    { text: "Which German band released the 1974 album \"Autobahn\"?", correct: "Kraftwerk", wrong: ["Can", "Neu!", "Tangerine Dream"], category: "Music: Electronic", difficulty: "hard", es: { text: "¿Qué banda alemana publicó el álbum «Autobahn» en 1974?", correct: "Kraftwerk", wrong: ["Can", "Neu!", "Tangerine Dream"] } },
    { text: "Which Brazilian musical style did Antonio Carlos Jobim help create in the late 1950s?", correct: "Bossa nova", wrong: ["Samba", "Forro", "Choro"], category: "Music: World", difficulty: "hard", es: { text: "¿Qué estilo musical brasileño ayudó a crear Antonio Carlos Jobim a finales de los años 50?", correct: "Bossa nova", wrong: ["Samba", "Forró", "Choro"] } },
    { text: "Which record producer developed the recording technique known as the Wall of Sound?", correct: "Phil Spector", wrong: ["George Martin", "Quincy Jones", "Brian Eno"], category: "Music: Production", difficulty: "hard", es: { text: "¿Qué productor musical desarrolló la técnica de grabación conocida como «muro de sonido» (Wall of Sound)?", correct: "Phil Spector", wrong: ["George Martin", "Quincy Jones", "Brian Eno"] } },
  ],
  film: [
    { text: "Who directed the 1975 shark thriller \"Jaws\"?", correct: "Steven Spielberg", wrong: ["George Lucas", "Ridley Scott", "Robert Zemeckis"], category: "Film: Directors", difficulty: "easy", es: { text: "¿Quién dirigió el thriller de 1975 «Tiburón»?", correct: "Steven Spielberg", wrong: ["George Lucas", "Ridley Scott", "Robert Zemeckis"] } },
    { text: "What is the name of Han Solo's ship in the original \"Star Wars\" trilogy?", correct: "Millennium Falcon", wrong: ["Tantive IV", "Slave I", "Nostromo"], category: "Film: Sci-Fi", difficulty: "easy", es: { text: "¿Cómo se llama la nave de Han Solo en la trilogía original de «Star Wars»?", correct: "Halcón Milenario", wrong: ["Tantive IV", "Slave I", "Nostromo"] } },
    { text: "What kind of creature is the title character of the DreamWorks film \"Shrek\"?", correct: "Ogre", wrong: ["Troll", "Goblin", "Giant"], category: "Film: Animation", difficulty: "easy", es: { text: "¿Qué tipo de criatura es el protagonista de la película de DreamWorks «Shrek»?", correct: "Ogro", wrong: ["Trol", "Goblin", "Gigante"] } },
    { text: "Which animation studio produced the 1995 film \"Toy Story\"?", correct: "Pixar", wrong: ["DreamWorks Animation", "Studio Ghibli", "Blue Sky Studios"], category: "Film: Animation", difficulty: "easy", es: { text: "¿Qué estudio de animación produjo la película de 1995 «Toy Story»?", correct: "Pixar", wrong: ["DreamWorks Animation", "Studio Ghibli", "Blue Sky Studios"] } },
    { text: "In which Alfred Hitchcock film is a woman murdered in the shower of the Bates Motel?", correct: "Psycho", wrong: ["Vertigo", "The Birds", "Frenzy"], category: "Film: Classics", difficulty: "easy", es: { text: "¿En qué película de Alfred Hitchcock asesinan a una mujer en la ducha del Motel Bates?", correct: "Psicosis", wrong: ["Vértigo", "Los pájaros", "Frenesí"] } },
    { text: "Which actor played Frodo Baggins in Peter Jackson's \"The Lord of the Rings\" films?", correct: "Elijah Wood", wrong: ["Sean Astin", "Orlando Bloom", "Dominic Monaghan"], category: "Film: Fantasy", difficulty: "easy", es: { text: "¿Qué actor interpretó a Frodo Bolsón en las películas de «El Señor de los Anillos» dirigidas por Peter Jackson?", correct: "Elijah Wood", wrong: ["Sean Astin", "Orlando Bloom", "Dominic Monaghan"] } },
    { text: "In which country is the Hindi-language film industry known as Bollywood based?", correct: "India", wrong: ["Pakistan", "Bangladesh", "Indonesia"], category: "Film: World Cinema", difficulty: "easy", es: { text: "¿En qué país tiene su sede la industria del cine en hindi conocida como Bollywood?", correct: "India", wrong: ["Pakistán", "Bangladés", "Indonesia"] } },
    { text: "Who composed the music for \"Star Wars\", \"Jurassic Park\" and \"Schindler's List\"?", correct: "John Williams", wrong: ["Hans Zimmer", "Ennio Morricone", "Danny Elfman"], category: "Film: Music", difficulty: "easy", es: { text: "¿Quién compuso la música de «Star Wars», «Parque Jurásico» y «La lista de Schindler»?", correct: "John Williams", wrong: ["Hans Zimmer", "Ennio Morricone", "Danny Elfman"] } },
    { text: "Which Japanese director made the 1954 film \"Seven Samurai\"?", correct: "Akira Kurosawa", wrong: ["Yasujiro Ozu", "Kenji Mizoguchi", "Hayao Miyazaki"], category: "Film: World Cinema", difficulty: "medium", es: { text: "¿Qué cineasta japonés dirigió la película de 1954 «Los siete samuráis»?", correct: "Akira Kurosawa", wrong: ["Yasujiro Ozu", "Kenji Mizoguchi", "Hayao Miyazaki"] } },
    { text: "What is the name of Rick Blaine's nightclub in \"Casablanca\"?", correct: "Rick's Cafe Americain", wrong: ["The Blue Parrot", "The Kit Kat Club", "El Flamingo"], category: "Film: Classics", difficulty: "medium", es: { text: "¿Cómo se llama el club nocturno de Rick Blaine en «Casablanca»?", correct: "Rick's Café Américain", wrong: ["The Blue Parrot", "The Kit Kat Club", "El Flamingo"] } },
    { text: "Which South Korean film became the first non-English-language winner of the Academy Award for Best Picture?", correct: "Parasite", wrong: ["Oldboy", "Burning", "The Handmaiden"], category: "Film: Awards", difficulty: "medium", es: { text: "¿Qué película surcoreana fue la primera de habla no inglesa en ganar el Óscar a mejor película?", correct: "Parásitos", wrong: ["Oldboy", "Burning", "La doncella"] } },
    { text: "In which Martin Scorsese film does Robert De Niro play the taxi driver Travis Bickle?", correct: "Taxi Driver", wrong: ["Raging Bull", "Goodfellas", "Cape Fear"], category: "Film: Characters", difficulty: "medium", es: { text: "¿En qué película de Martin Scorsese interpreta Robert De Niro al taxista Travis Bickle?", correct: "Taxi Driver", wrong: ["Toro salvaje", "Goodfellas", "Cape Fear"] } },
    { text: "The Golden Bear is the top prize of the film festival held in which city?", correct: "Berlin", wrong: ["Venice", "Cannes", "Locarno"], category: "Film: Awards", difficulty: "medium", es: { text: "¿En qué ciudad se celebra el festival de cine cuyo máximo premio es el Oso de Oro?", correct: "Berlín", wrong: ["Venecia", "Cannes", "Locarno"] } },
    { text: "What is Hannibal Lecter's profession in \"The Silence of the Lambs\"?", correct: "Psychiatrist", wrong: ["Chemistry professor", "Pathologist", "Criminal profiler"], category: "Film: Characters", difficulty: "medium", es: { text: "¿Cuál es la profesión de Hannibal Lecter en «El silencio de los corderos»?", correct: "Psiquiatra", wrong: ["Profesor de química", "Patólogo", "Perfilador criminal"] } },
    { text: "Walt Disney's \"Snow White and the Seven Dwarfs\" premiered in which year?", correct: "1937", wrong: ["1928", "1932", "1945"], category: "Film: Animation", difficulty: "medium", es: { text: "¿En qué año se estrenó «Blancanieves y los siete enanitos», de Walt Disney?", correct: "1937", wrong: ["1928", "1932", "1945"] } },
    { text: "Which actor plays Vincent Vega in \"Pulp Fiction\"?", correct: "John Travolta", wrong: ["Samuel L. Jackson", "Bruce Willis", "Harvey Keitel"], category: "Film", difficulty: "medium", es: { text: "¿Qué actor interpreta a Vincent Vega en «Pulp Fiction»?", correct: "John Travolta", wrong: ["Samuel L. Jackson", "Bruce Willis", "Harvey Keitel"] } },
    { text: "Which animated film follows a girl named Chihiro who works in a bathhouse for spirits?", correct: "Spirited Away", wrong: ["My Neighbor Totoro", "Princess Mononoke", "Kiki's Delivery Service"], category: "Film: Animation", difficulty: "medium", es: { text: "¿Qué película de animación sigue a una niña que trabaja en una casa de baños para espíritus?", correct: "El viaje de Chihiro", wrong: ["Mi vecino Totoro", "La princesa Mononoke", "Kiki: entregas a domicilio"] } },
    { text: "What is the name of the sled in \"Citizen Kane\"?", correct: "Rosebud", wrong: ["Bluebird", "Snowdrop", "Firefly"], category: "Film: Classics", difficulty: "medium", es: { text: "¿Cómo se llama el trineo de «Ciudadano Kane»?", correct: "Rosebud", wrong: ["Bluebird", "Snowdrop", "Firefly"] } },
    { text: "Which animated feature was the first ever nominated for the Academy Award for Best Picture?", correct: "Beauty and the Beast", wrong: ["Snow White and the Seven Dwarfs", "The Lion King", "Up"], category: "Film: Awards", difficulty: "hard", es: { text: "¿Qué largometraje de animación fue el primero en ser nominado al Óscar a mejor película?", correct: "La bella y la bestia", wrong: ["Blancanieves y los siete enanitos", "El rey león", "Up"] } },
    { text: "Who directed the 1925 Soviet film \"Battleship Potemkin\"?", correct: "Sergei Eisenstein", wrong: ["Dziga Vertov", "Vsevolod Pudovkin", "Andrei Tarkovsky"], category: "Film: Classics", difficulty: "hard", es: { text: "¿Quién dirigió la película soviética de 1925 «El acorazado Potemkin»?", correct: "Serguéi Eisenstein", wrong: ["Dziga Vertov", "Vsévolod Pudovkin", "Andréi Tarkovski"] } },
    { text: "Filmmakers from which country launched the Dogme 95 manifesto?", correct: "Denmark", wrong: ["Sweden", "Norway", "Netherlands"], category: "Film: World Cinema", difficulty: "hard", es: { text: "¿De qué país son los cineastas que lanzaron el manifiesto Dogma 95?", correct: "Dinamarca", wrong: ["Suecia", "Noruega", "Países Bajos"] } },
    { text: "Which Italian director made the 1963 film \"8 1/2\"?", correct: "Federico Fellini", wrong: ["Michelangelo Antonioni", "Vittorio De Sica", "Sergio Leone"], category: "Film: World Cinema", difficulty: "hard", es: { text: "¿Qué cineasta italiano dirigió la película de 1963 «Ocho y medio» (8½)?", correct: "Federico Fellini", wrong: ["Michelangelo Antonioni", "Vittorio De Sica", "Sergio Leone"] } },
    { text: "The historic Cinecitta film studios are located in which city?", correct: "Rome", wrong: ["Milan", "Madrid", "Vienna"], category: "Film: World Cinema", difficulty: "hard", es: { text: "¿En qué ciudad se encuentran los históricos estudios de cine Cinecittà?", correct: "Roma", wrong: ["Milán", "Madrid", "Viena"] } },
    { text: "Which 1927 film is credited as the first feature to include synchronized spoken dialogue?", correct: "The Jazz Singer", wrong: ["Don Juan", "The Broadway Melody", "Sunrise"], category: "Film: Classics", difficulty: "hard", es: { text: "¿Qué película de 1927 está considerada el primer largometraje con diálogos hablados sincronizados?", correct: "El cantor de jazz", wrong: ["Don Juan", "La melodía de Broadway", "Amanecer"] } },
  ],
  science: [
    { text: "Which gas do plants absorb from the air during photosynthesis?", correct: "Carbon dioxide", wrong: ["Oxygen", "Nitrogen", "Methane"], category: "Science & Nature: Biology", difficulty: "easy", es: { text: "¿Qué gas absorben las plantas del aire durante la fotosíntesis?", correct: "Dióxido de carbono", wrong: ["Oxígeno", "Nitrógeno", "Metano"] } },
    { text: "What is the chemical symbol for gold?", correct: "Au", wrong: ["Ag", "Gd", "Ge"], category: "Science & Nature: Chemistry", difficulty: "easy", es: { text: "¿Cuál es el símbolo químico del oro?", correct: "Au", wrong: ["Ag", "Gd", "Ge"] } },
    { text: "Which planet orbits closest to the Sun?", correct: "Mercury", wrong: ["Venus", "Earth", "Mars"], category: "Science & Nature: Astronomy", difficulty: "easy", es: { text: "¿Qué planeta orbita más cerca del Sol?", correct: "Mercurio", wrong: ["Venus", "Tierra", "Marte"] } },
    { text: "What is the largest organ of the human body?", correct: "Skin", wrong: ["Liver", "Brain", "Lungs"], category: "Science & Nature: Biology", difficulty: "easy", es: { text: "¿Cuál es el órgano más grande del cuerpo humano?", correct: "Piel", wrong: ["Hígado", "Cerebro", "Pulmones"] } },
    { text: "How many legs does an adult insect have?", correct: "Six", wrong: ["Four", "Eight", "Ten"], category: "Science & Nature: Biology", difficulty: "easy", es: { text: "¿Cuántas patas tiene un insecto adulto?", correct: "Seis", wrong: ["Cuatro", "Ocho", "Diez"] } },
    { text: "Which living animal is the largest on Earth?", correct: "Blue whale", wrong: ["African elephant", "Sperm whale", "Whale shark"], category: "Science & Nature: Biology", difficulty: "easy", es: { text: "¿Cuál es el animal vivo más grande de la Tierra?", correct: "Ballena azul", wrong: ["Elefante africano", "Cachalote", "Tiburón ballena"] } },
    { text: "What is the dense central part of an atom called?", correct: "Nucleus", wrong: ["Electron shell", "Electron cloud", "Orbital"], category: "Science & Nature: Physics", difficulty: "easy", es: { text: "¿Cómo se llama la parte central y densa de un átomo?", correct: "Núcleo", wrong: ["Capa electrónica", "Nube de electrones", "Orbital"] } },
    { text: "At standard sea-level pressure, water boils at what temperature in degrees Celsius?", correct: "100", wrong: ["80", "90", "120"], category: "Science & Nature: Chemistry", difficulty: "easy", es: { text: "A presión normal al nivel del mar, ¿a qué temperatura hierve el agua en grados Celsius?", correct: "100", wrong: ["80", "90", "120"] } },
    { text: "What is the most abundant gas in Earth's atmosphere?", correct: "Nitrogen", wrong: ["Oxygen", "Carbon dioxide", "Argon"], category: "Science & Nature: Earth Science", difficulty: "medium", es: { text: "¿Cuál es el gas más abundante en la atmósfera terrestre?", correct: "Nitrógeno", wrong: ["Oxígeno", "Dióxido de carbono", "Argón"] } },
    { text: "Who published the three laws of motion in the Principia in 1687?", correct: "Isaac Newton", wrong: ["Galileo Galilei", "Johannes Kepler", "Robert Hooke"], category: "Science & Nature: Physics", difficulty: "medium", es: { text: "¿Quién publicó las tres leyes del movimiento en los Principia en 1687?", correct: "Isaac Newton", wrong: ["Galileo Galilei", "Johannes Kepler", "Robert Hooke"] } },
    { text: "What is the scientific study of fungi called?", correct: "Mycology", wrong: ["Botany", "Entomology", "Herpetology"], category: "Science & Nature: Biology", difficulty: "medium", es: { text: "¿Cómo se llama el estudio científico de los hongos?", correct: "Micología", wrong: ["Botánica", "Entomología", "Herpetología"] } },
    { text: "Which organelle carries out photosynthesis in plant cells?", correct: "Chloroplast", wrong: ["Mitochondrion", "Ribosome", "Vacuole"], category: "Science & Nature: Biology", difficulty: "medium", es: { text: "¿Qué orgánulo realiza la fotosíntesis en las células vegetales?", correct: "Cloroplasto", wrong: ["Mitocondria", "Ribosoma", "Vacuola"] } },
    { text: "What is the SI unit of electrical resistance?", correct: "Ohm", wrong: ["Volt", "Ampere", "Watt"], category: "Science & Nature: Physics", difficulty: "medium", es: { text: "¿Cuál es la unidad del Sistema Internacional (SI) para la resistencia eléctrica?", correct: "Ohmio", wrong: ["Voltio", "Amperio", "Vatio"] } },
    { text: "Which planet hosts the storm known as the Great Red Spot?", correct: "Jupiter", wrong: ["Saturn", "Neptune", "Mars"], category: "Science & Nature: Astronomy", difficulty: "medium", es: { text: "¿Qué planeta alberga la tormenta conocida como la Gran Mancha Roja?", correct: "Júpiter", wrong: ["Saturno", "Neptuno", "Marte"] } },
    { text: "What is the term for a solid changing directly into a gas?", correct: "Sublimation", wrong: ["Deposition", "Condensation", "Evaporation"], category: "Science & Nature: Chemistry", difficulty: "medium", es: { text: "¿Cómo se llama el paso directo de un sólido a gas?", correct: "Sublimación", wrong: ["Deposición", "Condensación", "Evaporación"] } },
    { text: "Which vitamin does human skin produce when exposed to sunlight?", correct: "Vitamin D", wrong: ["Vitamin A", "Vitamin C", "Vitamin K"], category: "Science & Nature: Biology", difficulty: "medium", es: { text: "¿Qué vitamina produce la piel humana al exponerse a la luz solar?", correct: "Vitamina D", wrong: ["Vitamina A", "Vitamina C", "Vitamina K"] } },
    { text: "In which year did humans first walk on the Moon?", correct: "1969", wrong: ["1961", "1965", "1972"], category: "Science & Nature: Astronomy", difficulty: "medium", es: { text: "¿En qué año pisó el ser humano la Luna por primera vez?", correct: "1969", wrong: ["1961", "1965", "1972"] } },
    { text: "Where in the human body is the cochlea located?", correct: "The inner ear", wrong: ["The middle ear", "The outer ear", "The nasal cavity"], category: "Science & Nature: Biology", difficulty: "medium", es: { text: "¿En qué parte del cuerpo humano se encuentra la cóclea?", correct: "El oído interno", wrong: ["El oído medio", "El oído externo", "La cavidad nasal"] } },
    { text: "Which blood vessel carries oxygen-rich blood from the lungs back to the heart?", correct: "Pulmonary vein", wrong: ["Pulmonary artery", "Aorta", "Vena cava"], category: "Science & Nature: Biology", difficulty: "hard", es: { text: "¿Qué vaso sanguíneo lleva la sangre rica en oxígeno desde los pulmones al corazón?", correct: "Vena pulmonar", wrong: ["Arteria pulmonar", "Aorta", "Vena cava"] } },
    { text: "Which metal is the most abundant in Earth's crust?", correct: "Aluminium", wrong: ["Iron", "Magnesium", "Calcium"], category: "Science & Nature: Earth Science", difficulty: "hard", es: { text: "¿Qué metal es el más abundante en la corteza terrestre?", correct: "Aluminio", wrong: ["Hierro", "Magnesio", "Calcio"] } },
    { text: "What is the SI unit of magnetic flux density?", correct: "Tesla", wrong: ["Weber", "Gauss", "Henry"], category: "Science & Nature: Physics", difficulty: "hard", es: { text: "¿Cuál es la unidad del Sistema Internacional (SI) para la densidad de flujo magnético?", correct: "Tesla", wrong: ["Weber", "Gauss", "Henry"] } },
    { text: "Which naturalist independently proposed natural selection, prompting Darwin to publish?", correct: "Alfred Russel Wallace", wrong: ["Gregor Mendel", "Thomas Malthus", "Charles Lyell"], category: "Science & Nature: Biology", difficulty: "hard", es: { text: "¿Qué naturalista propuso la selección natural de forma independiente e impulsó a Darwin a publicar?", correct: "Alfred Russel Wallace", wrong: ["Gregor Mendel", "Thomas Malthus", "Charles Lyell"] } },
    { text: "What name is given to the boundary between Earth's crust and mantle?", correct: "Mohorovicic discontinuity", wrong: ["Gutenberg discontinuity", "Lehmann discontinuity", "Conrad discontinuity"], category: "Science & Nature: Earth Science", difficulty: "hard", es: { text: "¿Qué nombre recibe el límite entre la corteza y el manto de la Tierra?", correct: "Discontinuidad de Mohorovicic", wrong: ["Discontinuidad de Gutenberg", "Discontinuidad de Lehmann", "Discontinuidad de Conrad"] } },
    { text: "What is the name for the point in a planet's orbit nearest the Sun?", correct: "Perihelion", wrong: ["Aphelion", "Perigee", "Apogee"], category: "Science & Nature: Astronomy", difficulty: "hard", es: { text: "¿Cómo se llama el punto más cercano al Sol en la órbita de un planeta?", correct: "Perihelio", wrong: ["Afelio", "Perigeo", "Apogeo"] } },
  ],
  games: [
    { text: "What is the name of the green dinosaur Mario first rode in Super Mario World?", correct: "Yoshi", wrong: ["Birdo", "Toad", "Bowser Jr."], category: "Video Games: Nintendo", difficulty: "easy", es: { text: "¿Cómo se llama el dinosaurio verde que Mario montó por primera vez en Super Mario World?", correct: "Yoshi", wrong: ["Birdo", "Toad", "Bowser Jr."] } },
    { text: "Which company created the Sonic the Hedgehog series?", correct: "Sega", wrong: ["Nintendo", "Capcom", "Namco"], category: "Video Games", difficulty: "easy", es: { text: "¿Qué empresa creó la serie Sonic the Hedgehog?", correct: "Sega", wrong: ["Nintendo", "Capcom", "Namco"] } },
    { text: "In Minecraft, which green creature hisses and then explodes next to the player?", correct: "Creeper", wrong: ["Enderman", "Zombie", "Skeleton"], category: "Video Games: Modern", difficulty: "easy", es: { text: "En Minecraft, ¿qué criatura verde sisea y luego explota junto al jugador?", correct: "Creeper", wrong: ["Enderman", "Zombi", "Esqueleto"] } },
    { text: "What type is Pikachu in the Pokemon games?", correct: "Electric", wrong: ["Fire", "Water", "Psychic"], category: "Video Games: Pokemon", difficulty: "easy", es: { text: "¿De qué tipo es Pikachu en los juegos de Pokémon?", correct: "Eléctrico", wrong: ["Fuego", "Agua", "Psíquico"] } },
    { text: "Which 1972 Atari arcade game simulated table tennis with two paddles and a bouncing ball?", correct: "Pong", wrong: ["Breakout", "Space Invaders", "Asteroids"], category: "Video Games: Arcade", difficulty: "easy", es: { text: "¿Qué juego arcade de Atari de 1972 simulaba el tenis de mesa con dos paletas y una pelota que rebotaba?", correct: "Pong", wrong: ["Breakout", "Space Invaders", "Asteroids"] } },
    { text: "Which puzzle game did Soviet engineer Alexey Pajitnov create in 1984?", correct: "Tetris", wrong: ["Columns", "Puyo Puyo", "Dr. Mario"], category: "Video Games: Classics", difficulty: "easy", es: { text: "¿Qué juego de rompecabezas creó el ingeniero soviético Alexey Pajitnov en 1984?", correct: "Tetris", wrong: ["Columns", "Puyo Puyo", "Dr. Mario"] } },
    { text: "Which handheld console did Nintendo launch in 1989 with a monochrome screen?", correct: "Game Boy", wrong: ["Game Gear", "Atari Lynx", "Neo Geo Pocket"], category: "Video Games: Hardware", difficulty: "easy", es: { text: "¿Qué consola portátil lanzó Nintendo en 1989 con una pantalla monocromática?", correct: "Game Boy", wrong: ["Game Gear", "Atari Lynx", "Neo Geo Pocket"] } },
    { text: "Which green-tunicked swordsman is the hero of The Legend of Zelda series?", correct: "Link", wrong: ["Zelda", "Ganondorf", "Navi"], category: "Video Games: Nintendo", difficulty: "easy", es: { text: "¿Qué espadachín de túnica verde es el héroe de la serie The Legend of Zelda?", correct: "Link", wrong: ["Zelda", "Ganondorf", "Navi"] } },
    { text: "Who is the armoured bounty hunter at the centre of the Metroid series?", correct: "Samus Aran", wrong: ["Ridley", "Mother Brain", "Adam Malkovich"], category: "Video Games: Characters", difficulty: "medium", es: { text: "¿Qué cazarrecompensas con armadura protagoniza la serie Metroid?", correct: "Samus Aran", wrong: ["Ridley", "Mother Brain", "Adam Malkovich"] } },
    { text: "Which 1993 id Software shooter cast the player as a space marine fighting demons on Mars?", correct: "Doom", wrong: ["Quake", "Wolfenstein 3D", "Duke Nukem 3D"], category: "Video Games: PC", difficulty: "medium", es: { text: "¿Qué juego de disparos de id Software de 1993 ponía al jugador en la piel de un marine espacial que luchaba contra demonios en Marte?", correct: "Doom", wrong: ["Quake", "Wolfenstein 3D", "Duke Nukem 3D"] } },
    { text: "What is the name of the red ghost in Pac-Man?", correct: "Blinky", wrong: ["Inky", "Pinky", "Clyde"], category: "Video Games: Arcade", difficulty: "medium", es: { text: "¿Cómo se llama el fantasma rojo de Pac-Man?", correct: "Blinky", wrong: ["Inky", "Pinky", "Clyde"] } },
    { text: "Which artificial intelligence oversees the test chambers in the game Portal?", correct: "GLaDOS", wrong: ["SHODAN", "Cortana", "EDI"], category: "Video Games: Modern", difficulty: "medium", es: { text: "¿Qué inteligencia artificial supervisa las cámaras de pruebas en el juego Portal?", correct: "GLaDOS", wrong: ["SHODAN", "Cortana", "EDI"] } },
    { text: "The Grand Theft Auto city of Los Santos is modelled on which real American city?", correct: "Los Angeles", wrong: ["Miami", "Las Vegas", "Chicago"], category: "Video Games: Modern", difficulty: "medium", es: { text: "¿En qué ciudad real de Estados Unidos se basa Los Santos, de Grand Theft Auto?", correct: "Los Ángeles", wrong: ["Miami", "Las Vegas", "Chicago"] } },
    { text: "Which Street Fighter II fighter attacks with the Sonic Boom?", correct: "Guile", wrong: ["Ryu", "Blanka", "Zangief"], category: "Video Games: Fighting", difficulty: "medium", es: { text: "¿Qué luchador de Street Fighter II ataca con el Sonic Boom?", correct: "Guile", wrong: ["Ryu", "Blanka", "Zangief"] } },
    { text: "The Witcher 3: Wild Hunt was developed by a studio based in which country?", correct: "Poland", wrong: ["Czech Republic", "Germany", "Sweden"], category: "Video Games: Modern", difficulty: "medium", es: { text: "¿En qué país tiene su sede el estudio que desarrolló The Witcher 3: Wild Hunt?", correct: "Polonia", wrong: ["República Checa", "Alemania", "Suecia"] } },
    { text: "Who composed the music for the 1985 game Super Mario Bros.?", correct: "Koji Kondo", wrong: ["Nobuo Uematsu", "Yuzo Koshiro", "Yasunori Mitsuda"], category: "Video Games: Music", difficulty: "medium", es: { text: "¿Quién compuso la música del juego Super Mario Bros. de 1985?", correct: "Koji Kondo", wrong: ["Nobuo Uematsu", "Yuzo Koshiro", "Yasunori Mitsuda"] } },
    { text: "In which year did Sony first release the original PlayStation in Japan?", correct: "1994", wrong: ["1992", "1996", "1998"], category: "Video Games: Hardware", difficulty: "medium", es: { text: "¿En qué año lanzó Sony la PlayStation original en Japón?", correct: "1994", wrong: ["1992", "1996", "1998"] } },
    { text: "Who created the Metal Gear series?", correct: "Hideo Kojima", wrong: ["Shigeru Miyamoto", "Yu Suzuki", "Keiji Inafune"], category: "Video Games: Creators", difficulty: "medium", es: { text: "¿Quién creó la serie Metal Gear?", correct: "Hideo Kojima", wrong: ["Shigeru Miyamoto", "Yu Suzuki", "Keiji Inafune"] } },
    { text: "Which Japanese company developed the 1978 arcade game Space Invaders?", correct: "Taito", wrong: ["Namco", "Konami", "Sega"], category: "Video Games: Arcade", difficulty: "hard", es: { text: "¿Qué empresa japonesa desarrolló el juego arcade Space Invaders de 1978?", correct: "Taito", wrong: ["Namco", "Konami", "Sega"] } },
    { text: "Which 1972 machine was the first home video game console sold to consumers?", correct: "Magnavox Odyssey", wrong: ["Atari 2600", "Fairchild Channel F", "Coleco Telstar"], category: "Video Games: History", difficulty: "hard", es: { text: "¿Qué máquina de 1972 fue la primera consola doméstica de videojuegos que se vendió al público?", correct: "Magnavox Odyssey", wrong: ["Atari 2600", "Fairchild Channel F", "Coleco Telstar"] } },
    { text: "Nintendo was founded in 1889 to manufacture what product?", correct: "Playing cards", wrong: ["Bicycles", "Vacuum cleaners", "Toy trains"], category: "Video Games: History", difficulty: "hard", es: { text: "¿Qué producto fabricaba Nintendo cuando se fundó en 1889?", correct: "Naipes", wrong: ["Bicicletas", "Aspiradoras", "Trenes de juguete"] } },
    { text: "Who founded the underwater city of Rapture in BioShock?", correct: "Andrew Ryan", wrong: ["Frank Fontaine", "Sander Cohen", "Booker DeWitt"], category: "Video Games: Modern", difficulty: "hard", es: { text: "¿Quién fundó Rapture, la ciudad submarina de BioShock?", correct: "Andrew Ryan", wrong: ["Frank Fontaine", "Sander Cohen", "Booker DeWitt"] } },
    { text: "What name was Mario given in the original 1981 Donkey Kong arcade game?", correct: "Jumpman", wrong: ["Stanley", "Foreman Spike", "Wario"], category: "Video Games: Classics", difficulty: "hard", es: { text: "¿Qué nombre recibió Mario en el juego arcade original de Donkey Kong, de 1981?", correct: "Jumpman", wrong: ["Stanley", "Foreman Spike", "Wario"] } },
    { text: "The North American video game crash that wiped out most console makers began in which year?", correct: "1983", wrong: ["1977", "1980", "1986"], category: "Video Games: History", difficulty: "hard", es: { text: "¿En qué año comenzó la crisis norteamericana del videojuego que arruinó a casi todos los fabricantes de consolas?", correct: "1983", wrong: ["1977", "1980", "1986"] } },
  ],
  history: [
    { text: "In what year did the Berlin Wall fall?", correct: "1989", wrong: ["1979", "1985", "1991"], category: "History: Modern", difficulty: "easy", es: { text: "¿En qué año cayó el Muro de Berlín?", correct: "1989", wrong: ["1979", "1985", "1991"] } },
    { text: "Which river's annual flooding sustained the farmland of ancient Egypt?", correct: "Nile", wrong: ["Tigris", "Indus", "Yangtze"], category: "History: Ancient", difficulty: "easy", es: { text: "¿Qué río sostenía con sus crecidas anuales los campos del antiguo Egipto?", correct: "Nilo", wrong: ["Tigris", "Indo", "Yangtsé"] } },
    { text: "Which empire did Genghis Khan found in 1206?", correct: "Mongol Empire", wrong: ["Ottoman Empire", "Safavid Empire", "Khmer Empire"], category: "History: Asia", difficulty: "easy", es: { text: "¿Qué imperio fundó Gengis Kan en 1206?", correct: "Imperio mongol", wrong: ["Imperio otomano", "Imperio safávida", "Imperio jemer"] } },
    { text: "In which country did the Meiji Restoration of 1868 take place?", correct: "Japan", wrong: ["China", "Korea", "Thailand"], category: "History: Asia", difficulty: "easy", es: { text: "¿En qué país tuvo lugar la Restauración Meiji de 1868?", correct: "Japón", wrong: ["China", "Corea", "Tailandia"] } },
    { text: "In what year did World War II end in Europe?", correct: "1945", wrong: ["1943", "1944", "1946"], category: "History: Modern", difficulty: "easy", es: { text: "¿En qué año terminó la Segunda Guerra Mundial en Europa?", correct: "1945", wrong: ["1943", "1944", "1946"] } },
    { text: "Who became the first human to travel into space, in April 1961?", correct: "Yuri Gagarin", wrong: ["Alan Shepard", "John Glenn", "Neil Armstrong"], category: "History: Modern", difficulty: "easy", es: { text: "¿Quién fue el primer ser humano en viajar al espacio, en abril de 1961?", correct: "Yuri Gagarin", wrong: ["Alan Shepard", "John Glenn", "Neil Armstrong"] } },
    { text: "Which volcano's eruption in AD 79 buried the Roman town of Pompeii?", correct: "Mount Vesuvius", wrong: ["Mount Etna", "Krakatoa", "Mount Fuji"], category: "History: Classics", difficulty: "easy", es: { text: "¿Qué volcán sepultó con su erupción la ciudad romana de Pompeya en el año 79 d. C.?", correct: "Monte Vesubio", wrong: ["Monte Etna", "Krakatoa", "Monte Fuji"] } },
    { text: "Who became South Africa's president in 1994 after 27 years in prison?", correct: "Nelson Mandela", wrong: ["Desmond Tutu", "Steve Biko", "Thabo Mbeki"], category: "History: Africa", difficulty: "easy", es: { text: "¿Quién llegó a la presidencia de Sudáfrica en 1994 tras 27 años en prisión?", correct: "Nelson Mandela", wrong: ["Desmond Tutu", "Steve Biko", "Thabo Mbeki"] } },
    { text: "Who led the 1930 Salt March in British India?", correct: "Mohandas Gandhi", wrong: ["Jawaharlal Nehru", "Muhammad Ali Jinnah", "Subhas Chandra Bose"], category: "History: Asia", difficulty: "medium", es: { text: "¿Quién encabezó la Marcha de la Sal de 1930 en la India británica?", correct: "Mohandas Gandhi", wrong: ["Jawaharlal Nehru", "Muhammad Ali Jinnah", "Subhas Chandra Bose"] } },
    { text: "Which ruler of Mali made a famously lavish pilgrimage to Mecca in 1324?", correct: "Mansa Musa", wrong: ["Sundiata Keita", "Askia Muhammad", "Sunni Ali"], category: "History: Africa", difficulty: "medium", es: { text: "¿Qué soberano de Malí hizo en 1324 una fastuosa peregrinación a La Meca?", correct: "Mansa Musa", wrong: ["Sundiata Keita", "Askia Muhammad", "Sunni Ali"] } },
    { text: "Which 1919 treaty set the peace terms between Germany and the Allied powers after World War I?", correct: "Treaty of Versailles", wrong: ["Treaty of Trianon", "Treaty of Sevres", "Treaty of Utrecht"], category: "History: Europe", difficulty: "medium", es: { text: "¿Qué tratado de 1919 fijó las condiciones de paz entre Alemania y las potencias aliadas tras la Primera Guerra Mundial?", correct: "Tratado de Versalles", wrong: ["Tratado de Trianón", "Tratado de Sèvres", "Tratado de Utrecht"] } },
    { text: "In what year did China's last emperor abdicate, ending the Qing dynasty?", correct: "1912", wrong: ["1900", "1905", "1927"], category: "History: Asia", difficulty: "medium", es: { text: "¿En qué año abdicó el último emperador de China y puso fin a la dinastía Qing?", correct: "1912", wrong: ["1900", "1905", "1927"] } },
    { text: "What was the capital city of the Aztec Empire?", correct: "Tenochtitlan", wrong: ["Cusco", "Tikal", "Chichen Itza"], category: "History: Americas", difficulty: "medium", es: { text: "¿Cuál era la capital del Imperio azteca?", correct: "Tenochtitlán", wrong: ["Cusco", "Tikal", "Chichén Itzá"] } },
    { text: "Which Indian empire did the emperor Ashoka rule in the third century BC?", correct: "Maurya Empire", wrong: ["Gupta Empire", "Mughal Empire", "Chola Empire"], category: "History: Asia", difficulty: "medium", es: { text: "¿Qué imperio de la India gobernó el emperador Ashoka en el siglo III a. C.?", correct: "Imperio maurya", wrong: ["Imperio gupta", "Imperio mogol", "Imperio chola"] } },
    { text: "What charter did English barons force King John to accept in 1215?", correct: "Magna Carta", wrong: ["Provisions of Oxford", "Petition of Right", "English Bill of Rights"], category: "History: Europe", difficulty: "medium", es: { text: "¿Qué documento impusieron los barones ingleses al rey Juan en 1215?", correct: "Carta Magna", wrong: ["Provisiones de Oxford", "Petición de Derechos", "Declaración de Derechos inglesa"] } },
    { text: "Who was the first woman awarded a Nobel Prize?", correct: "Marie Curie", wrong: ["Bertha von Suttner", "Irene Joliot-Curie", "Selma Lagerlof"], category: "History: Science", difficulty: "medium", es: { text: "¿Quién fue la primera mujer en recibir un Premio Nobel?", correct: "Marie Curie", wrong: ["Bertha von Suttner", "Irène Joliot-Curie", "Selma Lagerlöf"] } },
    { text: "In what year was the Soviet Union formally dissolved?", correct: "1991", wrong: ["1989", "1990", "1993"], category: "History: Modern", difficulty: "medium", es: { text: "¿En qué año se disolvió formalmente la Unión Soviética?", correct: "1991", wrong: ["1989", "1990", "1993"] } },
    { text: "What was the name of the shogunate that ruled Japan from 1603 to 1868?", correct: "Tokugawa shogunate", wrong: ["Kamakura shogunate", "Ashikaga shogunate", "Hojo shogunate"], category: "History: Asia", difficulty: "medium", es: { text: "¿Cómo se llamaba el shogunato que gobernó Japón entre 1603 y 1868?", correct: "Shogunato Tokugawa", wrong: ["Shogunato Kamakura", "Shogunato Ashikaga", "Shogunato Hojo"] } },
    { text: "Who captained the ship that completed the first circumnavigation of the globe in 1522?", correct: "Juan Sebastian Elcano", wrong: ["Ferdinand Magellan", "Francis Drake", "Vasco da Gama"], category: "History: Exploration", difficulty: "hard", es: { text: "¿Quién capitaneó la nave que completó la primera vuelta al mundo en 1522?", correct: "Juan Sebastián Elcano", wrong: ["Fernando de Magallanes", "Francis Drake", "Vasco da Gama"] } },
    { text: "Which Chinese dynasty completed the Grand Canal linking the Yellow and Yangtze rivers around 609?", correct: "Sui dynasty", wrong: ["Tang dynasty", "Han dynasty", "Ming dynasty"], category: "History: Asia", difficulty: "hard", es: { text: "¿Qué dinastía china completó hacia el año 609 el Gran Canal que enlaza el río Amarillo con el Yangtsé?", correct: "Dinastía Sui", wrong: ["Dinastía Tang", "Dinastía Han", "Dinastía Ming"] } },
    { text: "Which caliphate defeated Tang Chinese forces at the Battle of Talas in 751?", correct: "Abbasid Caliphate", wrong: ["Umayyad Caliphate", "Fatimid Caliphate", "Rashidun Caliphate"], category: "History: Medieval", difficulty: "hard", es: { text: "¿Qué califato derrotó a las tropas chinas de la dinastía Tang en la batalla de Talas en 751?", correct: "Califato abasí", wrong: ["Califato omeya", "Califato fatimí", "Califato ortodoxo"] } },
    { text: "At which battle in 1896 did Ethiopian forces defeat an invading Italian army?", correct: "Battle of Adwa", wrong: ["Battle of Omdurman", "Battle of Isandlwana", "Battle of Blood River"], category: "History: Africa", difficulty: "hard", es: { text: "¿En qué batalla de 1896 derrotaron las fuerzas etíopes a un ejército italiano invasor?", correct: "Batalla de Adua", wrong: ["Batalla de Omdurmán", "Batalla de Isandlwana", "Batalla del Río Sangriento"] } },
    { text: "In what year did Haiti declare its independence from France?", correct: "1804", wrong: ["1791", "1799", "1812"], category: "History: Americas", difficulty: "hard", es: { text: "¿En qué año declaró Haití su independencia de Francia?", correct: "1804", wrong: ["1791", "1799", "1812"] } },
    { text: "Which admiral used armored turtle ships to defeat Japanese fleets in the 1590s?", correct: "Yi Sun-sin", wrong: ["Zheng He", "Koxinga", "Gwon Yul"], category: "History: Asia", difficulty: "hard", es: { text: "¿Qué almirante empleó barcos tortuga acorazados para derrotar a las flotas japonesas en la década de 1590?", correct: "Yi Sun-sin", wrong: ["Zheng He", "Koxinga", "Gwon Yul"] } },
  ],
  geography: [
    { text: "What is the capital city of Australia?", correct: "Canberra", wrong: ["Sydney", "Melbourne", "Perth"], category: "Geography: Capitals", difficulty: "easy", es: { text: "¿Cuál es la capital de Australia?", correct: "Canberra", wrong: ["Sídney", "Melbourne", "Perth"] } },
    { text: "Which country shares the southern land border of the United States?", correct: "Mexico", wrong: ["Guatemala", "Belize", "Honduras"], category: "Geography: Borders", difficulty: "easy", es: { text: "¿Qué país comparte la frontera terrestre sur de Estados Unidos?", correct: "México", wrong: ["Guatemala", "Belice", "Honduras"] } },
    { text: "Which mountain range runs down the western side of South America?", correct: "Andes", wrong: ["Rocky Mountains", "Atlas Mountains", "Ural Mountains"], category: "Geography: Physical", difficulty: "easy", es: { text: "¿Qué cordillera recorre el oeste de América del Sur?", correct: "Andes", wrong: ["Montañas Rocosas", "Montes Atlas", "Montes Urales"] } },
    { text: "Which country has the greatest total area on Earth?", correct: "Russia", wrong: ["Canada", "China", "United States"], category: "Geography: Classics", difficulty: "easy", es: { text: "¿Qué país tiene la mayor superficie total del planeta?", correct: "Rusia", wrong: ["Canadá", "China", "Estados Unidos"] } },
    { text: "Which state of the United States covers the biggest area?", correct: "Alaska", wrong: ["Texas", "California", "Montana"], category: "Geography: Physical", difficulty: "easy", es: { text: "¿Qué estado de Estados Unidos abarca la mayor superficie?", correct: "Alaska", wrong: ["Texas", "California", "Montana"] } },
    { text: "Which continent contains the South Pole?", correct: "Antarctica", wrong: ["South America", "Australia", "Africa"], category: "Geography: Classics", difficulty: "easy", es: { text: "¿En qué continente se encuentra el Polo Sur?", correct: "Antártida", wrong: ["América del Sur", "Australia", "África"] } },
    { text: "Which ocean lies between Europe and North America?", correct: "Atlantic Ocean", wrong: ["Pacific Ocean", "Indian Ocean", "Southern Ocean"], category: "Geography: Oceans and Seas", difficulty: "easy", es: { text: "¿Qué océano se encuentra entre Europa y América del Norte?", correct: "Océano Atlántico", wrong: ["Océano Pacífico", "Océano Índico", "Océano Antártico"] } },
    { text: "Which mountain reaches the highest elevation above sea level?", correct: "Mount Everest", wrong: ["K2", "Kangchenjunga", "Denali"], category: "Geography: Physical", difficulty: "easy", es: { text: "¿Qué montaña alcanza la mayor altitud sobre el nivel del mar?", correct: "Monte Everest", wrong: ["K2", "Kangchenjunga", "Denali"] } },
    { text: "Which country completely surrounds Lesotho?", correct: "South Africa", wrong: ["Namibia", "Botswana", "Zimbabwe"], category: "Geography: Borders", difficulty: "medium", es: { text: "¿Qué país rodea por completo a Lesoto?", correct: "Sudáfrica", wrong: ["Namibia", "Botsuana", "Zimbabue"] } },
    { text: "Which strait separates Spain from Morocco?", correct: "Strait of Gibraltar", wrong: ["Strait of Hormuz", "Strait of Malacca", "Bering Strait"], category: "Geography: Oceans and Seas", difficulty: "medium", es: { text: "¿Qué estrecho separa España de Marruecos?", correct: "Estrecho de Gibraltar", wrong: ["Estrecho de Ormuz", "Estrecho de Malaca", "Estrecho de Bering"] } },
    { text: "In which country does Mount Kilimanjaro stand?", correct: "Tanzania", wrong: ["Kenya", "Uganda", "Ethiopia"], category: "Geography: Physical", difficulty: "medium", es: { text: "¿En qué país se encuentra el monte Kilimanjaro?", correct: "Tanzania", wrong: ["Kenia", "Uganda", "Etiopía"] } },
    { text: "Which river flows through the city of Baghdad?", correct: "Tigris", wrong: ["Euphrates", "Jordan", "Indus"], category: "Geography: Rivers", difficulty: "medium", es: { text: "¿Qué río atraviesa la ciudad de Bagdad?", correct: "Tigris", wrong: ["Éufrates", "Jordán", "Indo"] } },
    { text: "Which desert stretches across southern Mongolia and northern China?", correct: "Gobi Desert", wrong: ["Taklamakan Desert", "Kalahari Desert", "Atacama Desert"], category: "Geography: Deserts", difficulty: "medium", es: { text: "¿Qué desierto se extiende por el sur de Mongolia y el norte de China?", correct: "Desierto de Gobi", wrong: ["Desierto de Taklamakán", "Desierto del Kalahari", "Desierto de Atacama"] } },
    { text: "Which country covers the largest area in Africa?", correct: "Algeria", wrong: ["Sudan", "Libya", "Chad"], category: "Geography: Classics", difficulty: "medium", es: { text: "¿Qué país abarca la mayor superficie de África?", correct: "Argelia", wrong: ["Sudán", "Libia", "Chad"] } },
    { text: "Which island has the largest area of any island on Earth?", correct: "Greenland", wrong: ["New Guinea", "Borneo", "Madagascar"], category: "Geography: Islands", difficulty: "medium", es: { text: "¿Qué isla tiene la mayor superficie del planeta?", correct: "Groenlandia", wrong: ["Nueva Guinea", "Borneo", "Madagascar"] } },
    { text: "Into which body of water does the Volga River empty?", correct: "Caspian Sea", wrong: ["Black Sea", "Baltic Sea", "Aral Sea"], category: "Geography: Rivers", difficulty: "medium", es: { text: "¿En qué masa de agua desemboca el río Volga?", correct: "Mar Caspio", wrong: ["Mar Negro", "Mar Báltico", "Mar de Aral"] } },
    { text: "In which year did the Suez Canal open to shipping?", correct: "1869", wrong: ["1832", "1889", "1914"], category: "Geography: Waterways", difficulty: "medium", es: { text: "¿En qué año se abrió el canal de Suez a la navegación?", correct: "1869", wrong: ["1832", "1889", "1914"] } },
    { text: "Who led the first expedition to reach the South Pole?", correct: "Roald Amundsen", wrong: ["Robert Falcon Scott", "Ernest Shackleton", "Richard Byrd"], category: "Geography: Exploration", difficulty: "medium", es: { text: "¿Quién dirigió la primera expedición que llegó al Polo Sur?", correct: "Roald Amundsen", wrong: ["Robert Falcon Scott", "Ernest Shackleton", "Richard Byrd"] } },
    { text: "Senegal wraps around the land borders of which country?", correct: "The Gambia", wrong: ["Guinea-Bissau", "Mauritania", "Sierra Leone"], category: "Geography: Borders", difficulty: "hard", es: { text: "¿Qué país limita por tierra únicamente con Senegal?", correct: "Gambia", wrong: ["Guinea-Bisáu", "Mauritania", "Sierra Leona"] } },
    { text: "Which strait connects the Black Sea to the Sea of Marmara?", correct: "Bosporus", wrong: ["Dardanelles", "Kerch Strait", "Strait of Otranto"], category: "Geography: Oceans and Seas", difficulty: "hard", es: { text: "¿Qué estrecho comunica el mar Negro con el mar de Mármara?", correct: "Bósforo", wrong: ["Dardanelos", "Estrecho de Kerch", "Estrecho de Otranto"] } },
    { text: "Which lake is the deepest in the world?", correct: "Lake Baikal", wrong: ["Lake Tanganyika", "Lake Superior", "Great Slave Lake"], category: "Geography: Physical", difficulty: "hard", es: { text: "¿Qué lago es el más profundo del mundo?", correct: "Lago Baikal", wrong: ["Lago Tanganica", "Lago Superior", "Gran Lago del Esclavo"] } },
    { text: "In which country do the Blue Nile and the White Nile join?", correct: "Sudan", wrong: ["Egypt", "Ethiopia", "South Sudan"], category: "Geography: Rivers", difficulty: "hard", es: { text: "¿En qué país se unen el Nilo Azul y el Nilo Blanco?", correct: "Sudán", wrong: ["Egipto", "Etiopía", "Sudán del Sur"] } },
    { text: "Which sea is bounded entirely by ocean currents rather than by land?", correct: "Sargasso Sea", wrong: ["Coral Sea", "Tasman Sea", "Andaman Sea"], category: "Geography: Oceans and Seas", difficulty: "hard", es: { text: "¿Qué mar está delimitado únicamente por corrientes oceánicas y no por tierra?", correct: "Mar de los Sargazos", wrong: ["Mar del Coral", "Mar de Tasmania", "Mar de Andamán"] } },
    { text: "On which river does the city of Prague stand?", correct: "Vltava", wrong: ["Danube", "Elbe", "Oder"], category: "Geography: Rivers", difficulty: "hard", es: { text: "¿A orillas de qué río se encuentra la ciudad de Praga?", correct: "Moldava", wrong: ["Danubio", "Elba", "Óder"] } },
  ],
};

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
