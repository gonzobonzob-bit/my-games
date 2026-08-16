# Callsigns — blind playtest of the LIVE build (main @ b1c1e32)

Played 2026-08-15 in headless Chrome over CDP, from cleared `localStorage`, served at
`http://127.0.0.1:8741/index.html`. No design doc, no source, no test file was opened until
after the notes below were written. Two runs:

- **Run A (the real one):** KAUI → day 190, two stations, ~$56k peak cash.
- **Run B (deliberate suicide):** KHVN, hire everything and assign nobody, to see the
  failure state. Died day 81 at −$4,028.

~43 minutes of real time. Day length is 5 s at 1×.

---

## Minute by minute, the first ten

**0:00 — title.** "ON THE DIAL / CALLSIGNS / Build a radio station into a media empire."
New Game · Continue (greyed) · Settings · Quit. Clean. I know what genre I am in.

**0:20 — the first decision.** New Game gives me one field: a four-letter callsign starting
K or W, prefilled `KAUI`, with a Random button. That is a real decision and it arrives in
under thirty seconds. Good. There is no city/format/market choice — I assumed the format
came later. (It doesn't, at station 1; the segment choice only exists when you found a
*second* station on day ~119.)

**0:35 — day 1.** A lot of screen. $800 cash, 40 listeners, 5 reputation. A red HUD bar:
"4 slots are on air with nobody in the booth." An amber card, **FIRST DAYS · 1**, telling me
about hosts and that "two or three people are looking for work each week — that is the whole
talent supply, forever." Below it: SHOW QUALITY, AUDIENCE SHARE, AUDIO FIDELITY, BUZZ, a
SIGNAL CONDITION gauge, and a four-tile broadcast schedule.

**0:50 — the clock is running while I read.** I timed it deliberately. From the moment the
coach card appeared to the moment I finished reading it and dumped the screen, **eight game
days passed**. The coach is an inline card, not a modal, so this is clearly on purpose — but
see minute 2 for what it cost me.

**1:10 — "See who is available".** The card's own button. It switched me to Staff. (My first
click appeared to do nothing; it had in fact worked and I misread a re-render. Worth noting
that tab switches occasionally swallow a click when a modal is mid-animation — I lost four or
five clicks across the session this way.)

**1:20 — Staff, day 13.** Two candidates: Cleo Boone, DJ, Skill 3, $33/day, hire $264. Tess
Njoku, Sales Agent, Skill 1. Also a panel of numbers I did not understand: "Ad slots sold
50% · Ad rate 1.00× · Exposed 4/4 · At risk 0/4". I read the two candidate cards, decided on
Cleo, and clicked Hire.

**2:00 — the candidates were gone.** Between reading and clicking, the week rolled. Cleo and
Tess had been replaced by Bud Ellis and Moe Duvall. My click found no button. This is the
single worst moment in the onboarding and it happened at minute two: **the tutorial does not
pause the clock, and the thing the tutorial is pointing at expires every 7 days (35 real
seconds) with no warning and no timer.** I was also greeted by "⚠️ A fault hit KAUI Midday —
the load was 1.00x and nobody was on the desk," which is the first time the word LOAD appears,
seven days before the game explains it.

**2:20 — first event modal.** "📻 Trouble — KZAP La Zapote is giving away a truck." The HUD
shows ⏸ PAUSED. Events do stop the clock and wait for Resume. Good.

**2:40 — hired Moe (engineer, $392 + $49/day) and Bud (DJ, $312 + $39/day).** I hired the
engineer first on purpose. Cash $1,214 → $496.

**3:00 — FIRST DAYS · 2 appears**: "Bud Ellis is on payroll and not on the air. Morning drive
is the biggest audience of the day — start there." Correct, timely, state-driven. This is the
onboarding working.

**3:30 — the slot editor.** This screen is where the game finally becomes legible. SLOT LOAD
×1.00, FAULT RISK 6.0%, SLOT REVENUE $28, a light↔heavy "engineer crossover" gauge, four show
types with their load costs (`Talk +0.35`, `News +0.55`, `Paid +0.10`), a crew list, an
engineer list. The "⚠ ×1.00 · 6.0%" that had been sitting on every schedule tile since day 1
suddenly decodes: it is load and fault risk. Nothing outside this modal labels those two
numbers.

**4:00 — I assigned Bud and revenue went $28 → $68.** But the crew note says "The lead counts
full. Second chair counts 55%, third counts 30% — **and each one adds 0.45 to this slot's
load**", and after adding the lead the load was still ×1.00. I assumed I had misclicked. (I
had not — see Defect 4.)

**4:30 — FIRST DAYS · 4**, skipping 3. It explains load → fault → reputation and offers "Put
an engineer on it", which jumped me straight into the right slot. Fault risk went 6.0% → 2.7%.
This is the sequence the brief asked me to check and it worked.

**5:00 — FIRST DAYS · 3** (the lease note) arrives *after* 4. Then the coach goes quiet.

**5:00–10:00 — the loop.** Wait for candidates, put bodies in slots, watch cash. Around day
30 my daily net crossed zero. By day 66 I was at $954 and +$50/day. The loop had landed:
**hosts fill slots, slots sell ads, ads pay a payroll that is always slightly too big, and the
lease never stops.** That is the game and I understood it by about minute six.

---

## The five claimed fixes

| # | Claim | Verdict |
|---|---|---|
| 1 | Coach no longer strands on step 3 | **FIXED, with a cosmetic tail.** Order seen: **1 → 2 → 4 → 3 → 6.** Step 3 stepped aside for the actionable step 4 exactly as intended. I reached the last step (6, the coverage grid) at day 146. |
| 2 | Step 4 reachable after an early engineer hire | **FIXED.** I hired an engineer on day 16 and still got step 4 on day 20, with its button correctly switched from "Hire an engineer" to "Put an engineer on it". |
| 3 | Engineer bench no longer reads −$0 | **FIXED.** With Moe already assigned, the bench priced Moe at **+$12** (with "Putting Moe here pulls them off KAUI Morning Drive") and a second engineer, Miles, at **+$15**. Skill-differentiated, non-zero. |
| 4 | Broke warning states the room you have | **FIXED.** Two bands confirmed in the suicide run: the red-cash band, then below −$2,000 the bar reads "🩸 Closing on the floor at **-$4,000**. A few more days like this and the run ends," alongside a live "CASH 39D LEFT" countdown. The floor is named. |
| 5 | Pause menu no longer soft-locks over a stopped clock | **NO SOFT-LOCK, but the fix is a dead end.** With an event modal up, clicking ☰ **dismisses the event and resumes the game** — the pause menu never opens. The modal backdrop eats the click. Verified twice. No lock, but a player who hits ☰ during an event to save gets the opposite of both things they wanted, and loses the event text unread. |

**Step 5 never fired at all.** Its condition is "an engineer is on payroll and assigned
nowhere", which step 4's own button resolves in the same click. So the one sentence in the
whole tutorial that contains real strategy — *"Put them on the slot carrying the most load,
which is usually not the slot making the most money"* — is unreachable for any player who
follows the tutorial. Players who ignore step 4 get taught; players who obey it don't.

---

## Signal condition, read completely cold

**What the card shows.** A title, "settling toward 92%", a percentage with a meter and a
▼ −0.4%/week, then two lines: "Wear −0.25%/day · Part 15 Rig on a Whip Antenna. Bigger plant,
faster wear." and "Attention +0.19%/day · 1 slots with an engineer, 0 with hosts only. People
spread thin bring less of themselves."

**Did it explain itself? Half.** I understood immediately that staff push it up and gear
pushes it down, and the phrasing "people spread thin bring less of themselves" is genuinely
good — it told me *why* my four-station empire on three DJs would rot. Adding one host moved
the destination from 35% to 67%; adding one engineer moved it to 92%. That is a legible,
satisfying lever and I used it deliberately.

**Three things it never told me, in order of damage:**

1. **What condition actually does.** Nowhere on this card, or anywhere else, does the game say
   what a low percentage costs. It multiplies *pull* (listeners) and nothing else. The only
   sentence that explains the consequence — "Everything it airs goes out weak" — is the floor
   text, which renders **only at ≤37%**, i.e. after you have already lost. Meanwhile the card
   sits directly above a separate stat called **AUDIO FIDELITY 1.00×**, so my working theory
   for 190 days was that condition and fidelity were the same system. They are not: fidelity
   comes from the antenna.
2. **The two numbers do not produce the third.** Wear −0.25%/day against attention +0.19%/day
   is a net loss of 0.06%/day, which any player will read as "this goes to zero." The game says
   it settles at 92%. Both are true — the real update multiplies the gain by (1−c), so the gain
   grows as condition falls — but that (1−c) term is invisible. **The card shows an arithmetic
   that contradicts its own conclusion.** I checked it with a calculator and thought I had found
   a bug.
3. **Upgrading gear silently doubles your wear.** Wear is charged per transmitter and antenna
   tier. The gear buy button says "+$40/day lease, permanently" and nothing else. I bought
   every upgrade on KNNY in one spree; its wear went from 0.25%/day to ~1.10%/day and its
   destination collapsed to the 35% floor. I found this out from the source afterwards. **This
   is the thing you can only learn by failing**, and at 260 days-to-floor from a fresh station,
   most players will never live long enough to connect the two.

**Fair or quietly punishing?** Fair in shape, punishing in timing. Nothing I did in 190 days
moved either station below 93%, so for the whole playable window it is the most prominent card
on the main screen and the only one with no consequences. Then it becomes the reason your
revenue sags, at a point far past where anyone will remember buying the transmitter.

**Does "settling toward 79%" mean anything to a player?** Yes — but only as a *comparative*.
I could tell 92% was better than 35% and I could see which staffing move changed it. I could
not tell you what either number was worth in dollars or listeners, and the game never offered
to. One clause would fix it.

---

## Rivals, read cold

For 119 days the competition does not exist. There are flavour toasts ("KZAP La Zapote is
giving away a truck", "WFTH Faith and Family flipped formats overnight") and nothing else —
no rival appears on any tab, no share is attributed to anyone.

Then the founding card arrives and it is suddenly excellent: per-segment live incumbent totals,
three named networks with numbers, a trend pill, a lease multiplier, and the one line that
makes it make sense — *"Rival pull already sitting in the pool. Your share is what is left
after them — and after your own other stations."* That sentence should be on screen on day 1.

Two problems:

- **The trend pill has no subject.** "Rivals 1289 ▼ LOSING GROUND" — is that them or me? I read
  it as a warning about my own station. It is the opposite: the rivals are slipping and the pill
  is green. The only cue is colour.
- **The three networks are one number in a trenchcoat.** Sunbelt/Lantern/Ridgeway are always
  45%/35%/20% of the segment total, in every segment, forever. Four numbers where one would do,
  and after the second glance it stops feeling like three companies.

## Sales, read cold

This one is **legible after the fact and a trap before it.** With two sellers at reputation 60
the panel read "Ad slots sold **79% · at your reputation ceiling**" — exactly the right words.
I bought a third seller anyway (Reva Ferraro, $456 + $57/day) and fill moved 79% → 78%, i.e.
nothing, and a new red row appeared: "Sales going nowhere · 1.4 pts — your name cannot carry
them."

So the game does surface the waste — *after* the money is gone. At the moment of purchase the
hire card still read, unchanged, "Fills more of the ad log and holds the rate." I ended the run
with **six sales agents** and 3.6 wasted points. "1.4 pts" is also unexplained: points of what?

---

## Ranked confusions, worst first, with the cheapest fix for each

**1. Candidates expire in 35 real seconds and nothing says so.** *(loses the most players —
this is minute two of a first session)* I lost the exact candidate the tutorial had just told
me to hire because I read the card. `refreshCandidates()` empties `S.candidates` outright every
7 days.
**Cheapest fix:** one line above the hire list — `AVAILABLE FOR HIRE · this board clears in
{n} days`. Copy only, no new mechanic.

**2. Coach step 4 sends a day-20 player to buy an engineer worth $3/day.** Step 4's button when
you have no engineer is "Hire an engineer" → Staff. I paid $392 + $49/day. The slot editor then
told me, in the same session, "This is the best slot in the empire for an engineer right now:
$3/day." Nothing warned me before, and the crossover gauge that would have is inside a modal I
had not opened yet.
**Cheapest fix:** put the number on the hire card — Sound Engineer rows show
`· best slot in your empire today: +${n}/day`. Same call as `bestEngineerSlot()`, one string.

**3. Signal condition never says what it costs you.** See above. The consequence text exists
and only renders at ≤37%.
**Cheapest fix:** append to `condSettling` → `settling toward {pct}% · condition multiplies
every listener this signal pulls`. Nine words, one string, no logic.

**4. The crew note is factually wrong.** `coHostNote` says "each one adds 0.45 to this slot's
load"; `loadFactor()` is `1 + 0.45*(djCount − 1) + showTech`. The lead adds nothing. I added a
lead, watched load not move, and assumed the click had failed.
**Cheapest fix:** "…and **every co-host after the lead** adds 0.45 to this slot's load."

**5. Every unassigned staffer is labelled "Automation — about a third of a hosted slot, at the
same lease."** The roster falls back to `t('unstaffed')` for the "where is this person" line.
On a **Sales Agent**, who can never be assigned to a slot, this is permanently and flatly
wrong — I had six of them all claiming to be automation. It also makes a bench DJ look like a
piece of equipment.
**Cheapest fix:** a second string. `notAssigned: 'Not on any slot'`, and for sales,
`'Works empire-wide'`.

**6. Gear upgrades never mention wear.** "+$40/day lease, permanently" is two-thirds of the
price. The third is condition decay, and it is the reason my maxed station rotted.
**Cheapest fix:** add `· and {n}× the wear on your signal` to the upgrade row.

**7. The engineer hint reads like an event that already happened.** "🔧 Moe → KAUI Morning
Drive · $1/day" renders under the schedule in the same visual register as "⚠️ A fault hit KAUI
Midday". I believed for twenty minutes that the game had auto-assigned my engineer, and only
found out it hadn't when the slot editor said "0 / 2 assigned". It also only ever names
`staffOf('eng')[0]`, so with two engineers the second is silently ignored.
**Cheapest fix:** give it a verb. `Best home for Moe: KAUI Morning Drive (+$1/day)`.

**8. "Exposed" and "At risk" are never defined.** They appear as a colour legend, as
`Exposed 4/4 · At risk 0/4` on the Staff panel, as a numeral glued to the front of each station
chip ("1 KAUI", which reads as a station index), and as the HUD's loudest warning. I inferred
exposed = no host. I never worked out "at risk" (it is: staffed, load ≥ 1.45, no engineer).
**Cheapest fix:** legend labels become `Covered · At risk (no engineer) · Exposed (no host)`.

**9. The pause button dismisses events.** See fix #5 above.
**Cheapest fix:** let ☰ open the pause menu on top of an event instead of closing it, or hide
☰ while a modal is up so it cannot be mistaken for available.

**10. The coach CTA does not complete an acknowledge-only step.** `data-coach` runs `btn.run()`
and never calls `coachAck()`. I clicked "Show me the grid" on step 6, the card cleared, and the
same step came back later. Cosmetically, the player also sees the steps numbered **1, 2, 4, 3**
and wonders what they missed.
**Cheapest fix:** call `coachAck(id)` after `btn.run()` for steps with `ack: true`; and either
drop the number from the card or renumber by presentation order.

**11. Reputation is trending somewhere and I don't know why.** "Reputation 21 / 100 → trending
to 33" on day 18, "67 → trending to 52" after I founded an unstaffed second station. The target
moves, the cause is never named, and reputation is the thing that caps ad fill *and* ad rate
*and* gates expansion — so it is quietly the most important number on the screen.
**Cheapest fix:** `→ trending to 52 (4 exposed slots)`.

**12. Everything below the tab bar needs scrolling and nothing hints at it.** At 1440×900 the
broadcast schedule — the primary control surface — sits below the fold on the Studio tab, and
the segment cards on the founding screen start ~600px below it. The welcome toast does say
"Look for the amber card below the dial", which is the game admitting the problem.

---

## The direct questions

**1. What is the game about?** From play: *you own a radio station, you rent a transmitter by
the day forever, and you buy people to put in four time slots so the slots can sell ads; the
tension is that talent arrives at a fixed trickle and the lease does not care.* That is very
close to what it actually is. The gap is the second half — the game is also about **plant
maintenance** (condition/wear) and **reputation as a revenue ceiling**, and I played 190 days
without understanding either. I thought reputation was a score. It is the multiplier on
everything I sell.

**2. First thing I did, and was it right?** Typed a callsign and pressed Start Broadcasting.
Yes — it is one decision, it takes twenty seconds, and it lands me on Studio with the schedule
and the coach on the same screen. The right tab, first time.

**3. What did I not understand?** *Load* (punished me on day 5, explained on day 20). *At
risk*. *Buzz* (100%, then 115%, then 93%, never labelled). *Exposed*. *Show quality* vs
*audience share* vs *audio fidelity* vs *signal condition* — four multipliers, one of which is
the antenna and one of which is the transmitter's health, and nothing distinguishes them.
*"The new book came in"* (radio jargon for a ratings period; delightful, opaque). *Hot-Clock
Metronome*, *News-Desk Deadpan*, *Overnight Confessional* — every host has a named trait and
none of them is ever explained. *Lease premium ×0.70*. *"1.4 pts"*. *"0 / 2 assigned"* — two
what? *"Silent Authority"* on the death screen.

**4. What was never told to me that I needed?** Three things, all learned by losing:
(a) candidates vanish weekly; (b) an engineer is worth single-digit dollars a day until your
slots are heavy, and the tutorial tells you to buy one anyway; (c) transmitter upgrades charge
wear as well as lease. Also, positively: the **founding commitment screen** ("Buildout today
−$12.0k / Lease every day −$42 / Your net yesterday +$948 / Net after this lease +$906 / Cash
runway healthy / 3 on payroll for 8 slots ⚠️ You do not have the people to cover this") is the
best screen in the game and the model every other purchase should copy. The hire buttons and the
gear buttons should look like that.

**5. What made me keep playing?** The slot editor. The moment I saw revenue move $28 → $68 on
one assignment, and fault risk 6.0% → 2.7% on the next, I had a machine I could turn. The
second thing was the per-station coverage grid: four red cells is a to-do list. What nearly
stopped me was minute two — losing the candidate the tutorial had just named — and, later, the
long flat stretch from day 66 to day 119 where I had no candidates, no decisions, and a
progress bar to $9,000 at $50/day.

---

## The specific checks

- **Does the tutorial pause the game?** **No.** By design — the coach is an inline card, not a
  modal, and the source is explicit that this replaced a three-paragraph day-one modal. As a
  design choice it is defensible. As a *player experience* it cost me the first hire, because
  the one thing the card points at (the candidate board) is on a 35-second timer. The card
  doesn't have to pause the game; the candidate board has to stop expiring while it is up, or
  say when it will.
- **Does the tutorial match the code?** Mostly, with one real miss and one soft one.
  `CREW_WEIGHTS = [1, 0.55, 0.30]` ✓ matches "counts full / 55% / 30%". `SHOW_TECH` load costs
  ✓ match the +0.35/+0.55/+0.10 shown per show. `BANKRUPTCY_FLOOR = -4000` ✓ matches the warning
  text. `refreshCandidates()` rolls `randInt(2,3)` ✓ matches "two or three people a week".
  **Miss:** `coHostNote`'s "each one adds 0.45" vs `loadFactor = 1 + 0.45*(n−1)`. **Soft miss:**
  coach 3 says "The bar at the top of the screen tells you when it starts winning" — the runway
  is rendered as a text suffix ("CASH 60D LEFT"), not a bar.
- **Is the first decision reachable in under a minute?** Yes — about 25 seconds.
- **Are failure conditions stated before you can hit them?** Partly. The lease clock is stated
  (coach 3) and the runway is always on the HUD. But the *first* thing that costs you is a
  fault, and faults were hitting my station from **day 5**, fifteen days before the game
  explains what load is. The death screen ("No engineer on the heavy slots. Faults kept taking
  a rep bite proportional to load, and rep is what the ad rate multiplies by") is an excellent
  post-mortem and is also the first place that whole causal chain is stated in one sentence.
- **Pause, save, quit without a keyboard?** Yes: ☰ → Resume / Save / Settings / Main Menu, all
  mouse-reachable, plus a "Starting fresh overwrites your current station" confirm on New Game.
  Escape also pauses but is documented nowhere. Game speed 1×/2×/3× exists but is buried two
  levels down in Settings; at 1× a day is 5 s and nothing on the main screen suggests you can
  change that.
- **Controller.** Supported, and better than I expected. A first-connect toast fires: *"🎮
  Controller connected — A select, B back, LB/RB tabs, LT/RT stations."* Menus **are**
  navigable — I initially recorded main-menu nav as broken, then found I was holding the d-pad
  long enough to trigger key-repeat past two items; with short taps New Game → Settings → Quit
  walks correctly and A activates. Two real gaps: **the toast omits X (pause/resume), Y (save)
  and Start (menu)** — the three bindings that matter for a game whose save and quit live behind
  one button — and **Settings has no controller section at all**, so those bindings exist only
  in a source comment.
- **Does the game explain its own vocabulary?** No. Unexplained terms, complete list: load,
  exposed, at risk, covered, buzz, show quality, audience share, audio fidelity, signal
  condition, attention, wear, "settling toward", crossover, daypart, the book, hot-clock,
  second chair, lease premium, pts, "of yours", Silent Authority, and every host trait name.
- **What is unexplained but punished?** In order: **faults** (from day 5, explained day 20),
  **transmitter wear on gear upgrades** (never explained, only observable 100+ days later),
  **the reputation ceiling on sales** (surfaced only after you have bought the seller that does
  nothing), and **founding a station you cannot staff** — which is the one case the game
  actually gets right, with an explicit warning on the commitment screen.

---

## Verdict on the ✅ Complete card

**It has earned it, narrowly, and it should keep it.** Nothing in ~43 minutes and 270 combined
game days produced a crash, a console error, a stuck state, a lost save or an unwinnable
position. All five claimed fixes hold up under a real player driving a real browser; four are
clean and the fifth (pause-over-modal) removed the soft-lock without finishing the job. Save,
load, delete, confirm-before-overwrite, offline catch-up, settings, controller and a genuine
post-mortem death screen are all present and all work. That is a complete game.

What stands between it and a card I would defend without the word "narrowly" is not a feature.
It is about **eight strings**, and the two at the top are worth more than the other six
combined:

1. Tell the player the candidate board expires. *(one line above the hire list)*
2. Stop coach step 4 recommending a purchase the game itself prices at $3/day. *(put
   `bestEngineerSlot()`'s number on the engineer's hire card)*
3. Say what signal condition multiplies. *(nine words appended to `condSettling`)*
4. Fix `coHostNote` — it disagrees with `loadFactor()`.
5. Stop labelling every bench staffer, including sales agents who cannot be assigned at all,
   "Automation — about a third of a hosted slot."
6. Put wear on the gear upgrade button next to the lease.
7. Give the engineer hint a verb so it stops reading as an event log entry.
8. Define "exposed" and "at risk" in the legend that already exists.

Every one of those is a copy change in `content.js` or `ui.js`. None needs a new screen, none
touches the sim, and none risks the harness. Do those and the ✅ is unarguable.
