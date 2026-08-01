# my-games/CLAUDE.md — Gonzo's Game Vault Standards

This file governs every game added to or modified in this repository (GitHub Pages site "Gonzo's Game Vault"). It exists because the 2026-07 portfolio review found the same handful of mistakes repeated across a dozen independently-built games. Read this before adding a new game or doing a polish pass on an existing one.

## The quality bar
Every game kept in this vault must **exceed** the best existing games here, not just match them. Before calling any game "done," compare it against the current flagship tier (Purr & Power Co., Freight Dominion) on: economic/mechanical depth, save/load robustness, visual polish, and absence of dead/vaporware features. If a new or revised game doesn't clear that bar, it stays `status-wip` and `data-hidden="1"` — it does not get promoted just because it runs without crashing.

## Required structure for every game
- **Self-contained.** One `index.html` (or a single top-level HTML file for simple games) per game, in its own subdirectory if it has more than a couple of supporting files (JS modules, CSS, assets). No external CDN script/style dependencies at runtime — vendor any needed library (Babylon.js, Cannon.js, Havok, etc.) locally under the game's own directory. GitHub Pages should serve the whole vault with zero live network dependencies besides the page itself.
- **No live third-party API calls from client code.** Never call `api.anthropic.com` or any other paid/authenticated API directly from browser JS shipped to players — there is no way to embed a secret safely in a static site, and the call will simply fail (or worse, expose a key) in production. If a game's design wants "AI" behavior, build it as a local system (curated response banks, keyword matching, procedural text) unless and until a real backend proxy exists for this vault. Two games (Neon Dominion's Oracle, Tangled Frequencies' AI inner voice) shipped with this exact broken pattern — don't repeat it.
- **No real-world commercial brand names.** Use invented, non-competing brand names for any in-game equipment, products, or companies, even where the real-world flavor was the point (Purr & Power Co. originally used real solar-industry brands — see naming migration note below). Real place names (cities, streets) are fine as setting color; real company/product names are not.
- **Main menu with New / Continue / Settings**, matching the pattern already established across the vault's stronger games.
- **Pause overlay** reachable via Esc (or equivalent), offering at minimum Resume / Save / Main Menu.
- **Autosave every 30 seconds**, plus save-on-important-transitions (level/tier/day change) and ideally save-on-`visibilitychange`/`pagehide` so backgrounding or closing the tab doesn't lose progress. Every save/load call must be wrapped in try/catch — corrupt or missing localStorage should degrade gracefully (start fresh), never crash the game.
- **Versioned save keys.** Bump the save key (or embed a schema version field) whenever the state shape changes incompatibly, and write a migration path for old saves where reasonable rather than silently discarding them.
- **Offline/idle catch-up for any idle/tycoon game.** If the game has passive per-second/per-tick resource accrual, store a last-tick timestamp and grant a capped catch-up bonus on load. Several games in this vault (Phantom Dossier, Anvil Epoch, Neon Dominion) shipped without this, which defeats the point of the genre.

## Interval hygiene (this bit the vault three separate times)
Never create a `setInterval` in a "start game" function without storing its handle and clearing it in the corresponding "return to menu" function. At least three games (Neon Dominion, Anvil Epoch, and near-misses elsewhere) had a bug where cycling Menu -> Start Game repeatedly stacked duplicate tick/render/autosave intervals, multiplying passive income and degrading performance. Prefer a single top-level tick dispatcher over many independent `setInterval` calls where practical — Purr & Power Co. used to be the anti-pattern here with 13 independent intervals; its tycoon rewrite now runs one 100ms dispatcher plus one autosave, both handle-tracked and cleared in `stopClock()`, and even the decorative cat-wander timers are collected in `catTimers` so `quitToMenu()` can clear them. Copy that shape.

## Naming and portfolio hygiene
- **Filenames are kebab-case** and should match the game's actual in-game/title-bar name, not an old working title (e.g. `veil-legends.html`, not `rift-legends.html` for a game whose title screen says "Veil Legends"). Rename when they drift.
- **Every shipped game must have a portfolio card in `my-games/index.html`.** A finished, playable game sitting in the repo with no card (as Callsigns did) provides zero value to players.
- **Card copy must match the actual code, checked at the same time as the code change.** This vault has repeatedly shipped stale card descriptions (claimed features that were removed, claimed bugs that were fixed, claimed content gaps that didn't exist, wrong genre labels). When you fix a bug or finish a feature, update the card in the same commit — don't leave it for "later."
- **Title collision check.** Before finalizing any new game's title or filename, search both this repo and any sibling repos being folded in for name/filename collisions (this is how the GonzoVR fold-in caught two unrelated `iron-frontier.html` files and two X-Files-themed games).
- **Don't assume surface similarity means duplication.** Chop Shop Circuit and Scrapyard D-Derby Empire both looked like the same "junkyard vehicle combat economy" concept at a glance, and were nearly merged/deleted on that assumption — a closer read showed one is a 1v1 ladder combat-sport builder and the other is a multi-car fleet-management tycoon, genuinely different genres wearing the same reskin. Always read the actual code before deciding two games are redundant.

## Playtesting requirement
Static code review is not sufficient to call a game "Complete." Before flipping a card's status from `wip` to `complete`, actually play the game in a browser through its full arc at least once — start to end-state (win, loss, or the practical end of content) — not just skim the source. Several games in this vault (Shadow Ledger, Tangled Frequencies episodes 7-12, Plate Empire's later tiers) had never actually been exercised through the live UI despite looking complete on paper, and had real crash-class bugs that only a live playthrough surfaces.

## Genre uniqueness
Before adding a new game, check whether its core mechanic is already well-covered by an existing vault entry (e.g. Steel Vanguard vs. Freight Dominion — a case where a shallower game duplicated a deeper sibling's genre and was retired). If it overlaps significantly with an existing game and doesn't clearly exceed it, either differentiate it meaningfully or fold its best ideas into the existing game instead of shipping a second, weaker version of the same concept. But verify the overlap is real first — see the Chop Shop Circuit note above.

## Git conventions (already established for this repo, listed for completeness)
- git `user.name`/`user.email` are set locally in this repo only — no global git config changes.
- Work that touches the live portfolio happens on a feature branch — but **finish the job**: merge that branch into `main` and push. GitHub Pages serves the live vault from `main`, so stopping at the feature branch means the changes never actually go live and the vault silently keeps serving the old build. Push a new branch on its first commit (with upstream set) so it is never stranded local-only.
- **Testing is local and happens before the push.** Never push in order to test, and never use the deployed Pages site as the test target — that's the owner's. A brand-new game gets a real local playthrough before its first push (see Playtesting requirement above); updates to an already-published game don't require a local test round, but any testing that does happen is still local and still pre-push.
- **Multiple sessions work this repo at once.** `git fetch` and check status before starting; branch from `origin/main`, not from whatever branch happens to be checked out. Stage only the files you actually touched — never `git add -A`/`commit -a`, or another session's in-progress work rides along into a live push. If the working tree has uncommitted changes you didn't make, stop and flag it rather than committing, stashing, or reverting them.

## Late Signal (`trivia/index.html` + `trivia-server/`)

The only game in this vault with a server. Cloudflare Worker, one Durable
Object per room code. Merged to `main`, so the client ships with the vault, but
**the backend is not deployed** — `BACKEND` in the client is still
`ws://localhost:8787`, and the game still has no portfolio card, so it is
unreachable from the index and cannot connect for anyone but a local dev.
Going properly live means: publish the Worker, change that one line, add the
card.

### The invariant, which is the reason the project exists
The client is a renderer and never learns the correct answer. `correctIndex`
lives only inside the Durable Object and only ever appears in a `reveal`, sent
once the timer expires or every connected player has locked in.
`questionMessage()` is built field by field on purpose — no spread, no
serialising the stored record. The client carries a runtime tripwire that fails
loudly if a question frame ever arrives carrying anything answer-shaped.

**The subtle version of this, which the tripwire cannot see:** any per-player
state that reacts to correctness — a streak counter, an elimination flag — is a
live answer oracle if it is written during the question and broadcast in a
`roster` frame. A player's streak visibly failing to increment tells everyone
still deciding that that player's tile was wrong. Two of those identify the
correct tile outright. So: **write that state only inside `doReveal()`**, never
in `onAnswer()`, whose broadcast stays playerId-only. Nothing errors if this is
got wrong, and a human playtest cannot see it — it just looks like the
scoreboard updating.

### Genre is a promise; difficulty is a preference
If you ask for Music you get Music or you are told why not. There is no code
path that mixes genres. Degradation is live OpenTDB → that same genre's bundled
offline pack → refuse to start (thrown before any state is mutated, so the room
stays in the lobby and the existing client error handler re-enables Start).
Difficulty may be relaxed within a genre; genre may never be relaxed.

Only genres with a real offline pack are offered. OpenTDB rate-limits hard and
Workers egress from shared IPs, so 429 is the likely failure rather than the
rare one — a genre that had to refuse every time that happened would be worse
than not offering it. Two measured OpenTDB behaviours worth keeping: the
`amount` parameter is **all-or-nothing** (asking for one question more than a
category can serve returns zero, not fewer), and `fromOpenTdb()` returns null
for any question whose distractors collide with its answer, so a *successful*
fetch routinely yields fewer than ten usable questions.

### Settings are untrusted, persisted input
Validated field by field against known-good enums — never spread or
`Object.assign` (a JSON-parsed own `__proto__` poisons the persisted shape), and
`hasOwnProperty` rather than `in`, so neither `__proto__` nor `constructor`
validates as a genre. `normalizeGame()` runs on **every** load, not once: rooms
saved before a field existed come back without it, and a bare read is undefined.

### Before adding a wager phase or any second timer
A Durable Object has exactly one alarm slot, so two deadlines cannot both be
armed — they must be sequenced. And `alarm()` opens with
`if (g.phase !== 'question') return;`, which will **silently swallow** an alarm
for any new phase: no error, no log, no toast, and the room wedges forever in a
phase nobody can leave. Rewrite that guard into a phase dispatch as its own
commit, preserving the early-fire re-arm verbatim.

### Tests — `trivia-server/test/`
Run `wrangler dev --port 8787` plus a static server on :8000 from the worktree
root, and headless Chrome with `--remote-debugging-port=9222` for the
browser-driven ones. `LS_OUT` sets where screenshots go.

- `e2e.mjs` — the big one, ~275 assertions, two real browsers through a full
  ten-round game. Assertion count varies slightly between runs because some are
  conditional on the test player answering wrong, which depends on the random
  question set. Compare by assertion *class*, not total, before calling a drop a
  regression.
- `genre-test.mjs` — protocol, sanitiser, degradation, over raw sockets.
- `callsheet-test.mjs`, `podium-check.mjs`, `fold-check.mjs` — browser UI.
- `audio-test.mjs`, `pitch-test.mjs` — render every sound in an
  `OfflineAudioContext` and measure it. They extract the engine **from
  `trivia/index.html`** so they test the shipped code rather than a copy.
- `perf.mjs` — before/after render cost. Ignore the fps number: headless
  software rasterisation reports a flat 60 regardless. The meaningful figures
  are `LayoutCount` and the style/script durations. Baseline for a 12s question
  phase is 13 layouts; the animations are transform/opacity and belong on the
  compositor, so **a rise in layout count is the regression to watch for.**

Two test-authoring lessons paid for here: give every run **unique room codes**
(Durable Object storage persists, so a small code pool means each run inherits
the last one's state), and make sure an assertion can actually fail — "every
question is History" passed vacuously for a while against an empty list because
the pack generator had dropped the `category` field.
