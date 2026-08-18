# Callsigns — the cutaway seam (binding on all three builders)

Written by the integrator BEFORE the squad ran, because the one thing three
parallel builders cannot negotiate at runtime is the interface between them.
Canon: `DESIGN_PROOF_ROOMS_VISUAL.md`. Nothing here overrides that document.

## File ownership — one file each, no exceptions

| file | owner | holds |
|---|---|---|
| `js/fx.js` | art-and-feel | the SVG factory + the motion contract |
| `js/ui.js` | interface-engineer | the cutaway render on the Building tab |
| `js/content.js` | content-writer | mark ids, names, copy, the dead emoji |
| `index.html` | **integrator only** | all CSS. Builders SUBMIT css, they do not write it |

## The API, exactly

Declared in `js/fx.js`. Every one returns an SVG **string**, sized in the
viewBox, painted on `currentColor`, with no `width`/`height` attribute (CSS
sizes them) and no `id` attribute anywhere (six floors mean six copies, and
duplicate ids are invalid and break `<use>`).

```js
roomMark(type)            // 'rack' | 'prod' | 'traffic'  -> 22x22 viewBox
roleFigure(role, state)   // 'dj' | 'eng' | 'sales'       -> 16x22 viewBox
ghostSeat()               //                               -> 16x22 viewBox
```

- `state` is `'work'` or `'still'`. It selects the POSE only. It must never be
  the sole carrier of a game state — see canon §5.
- An unknown `type` or `role` returns a neutral mark rather than throwing or
  returning `''`. A missing person must read as "someone is here", never as an
  empty floor.
- Output is trusted markup built from a fixed table. **It never interpolates a
  person's name, a room name, or anything else off the save.** All text near a
  figure is escaped by ui.js and lives outside the SVG.

## The class names, exactly

ui.js emits these; the integrator's CSS styles them; fx.js may assume them.

```
.cutaway            the stack (replaces .bay-grid)
.cut-floor          one bay = one floor (replaces .bay-row)
.cut-num            the gutter: floor number over lease (replaces .bay-lbl)
.cut-cell           the floor's button (keeps every .bay-cell state class)
.cut-mark           wraps roomMark()
.cut-seats          the seat cluster
.cut-fig            one seat; .ghost when unfilled
.cut-slab           the floor slab, drawn as a border, not an element
```

**The four state classes survive unchanged** — `filled`, `idle`, `over`,
`zeroed` keep their exact current meaning and their current colours. This pass
adds a picture; it does not restate the economy.

Seat stagger is `style="--seat-i:N"` on `.cut-fig`, N from 0. CSS derives the
`animation-delay`; no builder writes a delay inline.

## Order

`uiBayRows()` keeps returning bay order. **ui.js reverses at render**, in the
DOM, so floor 1 is last in the markup and lowest on screen. Do not reverse in
CSS — visual order and focus order must not diverge.

## Degradation

ui.js calls fx through the existing `sim*`/`ui*` bridge pattern already in the
file: `typeof roomMark === 'function' ? roomMark(t) : ''`. A missing fx.js must
produce the current text row, never a white screen.
