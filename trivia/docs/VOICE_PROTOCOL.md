# Late Signal — voice protocol contract (pass 2, Feature A)

**This file is the frozen interface between `trivia-server/src/index.js` and
`trivia/index.html`.** Two owners build against it in parallel. If you believe
the contract is wrong, say so — do not quietly implement something else, because
the other side is implementing this exact text.

Feature B (themes) of the pass 2 brief already shipped. This is voice only.

## Shape

WebRTC full-mesh audio between **players only**, 1–8. Spectators are never in
the mesh — they are the studio audience. Signalling rides the existing room
WebSocket through the Room DO. No SFU, no TURN, no purchase.

STUN: `stun:stun.cloudflare.com:3478`. Same vendor already hosting the backend,
so it is accepted infra rather than a third-party API call in the CLAUDE.md
sense. If a NAT pair cannot connect through STUN alone, that pair degrades to
"voice unavailable with this player" — **voice never blocks the game.**

## THE INVARIANT — why voice does not threaten it

The invariant protects one thing: the client must not learn `correctIndex`
early. The subtle form is that **per-player state which reacts to correctness**
must be written only inside `doReveal()`, because a roster frame carrying it
mid-question is an answer oracle.

Voice state does not react to correctness. `voiceOn` reacts to a player tapping
their mic; `hostMuted` reacts to the host clicking mute. Neither is a function
of any answer, so both are safe to write outside `doReveal()` and safe to
broadcast in a `roster` frame during a question.

**Do not add any voice-adjacent field that is a function of answering** — e.g.
"auto-mute players who have locked in." That would be an oracle. If you want
that feature, it has to wait for reveal.

The signalling relay carries opaque payloads the DO never parses, so it cannot
leak anything it does not already have.

## Server — `trivia-server/src/index.js`

### 1. Room setting `voice`

`g.settings.voice`, boolean, **default `false`**.

In `sanitizeSettings()`, field by field like everything else, strict compare:

```js
out.voice = raw && raw.voice === true;
```

Nothing truthy-but-wrong may flip it on, same discipline as `g.public`.

Authority and phase rules are the existing ones for `settings`: **host only,
lobby only.** This is deliberate — voice cannot be toggled mid-game. The host
sets it before starting; a room that replays (`again`) returns to the lobby and
can change it then. Per-player mic mute is always available and is what people
actually reach for mid-game.

`welcome` already ships `settings`, so a joining client learns `voice` for free.

### 2. Roster gains two per-player booleans

`roster()` adds to each entry:

- `voice` — that player's mic is live in the mesh (they unmuted). Advisory,
  for display.
- `muted` — the host has muted them. **Authoritative.**

Backed by `g.players[pid].voiceOn` and `g.players[pid].hostMuted`.
`normalizeGame()` coerces both to booleans on load — players persist, and rooms
saved before these fields existed come back without them.

### 3. Three new client → server messages

All are player-only. The existing `a.spectator` guard at the top of
`webSocketMessage()` already refuses every one of them, which is exactly right:
a spectator cannot enter the mesh because they cannot send a signal.

#### `{ type: 'voice-signal', to: <playerId>, data: <opaque> }`

Relayed **blind** to that player's socket(s) as:

```js
{ type: 'voice-signal', from: <senderPlayerId>, data: <opaque> }
```

The DO never parses, inspects, validates or logs `data`. It is offer, answer and
ICE candidate all at once — one relay path instead of three, and the DO cannot
parse SDP by construction rather than by good intentions. (This deviates from
the brief's `voice-offer`/`-answer`/`-ice`; the deviation is deliberate and
narrows the DO's surface.)

Refuse, without relaying, when:

- `g.settings.voice !== true` — otherwise signalling works in rooms with voice
  off, which makes the setting a lie.
- `to` is not a string, or names no **connected** player.
- `to` is the sender.
- `data` is absent, or its `JSON.stringify` length exceeds **16384**. SDP runs a
  few KB; the cap stops a socket being used as a broadcast channel.

Refusals are silent drops, not errors — a stale candidate arriving after a peer
left is normal, and erroring on it would spam every client during a leave.

#### `{ type: 'voice-state', on: <bool> }`

Sets `me.voiceOn = data.on === true`, saves, broadcasts roster. No-op if
unchanged (do not broadcast a roster per keystroke of push-to-talk — see the
client's rate note below).

#### `{ type: 'voice-mute', id: <playerId>, on: <bool> }`

**Host only** — same error wording style as the other host-gated verbs. Sets
`g.players[id].hostMuted = data.on === true`, saves, broadcasts roster.
Legal in any phase: a player whose mic is blasting during a question is exactly
when the host needs this.

### 4. Lobby directory

`reportToLobby()` adds `voice: g.settings.voice === true`, and the `Lobby` DO
carries it through to its listing payload, so the landing screen can show
"voice on" **before** anyone joins. Same file, same owner.

## Client — `trivia/index.html`

### Mesh construction

- Only when `state.settings.voice === true` **and** we are a player (not a
  spectator).
- One `RTCPeerConnection` per other **connected** player from the roster.
- **Glare rule:** the peer with the lexicographically **lower** player id is the
  initiator and creates the offer. Both sides know both ids, so this needs no
  negotiation and cannot double-offer.
- Tear down a peer when it leaves the roster or disconnects; tear the whole mesh
  down on leaving the room, on `voice` going false, and on `pagehide`. Follow
  the vault's interval-hygiene rule: every peer, every analyser, every timer
  gets a handle that a single `stopVoice()` clears. Cycling Menu → room must not
  stack meshes.

### Microphone

- **OFF by default. `getUserMedia` is not called until the player asks for it.**
  Never on load, never on join.
- Attach audio elements only after a real user gesture — mobile autoplay rules
  will otherwise silently produce a mesh with no sound, which looks exactly like
  a broken feature.
- Tap-to-toggle mute, plus **hold-space push-to-talk** on desktop. Verify space
  is not already bound (answers are keys 1–4) and that PTT does not fire while
  focus is in the name or room-code inputs.
- PTT toggles the audio track's `enabled` flag locally — it must **not** send a
  `voice-state` per keypress. Debounce the wire signal (~300ms trailing) so a
  chatty player does not broadcast a roster per syllable.

### Rendering

- Per-player speaking indicator on their podium/seat tile, driven by a local
  `AnalyserNode` per stream. Transform/opacity only — `theme-test.mjs` gates
  idle layout count at ≤2 and `perf.mjs`'s question-phase baseline is 13
  layouts. A pulsing ring that animates `width` will fail both.
- `prefers-reduced-motion` stills the indicator to a static state change.
- Host sees a mute control per player; everyone sees the muted state.
- **Host mute is enforced receiver-side.** Media is peer-to-peer, so the DO
  cannot gate audio. Every client mutes the incoming track of any roster entry
  with `muted: true`. That means a tampered client cannot unmute itself for
  other people — the enforcement lives in each listener, not in the speaker.
- A peer that reaches `failed` (or never leaves `checking` after ~15s) shows
  "voice unavailable with #" against that player and is left alone. The game
  continues. No retry storm.

### Strings

Every new string lands in both `en` and `es` in `STRINGS`. Keys are listed in
`trivia/docs/VOICE_STRINGS.md`, written by the content pass and merged by the
integrator — the client owner should code against those key names and not
invent wording inline.

## Tests

New `trivia-server/test/voice-test.mjs`, raw sockets, no browser:

- A signal from A addressed to B arrives at B, byte-identical in `data`, tagged
  `from: A`. C receives nothing.
- Relay is refused when `settings.voice` is false.
- A spectator socket sending `voice-signal` gets the spectator error and relays
  nothing.
- `to` naming a disconnected or nonexistent player is dropped silently.
- An oversized `data` is dropped.
- `voice-mute` from a non-host is refused; from the host it flips `muted` in the
  next roster for everyone.
- `voice-state` flips `voice` in the roster.
- Unique room codes per run — DO storage persists.

Regression: `genre-test.mjs`, `pack-check.mjs`, `theme-test.mjs`, `e2e.mjs`.

**Known-failing before this pass, do not chase:** `e2e.mjs` `r9: scoreboard
totals match the server` fails on pristine `main` too — the test reads the board
before the last row's count-up settles.

## What cannot be tested headlessly

Headless Chrome can prove frames relay and peer connections reach `connected`.
It cannot prove audio is audible. The feature is not done until a human runs two
real devices in one room. Ship state is safe regardless because `voice` defaults
off.
