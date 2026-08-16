# Callsigns — how real radio groups are actually laid out and run

First job run under `my-games/CLAUDE.md` **rule 4** (research the real thing
before designing the mechanic). Read with `ROOMS_OWNER_NOTES.md`. This
supersedes the physical model in `DESIGN_PROOF_ROOMS.md` and
`DESIGN_PROOF_ROOMS_V2.md` — both reasoned correctly from an invented premise.

---

## The five things we did not know

1. **Air studios are ~1:1 with signals; PRODUCTION rooms are the shared, scarcer
   resource.** iHeart's Portland cluster: 7 air studios for 7 stations, but only
   **5 production rooms**, and one tech core with per-station racks
   ([Radio World](https://www.radioworld.com/news-and-business/under-one-roof-at-last-in-portland)).
   So the owner's "1+ studio bay per station" is literally correct, and the room
   that is genuinely shared and genuinely short is the production room.
2. **US terrestrial radio pays NO sound-recording royalty.** Over-the-air needs
   only PRO blanket licences on the *composition* (ASCAP/BMI/SESAC).
   SoundExchange (~$0.0026/performance/listener) attaches **only when you
   stream** ([CD Baby](https://diymusician.cdbaby.com/music-rights/the-difference-between-ascap-bmi-sesac-and-soundexchange/),
   [SPLC](https://splc.org/2011/01/splc-guide-to-music-licensing-for-broadcasting-and-webcasting/)).
   A flat `ROYALTY_RATE = 0.045 × musicShare` is a defensible PRO model. Keep it
   flat. If Callsigns ever adds streaming, that is where a genuinely
   per-listener cost belongs, and it is a different cost curve.
3. **Airtime is perishable, and that is the defining economic fact of the
   business.** An hour cannot exceed 60 minutes, commercial load is ~14–16
   min/hr, and unsold avails are **lost forever** — so stations dump remnant at
   40–70% off (a $500 spot runs at ~$150)
   ([MBC](https://www.museum.tv/radio-encyclopedia-3/commercial-load)).
   The game's `fill` term is the sellout level and currently has **no floor and
   no perishability**.
4. **Local direct is 70–90% of small-market billing and rising; national costs
   ~28% off the top** — a 15% rep firm and a 15% agency commission compounding
   to 0.85 × 0.85 = **72.25% net**
   ([Inside Radio](https://www.insideradio.com/free/small-market-radio-is-re-assessing-the-value-of-ratings/article_2c5e9a50-dac8-11ea-a135-3b1b60127673.html)).
   That is a real, non-constant sell-mix decision the game does not have.
5. **Voice-tracking is how one person covers sixteen slots — and it is the
   mechanic the game is missing.** Talent pre-records breaks into automation; it
   airs as-if-live; one jock staffs multiple dayparts *and* multiple stations,
   from anywhere in the world
   ([Wikipedia](https://en.wikipedia.org/wiki/Voice-tracking)).
   This grounds `staffSlotLoad()` dilution in something real and creates a
   per-slot live-vs-tracked choice whose answer moves with daypart weight and
   pool depth.

---

## What a building actually contains

**Per BUILDING** — one rack room / TOC (studio PCs live *there*, KVM-extended
into the studios, because studios must be free of fan noise and heat); one
newsroom serving every callsign; **1..n production rooms, fewer than the number
of signals**; one traffic & continuity desk; a sales bullpen.

**Per STATION** — one air studio (the four dayparts share it, six hours apart),
plus an adjacent talk studio / news booth **only for talk and news formats**.
Portland's two AMs have one; the five FMs do not. That per-format asymmetry is
the honest shape of an "office per station".

Concrete counts, one building, 7-station cluster (iHeart Portland):

- 7 air studios on one floor
- the 5 FMs: one studio each, four mics
- the 2 AMs: a control room **plus** a separate talk studio **plus** an adjacent
  production studio doubling as a news/sports booth
- **5 production rooms for the cluster**
- tech core on a separate floor, **individual racks per station**

Mid-market clusters generally run 4–8 studios for 3–6 co-owned stations. Master
control is centralised — one hub can operate many signals. One newsroom
producing newscasts for more than one outlet is the most common news-sharing
arrangement ([Pew](https://www.pewresearch.org/journalism/2014/03/26/shared-operations-and-news-production/)).

**So: one rack room per building with per-station racks inside it; air studios
per signal.**

---

## Who is in them

**Shared across the whole cluster:** GM, **Chief Engineer** (engineers who once
had one or two stations now cover a dozen-plus, managing contract engineers
out-of-market — [Radio World](https://www.radioworld.com/columns-and-views/some-ideas-in-your-search-for-engineers)),
Traffic Manager, News Director and newsroom, Production Director, Promotions,
business office.

**Per signal, in principle:** Program Director — though many PDs program more
than one station — air talent, and a Music Director, which is normally a jock
wearing a second hat.

**Account Executives sell the CLUSTER, not a station.** Some groups explicitly
forbid selling one station standalone. Four or five AEs is a normal local sales
staff.

**Board operator** — the human who runs the log live. Largely eliminated by
automation.

**Chief Operator** — an FCC-*designated* person who must review and sign the
operating log weekly (47 CFR 73.1870(c)), log EAS Required Weekly Tests, tower
light inspections and parameter deviations, with logs kept two years. Small,
mandatory, and a real reason a designated human is attached to each licence.

Small stations: flat structure, everyone wears multiple hats.

---

## The money

**Inventory.** A broadcast hour cannot exceed 60 minutes. Load is ~14–16 min/hr
depending on format, counted in **units** (one spot of any length), not minutes.
Unsold positions are **avails**.

**Perishability.** Commercial inventory not sold is lost forever — there is no
way to store or warehouse it. Hence **remnant**: a $500 spot may run at ~$150,
with typical discounts of 40–70%.

**Traffic and continuity.** Traffic receives orders from sales, places spots
into avails at the best available rates, and generates the **daily log** — every
element that is not format: paid spots, bonus, make-goods, PSAs, promos,
sponsorships. The log drives the automation. Afterwards the **AsRun report**
compares scheduled against actual and goes to accounting for billing. The key
management report is the **avails report by daypart**
([Wikipedia](https://en.wikipedia.org/wiki/Traffic_(broadcasting))).

**Local vs national.** One market went 50% → 73% local over six years; others
run as high as 90%. Agency standard commission is 15%; a national rep firm takes
its own 15%.

**Trade/barter.** Stations trade airtime for goods and services because
incremental spots cost almost nothing to run; trade credits are valued at about
cash rate.

**What a production studio changes commercially: spec spots.** A produced demo
commercial made for a prospect *before* the sale. "Radio is best sold when
played, not pitched"
([Inside Radio](https://www.insideradio.com/features/must_read_mondays/radio-is-best-sold-when-played-not-pitched/article_5fcd7d76-f026-11e4-b02b-3354eb7c695c.html)).
They let a client hear and revise before committing, which shortens the close.
Historically they took days or weeks, which is exactly why they were rationed.

**Royalties.** ASCAP/BMI/SESAC license the composition; SoundExchange licenses
the sound recording for *digital* transmissions. If a station plays music only
over the air, the only right needed is the musical work. ASCAP/BMI blankets are
revenue- and audience-scaled and rate-court-constrained; **SESAC is private and
genuinely negotiated**.

---

## What actually constrains a real operator

Ranked by what the sources actually complain about:

1. **Sellers.** Finding and retaining outstanding sellers is named the
   industry's biggest challenge
   ([Radio Ink](https://radioink.com/2025/10/22/state-of-media-sales-radio-tops-profitability-hiring-still-a-struggle/)).
2. **Production / creative capacity.** A named bottleneck: copy piles up Friday
   afternoon, reps send late revisions, and production has to get it on air
   anyway. An entire outsourcing industry exists because stations cannot staff
   it.
3. **Engineering coverage.** One CE across a dozen-plus signals.
4. **Air talent.** Multiple small markets have lost *all* remaining local on-air
   talent to restructuring.
5. **Inventory ceiling and audience.** You cannot make more hours — only fill
   more of them at higher rates, and rate follows audience.
6. **Compliance.** Chief operator signature, EAS RWT, quarterly OPIF.

**Not a constraint in reality: studio count.** Studios are cheap next to
signals, and four dayparts genuinely share one room six hours apart. The owner's
note was right and the shipped model was wrong.

---

## Automation and voice-tracking

Automation runs clocks, rotations and traffic instructions; playout is
unattended, which the FCC explicitly permits
([FCC](https://www.fcc.gov/media/radio/unattended-operation)). Voice-tracking
has talent pre-record talk breaks — song intros, IDs, weather, sponsor mentions
— scheduled between elements so a shift airs as if live. One talent can staff
multiple dayparts across multiple stations, and tracks can be cut from anywhere
in the world.

Consequence: 24/7 presence without 24/7 staffing. The board-operator role
largely disappears. Labour cost falls, and localism falls with it.

---

## Room verdicts

**Maintenance Bay → SURVIVES, re-sited to the BUILDING as the Rack Room / TOC.**
One CE now covers a dozen signals and there is one tech core with per-station
racks. Its current per-station siting is wrong; its mechanic is right.

**Newsroom → DIES AS BUILT, survives as an object.** `newsMul()` is ceilinged by
`servedSlots(st, ROOM_NEWS)` — it pays the player in proportion to a scheduling
choice they already made *knowing the room exists*. **That is the same
self-reference class as Purr & Power's cost-basis pricing, applied to schedule
instead of money**, and it is very likely why the gate could never be passed by
tuning. Rebuild it as one building newsroom that **unlocks news inserts on music
hours** — top-of-hour news on a music station is the real norm — rather than
multiplying a show the player already picked.

**Record Library → DIES.** There is no music-library room in 2026. The library
is a database inside the scheduling system, and the "librarian" is a Music
Director, normally a jock wearing a second hat. Keep the person, cut the room.
(This is also the likeliest explanation of the $20/day-vs-$1,724/day anomaly —
worth one look at `libMul()`'s per-station siting.)

---

## The shape to build

**Per-building offices:**

| Object | Real thing | Real use | Attaches to |
|---|---|---|---|
| **Rack Room (TOC)** | tech core, per-station racks, one per building | CE maintains every signal from one room | replaces per-station `gearCut()`; a group-wide term on `condTarget()` / `stationWear()` |
| **Newsroom** | one newsroom serving every callsign | produces newscasts inserted into any format's hour | **unlocks** news inserts on music dayparts; feeds `S.rep`. Must NOT multiply a show already scheduled |
| **Production Room** (1..n, capped below station count) | 5 rooms for 7 signals | cuts spec spots, local commercials, imaging | raises the **local-direct** component of `fillCap()`; competes for the same staff pool |
| **Traffic Desk** | traffic manager + log system | places spots in avails, generates the log, bills from AsRun | puts a **remnant floor** under unsold inventory, rather than raising the ceiling |

**Per-station offices, bought later as the group expands:**

| Object | Real thing | Real use | Attaches to |
|---|---|---|---|
| **Air studio bay** (1+ required) | 1:1 with signals in every cluster | four dayparts share it, six hours apart | **IS** `MAX_CREW = 3` — one booth seats host + co-host; a second enables a three-hander and cuts `slotRisk` when one is down |
| **Talk studio / news booth** | Portland's AMs have one, its FMs do not | phone hybrids, guests, remotes | meaningful only for `talk`/`news` formats — a genuinely format-conditional purchase |

**Two new non-room mechanics, both real:**

- **Voice-tracking**, a per-slot mode. A tracked slot consumes a *fraction* of an
  assignment in `staffSlotLoad()` — which is precisely what voice-tracking is
  for — costs less, contributes no `attn` to signal condition, and takes an
  appeal penalty. Live vs tracked is settled by daypart weight, reputation and
  pool depth.
- **Sell mix**, local direct vs national. National is larger and lumpier but nets
  **72.25%**; local direct nets ~100% and is 70–90% of real small-market
  billing. The crossover depends on reputation and seller count, both
  player-controlled.

**Scarce resource: person-hours, unchanged.** Every office seat is an assignment
competing with an air shift — the constraint the game already runs on.

**The self-reference to avoid:** nothing here may derive a rate or a multiplier
from the player's own schedule or own costs. The current `newsMul()`/`libMul()`
pair does exactly that through `servedSlots()`, which is why the Newsroom pays
for a decision already made.
