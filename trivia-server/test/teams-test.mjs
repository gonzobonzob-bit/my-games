// Protocol-level tests for teams mode, same raw-socket style as
// genre-test.mjs. No browser: covers team setup/join/leader handoff,
// leader-only answer enforcement, team-based reveal/scoring, and the
// custom-quiz validation path.
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
  all(t) { return this.msgs.filter((m) => m.type === t); }
  async wait(t, ms = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = this.last(t); if (m) return m; await sleep(60); }
    throw new Error(`${this.name}: no '${t}' in ${ms}ms`);
  }
  async waitFor(pred, ms = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = this.msgs.find(pred); if (m) return m; await sleep(60); }
    throw new Error(`${this.name}: predicate never matched in ${ms}ms`);
  }
  close() { try { this.ws.close(); } catch {} }
}

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const room = () => Array.from({ length: 6 },
  () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
const settle = () => sleep(600);

function fourChoiceQuestion(n, correct) {
  return {
    text: 'Q' + n + '?',
    choices: ['A' + n, 'B' + n, 'C' + n, 'D' + n],
    correctIndex: correct,
  };
}

try {
  // ---- 1. mode switch resets teams/customQuestions, source pins to genre
  //         outside teams mode -------------------------------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect();
    await A.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    const s1 = await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
    ok(s1.settings.mode === 'teams', 'mode switches to teams');

    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'classic', source: 'custom' } });
    const s2 = await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'classic');
    ok(s2.settings.source === 'genre', 'source is pinned to genre outside teams mode', s2.settings);
    A.close();
  }

  await settle();
  // ---- 2. team setup, join, leader auto-assignment, switching teams -----
  // Ann is the host throughout this suite now — never a team candidate, so
  // Bea and Cat are the ones who actually join/lead/switch teams.
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');
    const Cat = new C('Cat', r); await Cat.connect(); await Cat.wait('welcome');

    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');

    A.send({ type: 'teamSetup', count: 2, names: ['Red', 'Blue'] });
    const r1 = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 2);
    ok(r1.teams.length === 2, 'teamSetup creates the requested number of teams', r1.teams);
    ok(r1.teams[0].name === 'Red' && r1.teams[1].name === 'Blue', 'teamSetup honours the supplied names', r1.teams);

    const redId = r1.teams[0].id, blueId = r1.teams[1].id;

    // The host moderates — trying to join is refused outright, not silently
    // ignored, and nobody's membership changes because of it.
    A.send({ type: 'joinTeam', teamId: redId });
    const hostErr = await A.wait('error', 4000);
    ok(hostErr.code === 'hostNoTeam', 'the host is refused when trying to join a team', hostErr);

    B.send({ type: 'joinTeam', teamId: redId });
    const rA = await B.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams)
      && m.teams.find((t) => t.id === redId)?.leaderId);
    const teamRed = rA.teams.find((t) => t.id === redId);
    ok(teamRed.memberIds.length === 1, 'Bea joined Red', teamRed);

    const beaPid = rA.players.find((p) => p.name === 'Bea').id;
    ok(teamRed.leaderId === beaPid, 'first member of a team becomes its leader');

    Cat.send({ type: 'joinTeam', teamId: redId });
    const rB = await Cat.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams)
      && m.teams.find((t) => t.id === redId)?.memberIds.length === 2);
    const teamRed2 = rB.teams.find((t) => t.id === redId);
    ok(teamRed2.leaderId === beaPid, 'second member joining does not steal leadership');

    // Cat switches to Blue — Red should shrink back to just Bea.
    Cat.send({ type: 'joinTeam', teamId: blueId });
    const rC = await Cat.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams)
      && m.teams.find((t) => t.id === blueId)?.memberIds.length === 1);
    const teamRedAfter = rC.teams.find((t) => t.id === redId);
    const teamBlueAfter = rC.teams.find((t) => t.id === blueId);
    ok(teamRedAfter.memberIds.length === 1, 'switching teams removes the old membership', teamRedAfter);
    const catPid = rC.players.find((p) => p.name === 'Cat').id;
    ok(teamBlueAfter.leaderId === catPid, 'joining an empty team makes you its leader');
    A.close(); B.close(); Cat.close();
  }

  await settle();
  // ---- 3. only the team leader can submit an answer; reveal is team-based,
  //         and never leaks correctness before every active team has
  //         answered --------------------------------------------------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');
    const Cat = new C('Cat', r); await Cat.connect(); await Cat.wait('welcome');

    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
    // count:2 — TEAM_COUNT_MIN is 2, a "team of one" is just classic mode
    // with extra steps. Ann hosts and never joins; Cat and Bea both join
    // team 0, team 1 sits empty and simply never shows up in
    // allTeamsAnswered()'s active set.
    A.send({ type: 'teamSetup', count: 2 });
    const setup = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 2);
    const teamId = setup.teams[0].id;
    Cat.send({ type: 'joinTeam', teamId });
    await Cat.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams[0] && m.teams[0].memberIds.length === 1);
    B.send({ type: 'joinTeam', teamId });
    const afterJoin = await B.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams[0] && m.teams[0].memberIds.length === 2);
    const catPid = afterJoin.players.find((p) => p.name === 'Cat').id;
    ok(afterJoin.teams[0].leaderId === catPid, 'Cat (first in) is the leader, not Bea');

    A.send({ type: 'openEvent' });
    await A.waitFor((m) => m.type === 'phase' && m.phase === 'standby');
    A.send({ type: 'start' });
    const q = await A.wait('question', 15000);
    ok(!!q && Array.isArray(q.choices), 'teams-mode genre start produces a question');
    // Protocol tripwire, same as classic: nothing answer-shaped on the wire.
    ok(!('correctIndex' in q), 'question carries no correctIndex');

    // Bea (not the leader) tries to answer and must be refused with a clear
    // error, not a silent drop — and the room must NOT have moved to reveal.
    B.msgs.length = 0;
    B.send({ type: 'answer', index: q.index, choice: 0 });
    const err = await B.wait('error', 4000);
    ok(err.code === 'notLeader', 'a non-leader answering gets code=notLeader', err);
    await settle();
    ok(!B.all('reveal').length, 'the room did not reveal off a non-leader answer');

    Cat.msgs.length = 0; B.msgs.length = 0;
    Cat.send({ type: 'answer', index: q.index, choice: 1 });
    const answered = await B.wait('answered', 4000);
    ok(answered.teamId === teamId, 'the answered broadcast carries teamId, not playerId', answered);
    ok(!('playerId' in answered), 'teams-mode answered frame has no playerId field');

    const rev = await B.wait('reveal', 4000);
    ok(rev.mode === 'teams', 'reveal says mode: teams');
    // One perTeam entry per team that EXISTS, including the empty second
    // team — doReveal() walks g.teams, same as doReveal walks g.players in
    // classic mode, so an empty team still gets a (null-choice) entry.
    ok(Array.isArray(rev.perTeam) && rev.perTeam.length === 2, 'reveal carries one perTeam entry per team', rev.perTeam);
    const mine = rev.perTeam.find((t) => t.id === teamId);
    ok(!!mine, 'the perTeam entry for our team is present by team id');
    ok(mine.choice === 1, 'the revealed choice matches what the leader submitted', mine);
    const emptyTeam = rev.perTeam.find((t) => t.id !== teamId);
    ok(emptyTeam && emptyTeam.choice === null, 'the empty second team has no choice, not an error', emptyTeam);
    ok(Array.isArray(rev.scores) && rev.scores.find((s) => s.id === teamId), 'scores are keyed by team id, not player id');

    // Teams mode is host-paced: unlike classic mode's 6s auto-advance, the
    // room must sit on the reveal until the host explicitly says to move on.
    // An assertion never seen to fail is not evidence, so this actually
    // waits past the old REVEAL_MS window and checks nothing arrived on its
    // own before also checking the host's 'next' still works.
    ok(!rev.nextAt, 'teams-mode reveal carries no auto-advance deadline', rev.nextAt);
    B.msgs.length = 0;
    await sleep(6500);
    const autoAdvanced = B.msgs.find((m) => m.type === 'phase' || m.type === 'question');
    ok(!autoAdvanced, 'teams mode does not auto-advance past reveal without the host', autoAdvanced);
    A.send({ type: 'next' });
    const nextQ = await B.wait('question', 4000);
    ok(nextQ.index === q.index + 1, 'the host can still manually advance to the next question', nextQ);

    A.close(); B.close(); Cat.close();
  }

  await settle();
  // ---- 4. custom quiz: validation, all-or-nothing, and the start path ---
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');

    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'custom' } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.source === 'custom');

    // Malformed batch: one question has a duplicate choice. The whole batch
    // must be refused, not silently trimmed to the good ones.
    A.msgs.length = 0;
    A.send({ type: 'questions', items: [
      fourChoiceQuestion(1, 0),
      { text: 'bad', choices: ['x', 'x', 'y', 'z'], correctIndex: 0 },
    ] });
    const badErr = await A.wait('error', 4000);
    ok(/incomplete/.test(badErr.message || ''), 'a malformed quiz batch is refused with a reason', badErr);

    A.msgs.length = 0;
    A.send({ type: 'questions', items: [fourChoiceQuestion(1, 2), fourChoiceQuestion(2, 0)] });
    const saved = await A.wait('customQuestions', 4000);
    ok(saved.count === 2, 'a valid quiz batch saves and reports its count', saved);

    A.send({ type: 'teamSetup', count: 2 });
    const setup = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 2);
    // Ann hosts and never joins a team; Bea is the actual team member here.
    B.send({ type: 'joinTeam', teamId: setup.teams[0].id });
    await B.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams[0] && m.teams[0].memberIds.length === 1);

    A.msgs.length = 0;
    A.send({ type: 'openEvent' });
    await A.waitFor((m) => m.type === 'phase' && m.phase === 'standby');
    A.send({ type: 'start' });
    const notice = await A.wait('notice', 6000);
    ok(notice.code === 'custom', 'starting a custom quiz announces itself as custom, not offline/bilingual', notice);
    const q1 = await A.wait('question', 4000);
    ok(/^Q[12]\?$/.test(q1.text), 'the custom-authored question text reaches the client', q1);
    ok(q1.choices.length === 4 && new Set(q1.choices).size === 4, 'choices were shuffled and stayed unique');
    A.close(); B.close();
  }

  await settle();
  // ---- 4b. media on a custom question: image/audio ok, video refused,
  //          oversized refused, mismatched prefix refused, and a valid
  //          attachment actually reaches the client on the live question ---
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'custom' } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.source === 'custom');
    A.send({ type: 'teamSetup', count: 2 });
    const teamsUp = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 2);
    B.send({ type: 'joinTeam', teamId: teamsUp.teams[0].id });
    await B.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams[0] && m.teams[0].memberIds.length === 1);

    const tinyPngDataUrl = 'data:image/png;base64,' + 'A'.repeat(100);

    A.msgs.length = 0;
    A.send({ type: 'questions', items: [
      { ...fourChoiceQuestion(1, 0), media: { type: 'video', dataUrl: 'data:video/mp4;base64,AAAA' } },
    ] });
    const videoErr = await A.wait('error', 4000);
    ok(/incomplete/.test(videoErr.message || ''), 'video media is refused — not a supported type yet', videoErr);

    A.msgs.length = 0;
    A.send({ type: 'questions', items: [
      { ...fourChoiceQuestion(1, 0), media: { type: 'image', dataUrl: 'data:audio/mpeg;base64,' + 'A'.repeat(100) } },
    ] });
    const mismatchErr = await A.wait('error', 4000);
    ok(/incomplete/.test(mismatchErr.message || ''), 'a data URL whose prefix does not match the claimed type is refused', mismatchErr);

    A.msgs.length = 0;
    A.send({ type: 'questions', items: [
      { ...fourChoiceQuestion(1, 0), media: { type: 'image', dataUrl: 'data:image/png;base64,' + 'A'.repeat(300001) } },
    ] });
    const tooBigErr = await A.wait('error', 4000);
    ok(/incomplete/.test(tooBigErr.message || ''), 'an oversized image data URL is refused', tooBigErr);

    A.msgs.length = 0;
    A.send({ type: 'questions', items: [
      { ...fourChoiceQuestion(1, 0), media: { type: 'image', dataUrl: tinyPngDataUrl } },
      fourChoiceQuestion(2, 0),
    ] });
    const mediaSaved = await A.wait('customQuestions', 4000);
    ok(mediaSaved.count === 2, 'a valid image attachment saves normally', mediaSaved);

    A.send({ type: 'openEvent' });
    await A.waitFor((m) => m.type === 'phase' && m.phase === 'standby');
    A.send({ type: 'start' });
    await A.wait('notice', 6000);
    const mq = await A.wait('question', 4000);
    // media travels with whichever question actually comes up first — the
    // custom quiz is shuffled, so check whichever of the two this is.
    if (mq.text === 'Q1?') {
      ok(!!mq.media && mq.media.type === 'image' && mq.media.dataUrl === tinyPngDataUrl,
         'the image attachment reaches the client on the live question', mq.media);
    } else {
      ok(mq.media === undefined, 'a question authored with no media carries none', mq.media);
    }
    A.close(); B.close();
  }

  await settle();
  // ---- 5. starting a teams game with an unassigned player is refused ----
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');
    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');
    A.send({ type: 'teamSetup', count: 2 });
    await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 2);
    // Ann hosts (never a team candidate) and Bea never joins a team either.
    A.msgs.length = 0;
    A.send({ type: 'openEvent' });
    await A.waitFor((m) => m.type === 'phase' && m.phase === 'standby');
    A.send({ type: 'start' });
    const err = await A.wait('error', 4000);
    ok(err.code === 'needTeam', 'starting with an unassigned connected player is refused', err);
    A.close(); B.close();
  }

  // ---- 6. standby phase: doors open, config locked, teams/captains stay
  //         open, questions refuse to start before the doors do ------------
  {
    const r = room();
    const A = new C('Ann', r); await A.connect(); await A.wait('welcome');
    const B = new C('Bea', r); await B.connect(); await B.wait('welcome');
    const Cat = new C('Cat', r); await Cat.connect(); await Cat.wait('welcome');

    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    await A.waitFor((m) => m.type === 'settings' && m.settings.mode === 'teams');

    // Can't open the doors on a teams room with no teams set up yet.
    A.msgs.length = 0;
    A.send({ type: 'openEvent' });
    const noTeamsYet = await A.wait('error', 4000);
    ok(noTeamsYet.code === 'setupTeamsFirst', 'opening the event on a teams room refuses without teams set up', noTeamsYet);

    A.send({ type: 'teamSetup', count: 2 });
    const setup = await A.waitFor((m) => m.type === 'roster' && Array.isArray(m.teams) && m.teams.length === 2);
    const teamId = setup.teams[0].id;

    // 'start' before 'openEvent' is refused — standby is a real gate, not
    // just a cosmetic screen.
    A.msgs.length = 0;
    A.send({ type: 'start' });
    const tooSoon = await A.wait('error', 4000);
    ok(/open the event/i.test(tooSoon.message || ''), 'start is refused before the event has been opened', tooSoon);

    A.msgs.length = 0;
    A.send({ type: 'openEvent' });
    const opened = await A.waitFor((m) => m.type === 'phase' && m.phase === 'standby');
    ok(opened.phase === 'standby', 'openEvent moves the room into standby', opened);

    // Config stays locked once doors are open — same 'alreadyStarted' refusal
    // every other lobby-only handler already gives mid-game.
    A.msgs.length = 0;
    A.send({ type: 'settings', settings: { genre: 'mixed', difficulty: 'any', mode: 'teams', source: 'genre' } });
    const settingsRefused = await A.wait('error', 4000);
    ok(settingsRefused.code === 'alreadyStarted', 'settings changes are refused once standby has started', settingsRefused);
    A.msgs.length = 0;
    A.send({ type: 'teamSetup', count: 3 });
    const teamSetupRefused = await A.wait('error', 4000);
    ok(teamSetupRefused.code === 'alreadyStarted', 'teamSetup is refused once standby has started', teamSetupRefused);

    // But a player can still walk in, pick a team, and claim its captaincy —
    // the whole point of a waiting room.
    B.send({ type: 'joinTeam', teamId });
    const bJoined = await B.waitFor((m) => m.type === 'roster' && m.teams && m.teams.find((t) => t.id === teamId)?.memberIds.length === 1);
    const beaPid = bJoined.players.find((p) => p.name === 'Bea').id;
    ok(bJoined.teams.find((t) => t.id === teamId).leaderId === beaPid, 'joining in standby still auto-assigns the first member as leader', bJoined);

    Cat.send({ type: 'joinTeam', teamId });
    await Cat.waitFor((m) => m.type === 'roster' && m.teams && m.teams.find((t) => t.id === teamId)?.memberIds.length === 2);

    Cat.msgs.length = 0;
    Cat.send({ type: 'claimCaptain' });
    const claimed = await Cat.waitFor((m) => m.type === 'roster' && m.teams && m.teams.find((t) => t.id === teamId)?.leaderId);
    const catPid = claimed.players.find((p) => p.name === 'Cat').id;
    ok(claimed.teams.find((t) => t.id === teamId).leaderId === catPid, 'claimCaptain hands the star to whoever claims it, overriding the default', claimed);

    // The host is never on a team, so has nothing to claim.
    A.msgs.length = 0;
    A.send({ type: 'claimCaptain' });
    const hostClaim = await A.wait('error', 4000);
    ok(/join a team/i.test(hostClaim.message || ''), 'the host is refused when trying to claim captaincy', hostClaim);

    // Now actually fire question 1, and confirm captaincy is locked: Bea
    // (the ORIGINAL leader, now demoted) cannot answer; Cat (the claimed
    // captain) can.
    A.send({ type: 'start' });
    const q1 = await A.wait('question', 15000);
    B.msgs.length = 0;
    B.send({ type: 'answer', index: q1.index, choice: 0 });
    const beaRefused = await B.wait('error', 4000);
    ok(beaRefused.code === 'notLeader', 'the demoted original leader can no longer answer for the team', beaRefused);

    Cat.msgs.length = 0;
    Cat.send({ type: 'claimCaptain' });
    const midGameClaim = await Cat.wait('error', 4000);
    ok(/lock in once the game starts/i.test(midGameClaim.message || ''), 'claimCaptain is refused once the game has started', midGameClaim);

    A.close(); B.close(); Cat.close();
  }

} catch (e) {
  fails.push('FAIL  threw: ' + (e && e.stack || e));
}

console.log(notes.join('\n'));
if (fails.length) {
  console.log('\n' + fails.join('\n'));
  console.log(`\n${fails.length} FAILED / ${notes.length + fails.length} total`);
  process.exit(1);
} else {
  console.log(`\nALL ${notes.length} PASSED`);
}
