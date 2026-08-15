# Late Signal — voice strings (content pass, Feature A)

Wording for every player-facing string the voice feature needs, in both `en`
and `es`. The client owner **codes against these key names** and does not invent
wording inline; the integrator pastes the two blocks below into `STRINGS` in
`trivia/index.html`.

Conventions taken from the existing table and kept exactly:

- `#` is the one and only placeholder, filled with `.replace('#', x)`. **Every
  string here has at most one `#`** — `roundOf` is the only two-`#` string in
  the file and it is handled specially; do not make a second.
- No `m_` prefix. `m_*` keys are the translations of *server*-sent codes and
  none of these are server-sent. The server's only voice-adjacent message is the
  existing spectator refusal (`code: 'spectator'`), which already has `m_spectator`.
- Register: dry, warm, late-night broadcast. States a fact, then its
  consequence. No exclamation marks, no "Oops", no praise.
- Spanish is `tú`, es-MX-leaning neutral, matching `anfitrión` / `en el aire` /
  `en directo` as already used.

---

## Paste block — `en`

```js
      /* ---- voice (pass 2, Feature A) ---- */
      roomVoice: 'Room voice', voiceTag: 'Voice on',
      voiceNote: 'Room voice lets players talk to each other. Mics start off — everyone opens their own. Set it before you start: on air it is fixed.',
      voiceRoomOn: 'Room voice is on. Your mic stays off until you open it.',
      voiceRoomOff: 'Room voice is off.',
      mic: 'Mic', micOff: 'Mic off', micLive: 'Mic live',
      micOffNote: 'Mics start off. Nobody hears you until you open yours.',
      micHint: 'Hold space to talk', micHintTap: 'Tap the mic to open it',
      micBlocked: 'The browser blocked the mic. Allow it in site permissions, then try again.',
      micMissing: 'No microphone here. You can still play — you just cannot talk.',
      micDataNote: 'Voice uses data and battery the whole time the room is live.',
      speakingNow: '# is talking',
      muteBtn: 'Mute', unmuteBtn: 'Unmute',
      mutePlayer: 'Mute #', unmutePlayer: 'Unmute #',
      mutedTag: 'Muted', youAreMuted: 'You are muted',
      mutedByHost: 'Muted by the host — they can turn it back on.',
      mutedPlayer: '# is muted.', unmutedPlayer: '# can talk again.',
      voiceLinking: 'Linking voice…',
      voiceNoPeer: 'Voice unavailable with #',
      voiceNoPeerNote: 'Their network and yours would not meet. Everything else works.',
      voiceSpectator: 'Voice is for players — spectators are outside the booth.',
      publicVoiceNote: 'Listed and voice on: anyone who joins from the main screen can talk in your room.',
```

## Paste block — `es`

```js
      /* ---- voz (pase 2, función A) ---- */
      roomVoice: 'Voz de sala', voiceTag: 'Con voz',
      voiceNote: 'La voz de sala deja que los jugadores hablen entre ellos. Los micros empiezan apagados — cada quien abre el suyo. Decídelo antes de empezar: en el aire ya no cambia.',
      voiceRoomOn: 'Voz de sala activada. Tu micro sigue apagado hasta que lo abras.',
      voiceRoomOff: 'Voz de sala desactivada.',
      mic: 'Micro', micOff: 'Micro apagado', micLive: 'Micro al aire',
      micOffNote: 'Los micros empiezan apagados. Nadie te oye hasta que abras el tuyo.',
      micHint: 'Mantén espacio para hablar', micHintTap: 'Toca el micro para abrirlo',
      micBlocked: 'El navegador bloqueó el micrófono. Permítelo en los permisos del sitio y vuelve a intentarlo.',
      micMissing: 'No hay micrófono. Puedes jugar igual — solo que sin hablar.',
      micDataNote: 'La voz gasta datos y batería mientras la sala esté en directo.',
      speakingNow: '# está hablando',
      muteBtn: 'Silenciar', unmuteBtn: 'Quitar silencio',
      mutePlayer: 'Silenciar a #', unmutePlayer: 'Quitar silencio a #',
      mutedTag: 'Silenciado', youAreMuted: 'Estás silenciado',
      mutedByHost: 'Silenciado por el anfitrión — puede volver a activarlo.',
      mutedPlayer: '# está silenciado.', unmutedPlayer: '# puede hablar otra vez.',
      voiceLinking: 'Enlazando voz…',
      voiceNoPeer: 'Sin voz con #',
      voiceNoPeerNote: 'Su red y la tuya no se encontraron. Todo lo demás funciona.',
      voiceSpectator: 'La voz es para los jugadores — los espectadores quedan fuera de la cabina.',
      publicVoiceNote: 'Listada y con voz: cualquiera que entre desde la pantalla principal puede hablar en tu sala.',
```

---

## Key reference — where each one renders

| Key | English | Spanish | Where / when |
|---|---|---|---|
| `roomVoice` | Room voice | Voz de sala | Host's lobby toggle label. Render exactly like the public toggle: `T('roomVoice') + ' · ' + T(state.voice ? 'pubOn' : 'pubOff')`. **Reuse `pubOn`/`pubOff`** — no new On/Off keys. |
| `voiceNote` | Room voice lets players talk to each other. Mics start off — everyone opens their own. Set it before you start: on air it is fixed. | La voz de sala deja que los jugadores hablen entre ellos. Los micros empiezan apagados — cada quien abre el suyo. Decídelo antes de empezar: en el aire ya no cambia. | The host-read note. Same slot and treatment as `publicNote` (`btn.title`, plus the lobby note line). 137 chars EN vs `publicNote`'s 159, so it fits wherever that fits. Teaches three mechanics at once: who talks, that mics default off, and lobby-only. |
| `voiceTag` | Voice on | Con voz | Non-host lobby tag (mirrors `publicTag`) **and** the landing-screen listing meta, joined with `' · '` next to `playingN` / `watchingN`. This is the "joining players see voice on before joining" promise from the brief. |
| `voiceRoomOn` | Room voice is on. Your mic stays off until you open it. | Voz de sala activada. Tu micro sigue apagado hasta que lo abras. | Toast to everyone when the host flips it on. Sentence two is the whole courtesy argument; do not drop it to save a line. |
| `voiceRoomOff` | Room voice is off. | Voz de sala desactivada. | Toast when the host flips it off (mesh torn down). Flat on purpose. |
| `mic` | Mic | Micro | Bare icon-button label where there is no room for a state word. |
| `micOff` | Mic off | Micro apagado | Mic button, closed state. Not "Muted" — that word belongs to the host action alone, and the two must never collide. |
| `micLive` | Mic live | Micro al aire | Mic button, open state. "Al aire" deliberately rhymes with the existing `onAirTag`. |
| `micOffNote` | Mics start off. Nobody hears you until you open yours. | Los micros empiezan apagados. Nadie te oye hasta que abras el tuyo. | Shown once under the mic control the first time voice is on for a player. This is the string that makes off-by-default read as manners rather than a fault. |
| `micHint` | Hold space to talk | Mantén espacio para hablar | Desktop only — gate on `!COARSE`, exactly like `pickOneKeys`. Telling a phone about the space bar is noise. |
| `micHintTap` | Tap the mic to open it | Toca el micro para abrirlo | The `COARSE` counterpart. |
| `micBlocked` | The browser blocked the mic. Allow it in site permissions, then try again. | El navegador bloqueó el micrófono. Permítelo en los permisos del sitio y vuelve a intentarlo. | `getUserMedia` rejects with `NotAllowedError` / `SecurityError`. Names the browser as the actor, not the player — refusing a mic prompt is a reasonable thing to have done. Avoids "click the padlock", which is wrong on half the browsers in use. |
| `micMissing` | No microphone here. You can still play — you just cannot talk. | No hay micrófono. Puedes jugar igual — solo que sin hablar. | `NotFoundError` / `OverconstrainedError`, or no `mediaDevices` at all (an insecure context, or an old browser). States the fact and then the consequence, which is that nothing is broken. Full word *micrófono* in Spanish here on purpose — this is the one line where the short *micro* could be misread. |
| `micDataNote` | Voice uses data and battery the whole time the room is live. | La voz gasta datos y batería mientras la sala esté en directo. | `COARSE` only, under the mic control, shown once per room. **See the note on why this earns its place, below.** |
| `speakingNow` | # is talking | # está hablando | `aria-label` / `title` on a tile whose speaking indicator is lit, and the announced state when `prefers-reduced-motion` stills the ring. Fill `#` with the player name. |
| `muteBtn` / `unmuteBtn` | Mute / Unmute | Silenciar / Quitar silencio | Visible host control per player tile. |
| `mutePlayer` / `unmutePlayer` | Mute # / Unmute # | Silenciar a # / Quitar silencio a # | `aria-label` for the same control, so a screen reader hears which player. Costs nothing. |
| `mutedTag` | Muted | Silenciado | The muted state on a tile, seen by everyone. One word, no icon needed beyond the existing one. |
| `youAreMuted` | You are muted | Estás silenciado | The muted player's own mic button, which is disabled while `hostMuted` is true. Replaces `micOff`/`micLive` — it must never read "Mic off" when the player did not turn it off, or they will hammer a dead button. |
| `mutedByHost` | Muted by the host — they can turn it back on. | Silenciado por el anfitrión — puede volver a activarlo. | Toast to the muted player on the roster edge. Names who did it, states that it is reversible, and stops. No apology, no joke, no reason invented on the host's behalf. |
| `mutedPlayer` / `unmutedPlayer` | # is muted. / # can talk again. | # está silenciado. / # puede hablar otra vez. | Toast to the **host** confirming their own action. Full stops, no praise. |
| `voiceLinking` | Linking voice… | Enlazando voz… | Per-peer, while the connection is `checking`. Uses `…` like `starting`. Should disappear on `connected`, not linger. |
| `voiceNoPeer` | Voice unavailable with # | Sin voz con # | The degradation label against that player's tile, wording taken verbatim from the protocol contract. Fill `#` with the player name. |
| `voiceNoPeerNote` | Their network and yours would not meet. Everything else works. | Su red y la tuya no se encontraron. Todo lo demás funciona. | Optional expansion — `title` on the label above, or a toast the first time it happens in a room. Sentence two is the load-bearing half: the player needs to know the game is fine. |
| `voiceSpectator` | Voice is for players — spectators are outside the booth. | La voz es para los jugadores — los espectadores quedan fuera de la cabina. | Shown to a **spectator** in a voice-on room, in the same place `m_spectator` lands. Built to sit beside "Spectators watch — they cannot play." without repeating it. |
| `publicVoiceNote` | Listed and voice on: anyone who joins from the main screen can talk in your room. | Listada y con voz: cualquiera que entre desde la pantalla principal puede hablar en tu sala. | Optional, host only, shown **only when `public && voice` are both on**. Cheap, one condition, and it is the one combination with a real-world consequence neither note covers alone. Drop it if the lobby is tight. |

---

## Factual checks against the code

Checked against `docs/VOICE_PROTOCOL.md` and the current `index.html` table, not
against the brief:

1. **Spectators cannot hear, so no string may imply they can.** The protocol is
   explicit — spectators are never in the mesh. An earlier and very tempting
   line, "Spectators listen — they do not talk," parallel to `m_spectator`,
   would have been a straight lie about the simulation on the one screen that
   explains it. `voiceSpectator` says *outside the booth*, which is true of both
   directions. If the client ever does add a receive-only spectator path, this
   string is the first thing that has to change.
2. **`voiceNote` says "on air it is fixed" because it is.** Settings are
   host-only and lobby-only; `again` returns the room to the lobby, where it can
   change. No string promises a mid-game toggle.
3. **`micDataNote` does not claim voice sleeps when your mic is off.** It does
   not — push-to-talk flips the track's `enabled` flag locally, the peer
   connections stay up, and you keep receiving up to seven inbound streams. A
   line saying "it sleeps when your mic is off" would have been comfortable and
   false.
4. **`mutedByHost` says "they can turn it back on" and nothing about *you*
   turning it back on.** `hostMuted` is authoritative and host-set; the player
   cannot clear it. The mic button must be *disabled* in that state and read
   `youAreMuted`.
5. **`micOff` is not "Muted."** `voiceOn` (you) and `hostMuted` (the host) are
   two different booleans in the roster and they must never share a word, or a
   player who muted themselves will think the host did it.
6. **One `#` per string**, because `serverText()` and every call site use
   `.replace('#', x)`, which replaces the first occurrence only.
7. No real company, product or organisation names appear in any string above.
   (`m_offline` in the existing table names Open Trivia DB — that is the actual
   upstream the code fetches from and is a credit, not invented flavour. Left
   alone deliberately.)

---

## Does the battery/data note earn its place? Yes — with two conditions

**Verdict: ship `micDataNote`, `COARSE` only, once per room.**

The argument for it: a full mesh of up to eight people is up to seven inbound
audio streams on a phone, running for a ten-round game. That is the largest
resource cost this game has ever asked for, and it is invisible. The whole
design posture of this feature is *ask first* — mic off by default, permission
never requested on load. Telling a phone player what it costs is the same
posture applied to the other resource. It is one line and it never repeats.

The conditions matter as much as the line:

- **Desktop must never see it.** On a laptop it is noise, in the same way "keys
  1-4 work too" is noise on a phone — the file already has `COARSE` for exactly
  this judgement.
- **Once per room, near the mic control, not on the landing screen.** It is a
  footnote to a decision the player is making right then. On the landing screen
  it is a warning label, which is a different and worse tone.

If the lobby is visually tight, this is the first string to cut. It is the only
one on the list that is a courtesy rather than a mechanic.

---

## Existing wording this feature makes stale or inconsistent

Flagged, not changed — I do not own `index.html`. Ranked by how likely each is
to actually confuse someone.

1. **`sound: 'Sound'` is now ambiguous, and there is an open behavioural
   question underneath it.** The existing toggle controls game SFX. With voice
   shipped, a player who turns Sound off and still hears five people talking
   will read that as a bug — and a player who turns Sound off *expecting* to
   silence the room will read the opposite as a bug. **This needs a decision,
   not a string.** My recommendation: `Sound` stays SFX-only, the mic control
   lives on the player's own podium and not in the settings row beside it, and
   if the room is ever fully silenced it is by a separate control. If instead
   Sound is made to gate incoming voice, add:
   `voiceMutedBySound: 'Sound is off — you cannot hear the others.'` /
   `'El sonido está apagado — no oyes a los demás.'`
2. **`m_spectator: 'Spectators watch — they cannot play.'` now under-specifies.**
   It is still true, and it is *server*-worded (the DO sends that exact sentence
   with `code: 'spectator'`), so changing it means changing both sides and
   keeping them in sync across a network boundary — precisely what the comment
   above `STRINGS` warns against. Leave it. `voiceSpectator` carries the rest.
   Do not let a spectator client ever send `voice-signal` just to surface the
   refusal; the string exists so the client can say it locally instead.
3. **`lede` no longer describes the product.** "Live trivia for one to eight
   people. Ten questions, twenty seconds each — and a server that flatly refuses
   to tell your browser the answer until the clock is done." Voice is the
   headline of this pass and the landing screen does not mention it. The
   refusal clause is the thesis and must survive intact. Optional replacement,
   owner's call, +5 words:
   - `en`: `'Live trivia for one to eight people, talking or not. Ten questions, twenty seconds each — and a server that flatly refuses to tell your browser the answer until the clock is done.'`
   - `es`: `'Trivia en directo para una a ocho personas, con voz o sin ella. Diez preguntas, veinte segundos cada una — y un servidor que se niega en redondo a decirle la respuesta a tu navegador hasta que el reloj termine.'`
4. **`publicNote` describes half of a now-bigger consequence.** "Anyone can
   join while you are in the lobby" reads differently when joining means joining
   the conversation. Rather than lengthening a string that is already the
   longest in the lobby, `publicVoiceNote` above covers the intersection and
   only appears when both settings are on.
5. **`pickOneKeys: 'Pick one — keys 1-4 work too'` is still accurate** and needs
   no change, but it is the string a desktop player reads while holding space.
   The protocol already requires that space is unbound and that PTT does not
   fire in the name or room-code inputs; worth confirming the answer hotkeys and
   PTT were tested together, because the copy quietly promises both work at once.
6. **No `es` gap introduced.** Every key above exists in both tables. If the
   client ships a key with only `en`, `T()` silently falls back to English and a
   Spanish player gets a single English sentence in the middle of the lobby,
   which reads as a bug rather than a fallback.
