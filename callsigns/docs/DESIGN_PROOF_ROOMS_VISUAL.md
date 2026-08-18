# Callsigns — visual canon for rooms (cutaway elevation)

Not a rule-1 gate: this pass changes no decision, no formula and no number. It
is here because rule 6 says an owner's direction gets written down in their
words before it gets built, and rule 7 says the readout is half the mechanic.

## The owner's direction (2026-08-17)

> Cutaway elevation is perfectly ok. You can kill the emoji, but we still need
> to know what that section action or item is for any emoji we kill. And the
> person in the cell. We can be cartoon, animation, anything that works. But
> think a little movement and persons with actions. Small.

Three binding calls in that: **a mark may replace an emoji only if the thing it
names is still identifiable**, **the person is in the cell**, and **movement is
small**.

## 1. What the picture is allowed to promise

The building is drawn as a **cutaway elevation** — sliced open, floors stacked,
one floor per bay — and NOT as a floorplan. This is a hard line.

A floorplan promises adjacency: corridors, neighbours, distance, "the Rack Room
is next to the studio." The simulation has none of it. Every room in v3 is sited
on the BUILDING and its ceiling is a building-wide sum (`Σ` plant, `Σ` headroom,
group remnant clearance); no room has a neighbour and no two rooms interact
through space. An elevation promises only what is true: these rooms are in one
building, they stack, and you bought them in order.

Rule 4 in a visual register — do not draw a relationship the arithmetic does not
have.

## 2. Floor order: bay 1 is the ground floor

Rows render **bottom-up**, so bay 1 sits at the bottom and each bay bought adds
a storey. DOM order is reversed with the visual order, never with CSS alone, so
focus order and reading order stay identical to what is on screen.

The gutter number stops being an index and becomes the floor. The lease under it
is what that floor costs to keep.

## 3. The mark set — what replaces each emoji

Every mark is inline SVG on `currentColor`, drawn in the existing palette, and
**never carries meaning alone**: the room's name in `.bc-name` sits beside it at
all times, and the mark itself carries a `<title>`. That is the owner's
condition, met twice — a player who cannot read the mark reads the word, and a
screen reader gets the word regardless.

| was | is | why it is legible as itself |
|---|---|---|
| 🔧 | **rack** — a cabinet outline with rack units and two status LEDs | the gear cabinet is what a rack room is; the LEDs are the only lit thing in it |
| 🎛️ | **desk** — three faders at different heights over a knob row | a fader bank is the one object that reads as "audio production" at 22px |
| 🗂️ | **log** — ruled lines with one slot filled solid | traffic is the daily log, and the filled line is the spot that sold |

Emoji outside the Building tab (dayparts, stations, the brief) are NOT in this
pass. There are ~57 more instances across the codebase and they need their own
sweep, with the same rule applied.

## 4. The person in the cell

Each floor shows its seats — `ROOM_SEATS = 3` — as small figures standing on the
slab. A seated figure is drawn per role, because role is what decides the room's
value and the player is choosing between bodies:

- **dj** — headphones and a mic in front of the face
- **eng** — cap and a raised hand tool
- **sales** — a headset and a clipboard

An empty seat is a dashed ghost, not an absence, so "this floor has room for one
more" is visible without opening the rate card.

This is the rule-7 half of the pass. The price of a room is a named person off
the air, and that price has until now been invisible until the rate card was
opened.

## 5. The motion budget — movement means work

**Motion is the state.** A staffed floor's figures work; an unstaffed floor is
perfectly still. Stillness is the signal for idle, which today needs an amber
border and a ⚠ to say the same thing.

Hard limits, because this runs on a phone in five-second days:

- CSS only. No JS, no rAF, no timer. `transform` and `opacity` only, so every
  animation stays on the compositor.
- 2.4s–3.2s cycles, ≤3px of travel, staggered per seat by `animation-delay` so
  three figures never sync.
- Ceiling of 18 animated elements (6 floors × 3 seats), which is the six-bay cap.
- Everything sits inside `@media (prefers-reduced-motion: no-preference)`. At
  `reduce`, every figure holds its working pose and no state is carried by
  motion alone — idle keeps its border and its ⚠.

## 6. What must not regress

- Row pitch stays near 51px; the six-bay stack must not push the card past what
  a 320×760 phone shows with the HUD and tab bar in place.
- Contrast is measured, not eyeballed: every new colour clears AA on `--panel2`
  at the size it is used.
- The four cell states — working, idle, zeroed, over-ceiling — remain findable
  without reading, and none of them may depend on motion to be findable.
