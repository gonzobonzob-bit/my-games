# Late Signal — Pass 2 brief: VOICE + THEMES (owner-approved 2026-08-08)

Launch from origin/main AFTER the late-signal-lobby pass has merged and shipped.
Branch: late-signal-voice-themes.

## Feature A — Player voice chat (approved config, $0 infrastructure)
- WebRTC full-mesh audio between PLAYERS only (1–8). Spectators never in the mesh
  (they're the studio audience — on-air mute). SFU/TURN explicitly NOT purchased;
  if a NAT pair can't connect via STUN, degrade gracefully to "voice unavailable
  with this player" — never block the game on voice.
- Signaling rides the existing room WebSocket through the Room DO: new frame
  types (voice-offer/-answer/-ice, addressed player-to-player, relayed blind by
  the DO — the DO never parses SDP). Keep THE INVARIANT untouched: no
  answer-shaped data, no new per-player state written outside doReveal.
- STUN: stun.cloudflare.com (free; counts as accepted-infra like the Worker
  itself, not a third-party API call in the CLAUDE.md sense — it's the same
  vendor already hosting the backend).
- UX: mic OFF by default; tap-to-unmute + hold-space push-to-talk on desktop;
  per-player speaking indicator on their podium tile; host can mute any player
  (host mute is authoritative, enforced by a roster flag so a muted player's
  tiles show muted to everyone); voice defaults OFF in publicly-listed rooms
  (host may enable; joining players see "voice on" before joining).
- Mobile: mind autoplay/gesture rules (attach streams only after a user
  gesture), battery note in settings copy.
- EN + ES for all new strings.

## Feature B — Theme system ("more theme options; animation, movement, exciting
## colors, occasional bland; NOT You Don't Know Jack, but as exciting")
- Per-player, client-side only: localStorage preference, validated against a
  known-good enum (same field-by-field discipline as room settings; no server
  involvement, no protocol change). Default = current look.
- Implementation: CSS custom properties + a theme class on the root; themes are
  palettes + motion layers, NOT per-theme markup forks. All animation
  compositor-friendly (transform/opacity only) — perf.mjs's layout-count
  baseline (13 layouts per 12s question phase) is the regression gate; run it
  per theme. prefers-reduced-motion stills every decorative layer in every
  theme.
- Roster (4–5 themes):
  1. **Studio Classic** — current late-night broadcast look, kept as default,
     lightly juiced (subtle camera-drift on the set, on-air lamp pulse).
  2. **Marquee Night** — game-show glitz: chase-light borders, gold/magenta,
     animated marquee bulbs on question reveal, confetti burst on podium. The
     "exciting" ceiling — energetic but not YDKJ snark; no host-voice comedy,
     excitement comes from light and motion, not attitude.
  3. **Signal Drift** — synthwave: moving gradient horizon, slow grid scroll,
     neon cyan/pink, scanline shimmer.
  4. **Daybreak** — the deliberate bland: paper-light, calm, high readability,
     minimal motion (the owner explicitly wants "the occasional bland" option).
  5. (optional if cheap) **Dead Air** — ultra-dark minimal FM-dial aesthetic.
- Cross-theme beats that carry the excitement everywhere: answer lock-in punch,
  timer-urgency ramp in the last 5s, reveal stinger animation, podium
  celebration. These are shared mechanics with per-theme skins.
- Theme picker: in the room UI (works for spectators too) + on the landing
  screen; live-switchable without reload.

## Tests
- Extend the suite: voice-signal relay test over raw sockets (frames relayed
  blind, muted-flag semantics, spectators receive no mesh invites); theme test
  driving perf.mjs per theme (layout count must stay at baseline); e2e +
  genre-test regression green. Unique room codes per run. ws package at
  /tmp/claude-1000/-home-gonzobonzob/84a1e071-3b1f-494a-b586-ca092ed21659/scratchpad/node_modules.

## Ship
- Owner wants features shipped when done: integrator merges to main, deploys
  Worker (wrangler authed on this machine), verifies live BACKEND + a real
  room, pushes. Card copy: mention themes + voice once true ("bring your
  voices" etc.) in the same commit.
