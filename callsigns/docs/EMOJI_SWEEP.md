# Callsigns — the emoji inventory, and four collisions

Scope note: the cutaway pass (`DESIGN_PROOF_ROOMS_VISUAL.md`) retires the three
ROOM_TYPES emoji only. This file is the inventory for the sweep that finishes
the job, written while the squad ran so the next pass starts from a survey
instead of a grep. Figures are a snapshot of `main` at 397285b.

## The size of it

210 emoji instances, ~60 distinct, across `index.html` and all four modules.
**39 of them are `icon:` fields on content tables** — DAYPARTS, the formats, the
roles, the station types, the style tags, the room types — which is the good
news: they are data, in one file, behind one accessor each. The rest are inline
in strings (`introTitle: '📻 You are on the air'`), in the scene fallback, and
the `☰` / `⚠` / `✓` UI glyphs, which are a different problem and probably stay.

## The finding that matters: 39 fields, 32 distinct glyphs

Four glyphs are doing more than one job:

| glyph | jobs |
|---|---|
| 📰 | the news FORMAT, a station TYPE, and the "News-Desk Deadpan" style tag |
| 🌙 | the night DAYPART, a station TYPE, and the "Overnight Confessional" tag |
| 🔧 | the ENGINEER role, and the Rack Room |
| 📡 | "Remote Truck Regular" and "Link Whisperer" — two style tags **in the same list** |

The last one is the worst of the four and it is a live rule-7 defect, not a
tidiness note: a player comparing two engineers on the roster sees the identical
glyph standing for two different traits, in the same column, on the same screen.
Nothing tells them the tags differ. That is a readout that cannot be decoded,
which rule 7 says is the same failure as a mechanic that cannot be seen.

🔧 is the second worst and it is the one this pass half-fixes: the Rack Room
loses 🔧 to a drawn mark, but the engineer role keeps it, so the collision
survives in the direction that still matters (a figure standing in a Rack Room
is very likely an engineer).

## The rule the sweep runs under

The owner's condition on the cutaway pass generalises, and it is the whole test:

> we still need to know what that section action or item is for any emoji we kill

So: **a mark replaces a glyph only if what it names is still identifiable, and
identity is checked against every OTHER mark in the same list, not on its own.**
A set of 32 marks that are individually legible and mutually confusable has not
passed. The collision table above is what that check looks like when it fails.

## Order of work, when it is picked up

1. The four collisions — they are defects today, whatever the art ends up being.
2. The role icons (dj / eng / sales). They are already drawn as figures by the
   cutaway pass, so leaving the emoji elsewhere means two visual languages for
   one concept on adjacent screens.
3. The remaining `icon:` tables, one table at a time — dayparts, formats, station
   types, style tags. Each is a closed set that can be checked for mutual
   confusability as a set.
4. The inline-string emoji and the `☰ ⚠ ✓` glyphs last, and possibly never:
   they are UI furniture rather than identity, and `⚠` in particular is doing
   documented work in the bay strip that a drawn mark would have to earn.
