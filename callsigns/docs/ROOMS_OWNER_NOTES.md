# Callsigns — owner's notes on rooms (2026-08-16)

Gonzo's read, recorded verbatim in substance because it identifies a problem
upstream of everything the two design proofs and the harness were measuring.
**Read this before `DESIGN_PROOF_ROOMS.md` or `DESIGN_PROOF_ROOMS_V2.md`** — both
of those reason correctly from a premise this note says is wrong.

## The note

> You currently or previously had 4 time slots per station. We only need one
> music studio to house the DJs and Engineers — we don't need 6 or whatever
> different types of rooms. Have you researched how real radio stations work?
> We would have a studio of 2–3 per LARGE multi-channel building. So for one
> station the 4 time slots may share 1–2 rooms, studios, bays, general audio
> transmitting areas.
>
> Now if you want to add specific rooms that people can curate in — for example
> a Music archive room that a DJ is the librarian of — then that can be
> something of a bonus room with a DJ assigned.

## Note 1 — "Offices", holding the three types

> We can have "Offices" if you want with the 3 types.

So the container is an **office**, and the three specialisations live inside it.
That replaces "bay" (a purchased slot in a building programme, which was
invented to have something to spend money on) with a thing that means something
on its own: an office is a place in the building, and what it is FOR is the
type. Naming to settle when the shape is: office / studio / room.

Open question for the next note: is an office **per group** (one newsroom
serving four callsigns) or **per building/station**? The note above argues for
per group; this note does not settle it.

## Note 2 — studio bays, 1+ per station

> We can have 1+ studio bays per station, that the assigned persons per station
> can use for their time slot.

This is a SECOND, separate object from note 1's offices, and keeping them apart
is the point:

- **Studio bay** — per STATION, physical. It is where a daypart is broadcast
  from, so the four dayparts of one callsign share it (they are six hours apart;
  nothing conflicts). A second studio is capacity, not duplication.
- **Office** — the three specialisations (newsroom, archive, engineering). A
  person is assigned to curate it and is off the air while they are.

The obvious mechanical hook for a studio bay, and it needs the owner's call:
the game already caps a slot's crew at `MAX_CREW = 3` with no physical reason.
A studio bay could BE that reason — one booth seats a lead and one co-host, a
second bay lets you run a three-hander, or lets a second station in the same
building stop queueing behind the first. That would ground an existing constant
in the fiction instead of inventing a new resource.

Open: does a second studio raise crew capacity, cut fault risk (a spare booth
when one is down), or enable production work? Not settled here.

## Why this lands

**It was never checked against how radio actually works.** The room design was
derived backwards from the vault's gate ("prove the optimal play is not
constant") rather than forwards from how a station group is laid out. That is
the wrong direction, and it is the likeliest reason the arithmetic never
cooperated: the model did not correspond to anything, so there was nothing for
the tuning to converge on.

Two concrete mismatches:

1. **The four dayparts already share a studio.** Morning drive and the night
   show use the same room six hours apart. The game has no studio object and
   should not need one — but the room model implicitly treated a "room" as a
   thing a daypart occupies, which is why the ceiling ended up denominated in
   *served slots*.
2. **A newsroom or a record archive serves the whole group, not one callsign.**
   Four stations share one newsroom. Rooms were made per-station purely to
   manufacture a placement axis so there would be something to choose between —
   the requirement inventing the fiction.

## What the gate was, and why it kept failing

`DESIGN_PROOF_ROOMS.md` §3.3 required a policy that reads game state to beat a
fixed rule ("always build a Newsroom") by 5% of end cash, on the theory that if
a fixed rule ties, the choice is decoration. That is a fair test *of the thing
that was built*. It failed repeatedly because **"which of three types on which
of four stations" was never a real question**: `MAX_BAYS = 6` against
`MAX_STATIONS = 4` and three types means nothing is ever excluded, and one type
(Newsroom) dominates everywhere.

Measured, paired seed-by-seed, on the shipped build:

    reading state vs alwaysNews   -$14,805      (reading state LOSES)
                  vs alwaysLib    +$63,433
                  vs roundRobin    +$6,479      bar: $353,475

Two attempts to fix it by tuning both failed, and the second made it worse:

- raising room magnitudes ~7x (v2): still a tie
- forcing scarcity, `MAX_BAYS 6 -> 2`: reading state's deficit grew to **-$92,680**,
  because with two bays you simply build two Newsrooms

An unexplained anomaly remains and is probably a bug worth one look: the boards
converge to **11 music slots against 5 talk**, so the Record Library should be
the strong room — yet in-run it earns **$20/day against the Newsroom's $513**,
despite identical constants and an isolated measurement of +$1,724/day on a
four-music board.

## The shape the note suggests instead

One **shared facility per group** (not per station), with a **curator** — a
named person assigned to it, off the air while they are in it.

That is a better fit for three reasons:

- It matches the fiction: one newsroom, one archive, one engineering shop,
  serving every callsign the group owns.
- The decision becomes **"is this person worth more curating than
  broadcasting"**, which is the person-hours scarcity the game already runs on —
  the same constraint that makes engineers, `staffSlotLoad()` and signal
  condition work. No new resource is invented.
- It removes the placement axis that was only ever there to create a choice,
  and replaces it with one the game can already ask honestly.

Under that model the gate would test something different and more answerable:
*does pulling someone off air to curate ever beat leaving them on it, and does
the answer change with who they are and what the board looks like?*

## Status at the time of this note

Rooms v2 is **LIVE on main** (merge `135fe59`), shipped at the owner's explicit
call with its gate failing. Three rooms, six bays, per-station. Net-positive
(+$255/day) and safe — smoke 55/55, rooms.mjs 54/54, v6 saves migrate intact —
but a good upgrade rather than a decision. Nothing here needs reverting for
safety; the question is whether to rebuild the shape or park it.
