# Callsigns — onboarding findings (cold player, blind play)

Branch `callsigns-rivals-build` @ 4e0179b. Played headless Chrome from cleared
localStorage, no docs, no source. Reached day 139, one station, expansion
unlocked, then forced a bankruptcy to read the death screen. Source read only
afterwards, to explain what I had already felt.

---

## 1. The first ten minutes

**Minute 0–1.** Title: "CALLSIGNS / Build a radio station into a media empire."
Four buttons: New Game, Continue (greyed), Settings, Quit. Clicked New Game.
Callsign screen — "Four letters, starts with K or W", pre-filled KJGB, Random,
Start Broadcasting. No format, no market, no difficulty. Fine: no decision, so
nothing to get wrong. **First real screen in under 30 seconds. That part is
good.**

**Minute 1.** Studio tab. Amber coach card: "You are on the air, but nobody is
in the booth... Two or three people are looking for work each week — that is the
whole talent supply, forever." Buttons: *See who is available* / *Got it*.
I read it. **While I read it the clock ran: Day 1 → Day 8.** Cash $800 → $945.
Nothing on screen was paused. Meanwhile the schedule showed four cards reading
`⚠ ×1.00 · 6.0%` which I could not parse at all.

**Minute 2.** Clicked *See who is available*. Staff tab: Sable Lyle (DJ Skill 1,
$22/day), Sable Moreau (Skill 3, $33), **Reva Bright (Skill 5, $45)**. I decided
on Reva and clicked. `NOTFOUND`. In the ~20 seconds I spent reading three cards
the whole board had been **silently replaced** (day 13 → 15) with an engineer
and a Skill-2 DJ. I never saw Reva again. Nothing had told me the list expires.

**Minute 3.** Panic-hired both remaining candidates. Payroll $77/day against
$36/day income. An event modal fired — "The exciter has been running hot since
Tuesday. **your** engineer wants it off the air" (lowercase `your` after a full
stop) — single button, "Resume −$392". Cash $798 → $406. **Note: event modals
pause the game. The tutorial card does not.** That is exactly backwards.

**Minute 4.** Staff tab now showed my two new hires, both captioned
*"Automation — about a third of a hosted slot, at the same lease."* Under a
person's name. I assumed I had hired automation by mistake.

**Minute 5.** Coach card 2 → *Program morning drive*. The slot editor is where
the game finally exists: Slot load ×1.00, Fault risk 6.0%, Slot revenue $38, a
gradient bar marked `light ▲ engineer crossover heavy`, four show types with
"+0.35 load" / "+0.55 load", "Crew · 0/3 — the lead counts full, second chair
55%, third 30%", and Rex Mbeki tagged **"Worth it here +$40"**. Dropped Rex in;
revenue $38 → $79. **This is the minute I understood how I make money.** It took
five minutes and it happened on a screen I only reached because a tutorial
button took me there.

**Minute 6.** Coach card 3: "The lease is $60 a day, paid whether you broadcast
or not. That is the clock you are racing. **The bar at the top of the screen**
tells you when it starts winning." There is no bar at the top of the screen.
There is a small unlabelled `106d left` chip next to Cash, which appears only
when net is negative and had already vanished.

**Minute 7.** Cash hit **−$307**. Red banner: "🩸 Cash is past the floor. The
next few days end the run." I braced for death.

**Minute 8–10.** I did nothing and the run recovered to +$1,258 by day 53 with
three of four slots empty. The banner had lied. Empire tab: my one station, a
coverage grid, `Covered / At risk / Exposed`, and "Reach $9,000 and 32
reputation to expand beyond one signal." **No rivals anywhere.** Gear tab was
the clearest screen in the game.

**When did I understand how I LOSE?** Never, in play. I got a false alarm,
recovered, and only learned the real rule by forcing it: cash ≤ **−$4,000**,
run over, **save deleted**. Nothing states that number or that permanence
before it happens.

**What I thought the game was about, at minute 10:** hire whoever turns up, put
one body in each of four boxes, buy a bigger transmitter, wait. A clicker with
radio skin. I never once felt a staffing decision, because with one station I
had four slots and eventually eleven people.

**What it is actually about** (DESIGN.md, read afterwards): "Which of your
too-few people cover which of your too-many simultaneous slots today, and which
slots you deliberately leave exposed." That decision *cannot exist* with one
station. It arrives at station two, which is day ~139. **At 1× speed that is
about forty minutes of real time.** The core loop is four times further away
than the window in which a player decides whether to keep playing. That is the
biggest gap in this report and no line of copy fixes it.

---

## 2. Ranked confusions

Ranked by how many players they cost. Cheapest fix given for each. **Most of
these fixes are one line, and in six cases the line is already written in
`content.js` and simply never rendered.**

### RANK 1 — The game can stop and never restart. (loses ~everyone who hits it)

I reached a state where the header showed `⏸ PAUSED`, no modal was open, the
day never advanced, and **☰ → Resume did nothing.** I clicked it four times.
The only escape was ☰ → Main Menu → Continue.

Cause, `js/ui.js:2255` in `openPauseMenu()`:

```js
const wasRunning = running;
pauseTick(); autoPaused = wasRunning;
```

`closeModal()` only calls `resumeTick()` when `autoPaused` is true. If the clock
was already stopped when you opened the menu, `autoPaused` is assigned **false**,
and Resume becomes a no-op forever. `sim.js:1546` documents this exact failure
("with no way back short of the main menu (the pause menu's own Resume captures
the same already-false `running`)") and fixes it in `modalPause()` by raising
the flag and never lowering it — but `openPauseMenu()` still assigns. The
`Settings` branch makes it worse: it sets `autoPaused = false` explicitly and
hands the resume to `optionsResume`, which is also `wasRunning`.

A player's description of this is "the game froze". They will not file a bug,
they will close the tab.

**Cheapest fix:** `if (wasRunning) autoPaused = true;` — same shape as
`modalPause()`. Belt and braces: make the `#hud-paused` chip a button that calls
`resumeTick()`. Right now it is a `<span>` with `onclick === null`.

### RANK 2 — Rival capacity is completely invisible, and the one "Rivals" number on screen is wrong.

This was your prime suspect and it is worse than you feared.

`S.rivalNets` holds live per-segment, per-network capacity that compounds every
day (`RIVAL_RATE 0.006`, floor `0.30×`, ceiling `2.20×`). At day 139 my state
was:

```
citywide: { sunbelt: 472, lantern: 367, ridgeway: 210 }   // total 1049
```

I had squeezed the rivals in my own segment to roughly **half their opening
size** over 139 days. Nothing on any screen told me that. Not a name, not a bar,
not a trend arrow, not a log line. `Sunbelt Media`, `Lantern`, `Ridgeway` never
appear in the UI at all.

The only place the word "Rivals" is rendered is the founding segment picker:
`Rivals 2000 · Lease premium ×1.00`. That number is
`segTable()[id].comp.base` — a **static constant from content.js**. For my
segment the live figure was 1049. **The single rival number in the game was off
by 2×, in the direction that makes the mechanic invisible: it says competition
is a fixed property of a segment when the whole v5 feature is that it is not.**

Consequence for a player: revenue sags in a segment you abandoned, and there is
no visible cause. An invisible mechanic that punishes you is indistinguishable
from a bug — you said it, and it is precisely what shipped.

`content.js:225` already contains the sentence that would help
(`segCompSub: 'Rival pull already sitting in the pool. Your share is what is
left after them — and after your own other stations.'`). **`ui.js` never
references it.**

**Cheapest fix, in order of cost:**
1. Make the segment card's "Rivals N" read the live sum of `rivalK(segId, net)`
   instead of `comp.base`, and render `segCompSub` under the grid. One
   expression and one already-written string.
2. Add a delta: `Rivals 1,049 ▼ from 2,000` — one arrow makes the entire system
   legible.
3. Log line on a threshold crossing: `"Sunbelt Media has been buying time in
   County Line while you were away."` The `RIVALS` array in content.js exists
   for exactly this ("so that losing a share point has a face on it") and is
   currently used only for unrelated flavour events.

### RANK 3 — The coach silently strands, and the step that explains LOAD is skippable forever.

Six coach steps are authored. **I saw three in 139 days.**

- Step 3 (`lease`) is `ack: true` and its `when` is `S.staff.length > 0` —
  permanently true. `coachStep()` returns the first undone step whose `when`
  holds, so **until you click "Got it" on step 3, steps 4, 5 and 6 cannot
  render.** Card 3 sat on my Studio screen from day 26 to day 139. It reads as
  "the tutorial is finished".
- Step 4 (`load`) — the single most important explanation in the game
  ("Load is what breaks transmitters, and a fault costs reputation in
  proportion to the load — not to the money. One engineer covers one daypart,
  across the whole empire.") — is gated on `!staffOf('eng').length`. **I hired
  an engineer on day 16 out of curiosity, before I had any load. Step 4's
  condition became permanently false. I could never see it.**
- Step 5 (`engineer`) is gated on having an engineer *and none assigned*. I
  assigned mine immediately. Also permanently false.

So I spent 120 days staring at `🔧 3 high-load slots have no engineer` and
four-figure fault hits, having never been told what load is. **The game
eventually told me — on the death screen.** `causeNoEngineer` is the first time
the load → fault → reputation → ad-rate chain is stated anywhere.

**Cheapest fix:** make step 3 non-blocking (it is `ack`-only; let
`coachStep()` skip past acknowledge-steps that are still pending rather than
stopping at them), and change step 4's gate from "you have no engineer" to
"a slot's load ≥ 1.35", which is the condition it actually describes.

### RANK 4 — The hire board expires silently and the copy blames the wrong thing.

`refreshCandidates()` does `S.candidates = []` and rolls 2–3 fresh names every
7 days. **The board is replaced, not appended.** I lost a Skill-5 DJ — the best
candidate I saw in 139 days — by taking twenty seconds to compare three cards.
There is no countdown, no "available until day N", no warning.

Worse, the empty-board copy misattributes the mechanic: `noCandidates: 'No
candidates today. New talent turns up as your reputation grows.'` Reputation
sets candidate *skill* (`makePerson(role, S.rep)`); **arrival is a flat 7-day
timer that never scales.** A player reads that line and grinds reputation
waiting for a board that was always going to refresh on Tuesday.

And `candidateNote: 'Two or three names a week, no matter how many signals you
own.'` — the game's own statement of its scarce resource, with a comment in
content.js saying "stated on the screen where it bites" — **is never rendered.**
`ui.js:1259` builds the "Available for Hire" card head with no note.

**Cheapest fix:** render `candidateNote` at `ui.js:1259` (string already
written), and add `· until day {n}` to the card head. Change `noCandidates` to
"New names every week. Reputation decides how good they are."

### RANK 5 — The second engineer is never explained before you buy, and the label says he is worth −$0.

Compare the two staffing rules as a player sees them:

- Crew: **"The lead counts full. Second chair counts 55%, third counts 30% —
  and each one adds 0.45 to this slot's load."** Present, above the list,
  before you decide.
- Engineers: **"0 / 2 assigned."** That is all.

`ENG_WEIGHTS = [1, 0.45]` is nowhere on that screen. The 45% note at
`ui.js:2044` renders only under an engineer who is **already assigned in
position 2** — you must commit before you are told.

Meanwhile every unassigned engineer after the first shows a value tag of
**`−$0`**, from `worth > 0 ? '+' : '−'` with `money(0)`. So the game's own
readout says the second engineer is worth minus zero dollars. In practice
assigning him took my afternoon slot from 3.7% → 2.9% fault risk. **The number
on screen actively contradicts the mechanic.** That is worse than silence.

Would a player wrongly stack two on everything? No — they would wrongly
conclude a second engineer does nothing, and never place one.

**Cheapest fix:** mirror the crew line verbatim under `0 / 2 assigned`:
"The first engineer counts full. A second counts 45%." One string. And render
`−$0` as `$0` or `no change`.

### RANK 6 — The DJ conflict warning names neither the station nor the daypart.

I had one DJ, Rex Mbeki, on **all four dayparts** at once. The warning read:

> `Skill 2 · −54% tired · On 3 other slots today`

"1 other slots" earlier, with the grammar bug intact. It does not say which
station, which daypart, or that the penalty is a 54% skill haircut until after
it has been applied. Nothing refused the assignment, nothing warned before it.

The **engineer** version of this warning is excellent —
`engSteal: 'Putting {name} here pulls them off {call} {part}. One engineer, one
daypart, whole empire.'` — but it only computes across *other stations*
(`if (j === idx) return;`), so with one station you never see it, and the
empire-wide scarcity rule exists only as a static subtitle you have to be
reading for.

The good DJ string is written: `coHostElsewhere: 'Already on {call} {part} —
same hour, one place.'` **`ui.js` never references it.** `onSlots: 'On {n} other
slots today'` ships instead.

**Cheapest fix:** swap `onSlots` for `coHostElsewhere` at `ui.js:1920` and
`:1981`, and append the fatigue consequence: `· each extra slot costs him ~X%`.

### RANK 7 — "Audience share 5%" with no denominator reads as failing.

The Daily Brief shows `AUDIENCE SHARE 6%` for one daypart of one segment. There
is no target, no comparison, no "of segment", no rival breakdown. `RIVAL_TARGET
= 0.032` — **3.2% is the equilibrium the entire rival system is tuned around** —
and the player is never told that ~3% is *winning*. I spent the whole run
assuming I was being crushed.

**Cheapest fix:** `AUDIENCE SHARE 6% of Downtown, this daypart · holding above
3% shrinks your rivals`. One line, and it makes RANK 2 half-visible for free.

### RANK 8 — Vocabulary used and never defined.

Every one of these appeared on screen before any explanation:

| Term | Where | What a newcomer gets |
|---|---|---|
| `⚠ ×1.00 · 6.0%` | every schedule card, from second one | nothing. Two numbers, no labels, on the game's main screen |
| **Slot load** | slot editor | a multiplier of *what*? `1 + 0.45(djs−1) + showTech` is never stated |
| **engineer crossover** | gradient bar, `light ▲ heavy` | pure author jargon. This is DESIGN.md's `L* = 1.616`. It means nothing to a player |
| **Fault risk 6.0%** | slot editor | risk of what, costing how much? |
| **Buzz 127%** | Daily Brief | 127% of what baseline? |
| **Show Quality 46%** | Daily Brief | versus what? |
| **Audio Fidelity 1.00×** | Daily Brief, Gear | multiplies which number? |
| **Exposed / At risk / Covered** | Station Effects, coverage grid | guessable, undefined |
| **Reach 1.00×** | Gear | vs. Fidelity — which one do I want? |
| `106d left` | under Cash, intermittently | unlabelled runway to the −$4,000 floor |
| **Net earned $15.9k** vs **Costs paid $48.2k** | Empire | two money framings, neither reconciles to cash |
| **Sales agent** | role exists (`📈`, $36/day) | I never saw one in 139 days; if I had, "Fills more of the ad log and holds the rate" is the only thing said about it |

`content.js` has authored, unrendered explanations for several of these too:
`chemLbl`, `chemNone`, `chemFlat`, `styleNote`, `quirkLbl`, `loadValue`,
`coHostCap`, `engNoneHired`, `fxBreak`, `fxFid` — **all zero references in
ui.js.**

**Cheapest fix:** put labels under the two numbers on the schedule card
(`load` / `fault risk`) and render the strings that already exist.

### RANK 9 — Two visible copy bugs.

1. **Raw template on screen.** A candidate row read:
   `Sonny Okoye — Skill 3 · {a} and {b} talk over each other for the whole hour.`
   `ui.js:279` defines a short local `chemBad: 'clashes'`, but `tt()` resolves
   through `t()` first, which finds `content.js:171`'s templated
   `'{a} and {b} talk over each other...'` and returns it with no vars. Same for
   `chemGood`. content.js:350 has a comment saying *"a literal `{rival}` on
   screen is exactly the class of bug that ships because nobody rolled that one
   event in testing."* It shipped.
2. **The automation blurb on people.** `ui.js:1241` renders `t('unstaffed')` —
   *"Automation — about a third of a hosted slot, at the same lease."* — under
   the name of any hired person with no bookings. It is the description of an
   empty slot, printed as if it described the human. This is what made me think
   I had hired the wrong thing at minute 4.
   **Fix:** a dedicated string, `'On payroll, off the air.'`

### RANK 10 — The bankruptcy warning cries wolf, and the real rule is never stated.

`warnBroke` fires at `S.cash < 0` and says **"Cash is past the floor. The next
few days end the run."** The floor is `BANKRUPTCY_FLOOR = -4000`. At −$1 you are
$3,999 from it. I hit −$307, did nothing, and was at +$1,258 twenty-five days
later. The first time the game shouts at you, it is wrong — so the next time it
shouts you will not listen.

Conversely the actual failure condition (−$4,000, and **"This save is closed"** —
the run is deleted, no continue) appears nowhere before death.

**Cheapest fix:** two strings. Warn at `runwayDays() <= 10 && cash < 0` with
`"$X below zero. The run ends at −$4,000."` And put the floor in coach step 3,
which is already the lease-clock card: *"...paid whether you broadcast or not.
At −$4,000 the licence goes back and the save is closed."*

---

## 3. Direct answers to the checklist

**Does the tutorial pause the game?** **No.** Day 1 → Day 8 with coach card 1 on
screen. Event modals *do* pause. The one thing that should stop the clock does
not, and the interruptions that should not, do. Card 3 then sits on screen for
100+ days.

**Does the tutorial match the code?** Mostly, with three misses:
- coach3: *"The bar at the top of the screen tells you when it starts winning"* —
  **there is no bar.** There is a text chip (`{n}d left`) that renders only when
  net is negative.
- coach1's "two or three people a week" **is** correct (`randInt(2,3)`, 7-day
  timer). Good.
- Empire tab: **"Reach $9,000 and 32 reputation to expand"** — `UNLOCK_CASH =
  9000`, but `STATION_COSTS[0] = 12000`. The progress bar reads as a price tag.
  You bank $9,000, and only then a modal tells you the buildout is $12.0k.
  **Fix:** "Unlocks at $9,000 and 32 rep. The buildout itself is $12,000."
- Crew weights (55/30/0.45) match `CREW_WEIGHTS`/`LOAD_PER_COHOST` exactly.
  Credit where due.

**Is the first decision reachable in under a minute?** Yes — Studio in ~30s,
Staff in ~50s. But the first *consequential* decision (hire from a board that
expires) punishes you for reading, and the first decision the game is actually
about (which station gets which body) is 139 days away.

**Are failure conditions stated before you can hit them?** **No.** See RANK 10.

**Can you find pause, save and quit without a keyboard?** Yes — ☰ top-left,
`aria-label="Menu"`, gives Resume / Save / Settings / Main Menu. Nothing tells
you pause lives behind a hamburger. And per RANK 1, Resume is sometimes a
no-op. Also: **Game speed 1×/2×/3× is buried in ☰ → Settings.** A player who
never finds it plays the whole first hour at 5 seconds per day.

Bonus trap: ☰ → Settings → ← returns you to the game screen with the clock
stopped, the menu gone, and no Resume control visible.

**Controller?** Faked `navigator.getGamepads` via CDP before load: the toast
fires — `🎮 Controller connected — A select, B back, LB/RB tabs, LT/RT stations`
— and a focus cursor appears. Menus are navigable. **Two gaps:** the toast omits
**X (pause)** and **Start (menu)**, both of which are bound (`ui.js:2537`,
`:2745`); and **Settings contains no controller section at all**, so once the
toast fades the bindings are unrecoverable. **Fix:** add the two missing
bindings to the toast and a static list to Settings.

---

## 4. Founding a second station — the good news

This is the best-onboarded thing in the game and it should be the template for
everything above.

- Unlock modal: *"A one-time buildout of $12.0k. From the next morning it is a
  real signal with its own lease, its own four slots and **no staff of its own —
  everyone you hire is already working somewhere**."* That is the thin-staff
  problem, stated plainly, before the spend.
- Commitment sheet (`reviewFounding`): buildout, **lease every day**, net now,
  net after, cash runway in days, and *People per slot: "{n} on payroll for
  {slots} slots"* with a red warning when thin. Plus
  *"Two stations chasing one audience split it — the second signal can be the
  wrong buy."*

Yes, the player understands it is a real decision and not a strictly-better
upgrade. **Only two defects:** the $9,000 → $12,000 mismatch above, and the
segment cards' static `Rivals N` (RANK 2), which is the one input to this
decision that is actively wrong.

## 5. The lease as a clock

Partially. Coach 3 states it in words and the Daily Brief breaks out
`Leases $60/day` every day. But the runway chip is unlabelled and intermittent,
the coach points at a UI element that does not exist, and — the reason it did
not land for me — **standing still was demonstrably safe.** I idled from day 29
to day 66 with three empty slots and cash climbed from −$307 to $2,022. The
copy says the lease is a clock; the sim showed me it is not, at one station.
No line of copy beats that.

## 6. Post-mortems

Six authored, and the death screen does diagnose. Mine:

> 📉 **Silent Authority** — KJGB filed silent. The tower stays up; the rent on
> it does not stop.
> *No engineer on the heavy slots. Faults kept taking a rep bite proportional to
> load, and rep is what the ad rate multiplies by.*

Well written and specific. Two problems:

1. **It is the first place the game explains the load → fault → reputation →
   ad-rate chain.** That is coach step 4's job and step 4 was unreachable for me
   (RANK 3). Teaching the central mechanic in the obituary is the definition of
   "only learnable by failing".
2. **Ordering skews the sample.** `causeNoEngineer` (`engAssigned === 0`) is
   checked before `causeGearHeavy` and `causeTalentThin`, and an unengineered
   roster is the default state of a losing player — engineers cost $392 + $49/day
   and the UI advertises them at "$2/day" (RANK 5). Most deaths will print
   `causeNoEngineer` whatever else went wrong. Also `causeGearHeavy` needs
   `tx >= 3 && rep < 40`, but tier 3 requires rep 45 to purchase — a narrow
   window.

Also unstated before it happens: death **wipes the save**.

---

## 7. The one-sentence summary for whoever fixes this

**Callsigns is not badly written — it is badly wired.** `content.js` contains an
authored explanation for `candidateNote`, `coHostElsewhere`, `segCompSub`,
`styleNote`, `chemLbl`, `chemNone`, `chemFlat`, `quirkLbl`, `loadValue`,
`coHostCap`, `engNoneHired`, `fxBreak` and `fxFid`, and **`ui.js` references
none of them.** Six of my top ten confusions have their fix already sitting in
the repo as a string with no call site. Wire those, fix the pause no-op, put a
live number behind the word "Rivals", and the legibility problem is most of the
way solved without writing a tutorial.
