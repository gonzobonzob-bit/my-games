// Static validation of the bundled offline question packs.
//
// These packs are the degradation path: when Open Trivia DB does not answer,
// they are the entire game. Nothing else in the suite reads them exhaustively —
// a live run samples ten questions out of hundreds, so a broken entry can sit
// in the deck for months and surface as one baffling round for one player.
//
// The rule that matters most here is the distractor-collision rule. The live
// importer, fromOpenTdb(), drops a question whose wrong answers contain the
// right one, because the board would then show the correct text twice and mark
// only one of them right. Authored content is held to the same rule — it is
// simply not enforced by the importer, because it never passes through it.
//
// No browser, no server, no network. Runs in well under a second.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/index.js');
const src = fs.readFileSync(SRC, 'utf8');

const fails = [], notes = [];
const ok = (c, l, x) => c ? notes.push('PASS  ' + l)
                          : fails.push('FAIL  ' + l + (x !== undefined ? '  :: ' + JSON.stringify(x) : ''));

/* Pull the PACKS literal out and evaluate it. It is pure data — strings,
   arrays and object literals — so this cannot execute anything meaningful,
   and it beats regex-parsing nested quotes badly. */
function literalAfter(marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('marker not found: ' + marker);
  const open = src.indexOf('{', i);
  let depth = 0, inStr = null, esc = false;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return src.slice(open, j + 1); }
  }
  throw new Error('unbalanced literal after ' + marker);
}

/* Same scanner, but anchored on '[' — FALLBACK_PACK is an array literal. */
function literalAfterArray(marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('marker not found: ' + marker);
  const open = src.indexOf('[', i);
  let depth = 0, inStr = null, esc = false;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0) return src.slice(open, j + 1); }
  }
  throw new Error('unbalanced literal after ' + marker);
}

let PACKS;
try {
  PACKS = new Function('return (' + literalAfter('const PACKS = {') + ');')();
  ok(true, 'the PACKS literal parses');
} catch (e) {
  console.log('FAIL  could not parse PACKS :: ' + e.message);
  process.exit(1);
}

/* 'mixed' is not in PACKS — it is served by FALLBACK_PACK, declared further
   down the file. It is the same kind of data, reachable by the same
   degradation path, and it is held to the same rules. Leaving it out of this
   check is exactly how it ended up shipping with no Spanish at all. */
try {
  PACKS.mixed = new Function('return (' + literalAfterArray('const FALLBACK_PACK') + ');')();
  ok(true, "the mixed pack (FALLBACK_PACK) parses");
} catch (e) {
  ok(false, 'could not parse FALLBACK_PACK', e.message);
}

const GENRES = Object.keys(PACKS);
ok(GENRES.length >= 7, 'every genre still has a pack, mixed included', GENRES);

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
let total = 0;
const perGenre = {};

for (const g of GENRES) {
  const rows = PACKS[g];
  if (!Array.isArray(rows)) { ok(false, `${g}: pack is an array`); continue; }
  perGenre[g] = rows.length;
  total += rows.length;

  const seen = new Map();
  let bilingual = 0;
  const diff = { easy: 0, medium: 0, hard: 0 };

  for (let i = 0; i < rows.length; i++) {
    const q = rows[i];
    const at = `${g}[${i}] "${String(q && q.text).slice(0, 46)}"`;

    if (!q || typeof q.text !== 'string' || !q.text.trim()) { ok(false, at + ': has text'); continue; }
    if (typeof q.correct !== 'string' || !q.correct.trim()) { ok(false, at + ': has a correct answer'); continue; }
    if (!Array.isArray(q.wrong) || q.wrong.length !== 3) { ok(false, at + ': has exactly 3 distractors', q.wrong); continue; }

    // THE RULE: no distractor may equal the answer, in either language.
    if (q.wrong.some((w) => norm(w) === norm(q.correct))) {
      ok(false, at + ': EN distractor collides with the answer', { correct: q.correct, wrong: q.wrong });
    }
    // ...and no two options may be the same, which is the same bug wearing a hat
    const opts = [q.correct, ...q.wrong].map(norm);
    if (new Set(opts).size !== 4) ok(false, at + ': duplicate EN options', [q.correct, ...q.wrong]);

    if (!['easy', 'medium', 'hard'].includes(q.difficulty)) {
      ok(false, at + ': difficulty is one of easy/medium/hard', q.difficulty);
    } else diff[q.difficulty]++;

    if (typeof q.category !== 'string' || !q.category.trim()) ok(false, at + ': has a category');

    // Spanish parity, which the packs promise structurally rather than by luck
    if (q.es) {
      bilingual++;
      const e = q.es;
      if (typeof e.text !== 'string' || !e.text.trim()) ok(false, at + ': ES has text');
      if (typeof e.correct !== 'string' || !e.correct.trim()) ok(false, at + ': ES has a correct answer');
      if (!Array.isArray(e.wrong) || e.wrong.length !== 3) {
        ok(false, at + ': ES has exactly 3 distractors', e.wrong);
      } else {
        if (e.wrong.some((w) => norm(w) === norm(e.correct))) {
          ok(false, at + ': ES distractor collides with the answer', { correct: e.correct, wrong: e.wrong });
        }
        const eopts = [e.correct, ...e.wrong].map(norm);
        if (new Set(eopts).size !== 4) ok(false, at + ': duplicate ES options', [e.correct, ...e.wrong]);
      }
    }

    const key = norm(q.text);
    if (seen.has(key)) ok(false, `${g}: duplicate question — "${q.text.slice(0, 50)}"`, { alsoAt: seen.get(key) });
    else seen.set(key, i);
  }

  ok(bilingual === rows.length,
     `${g}: every question ships with its Spanish pair`, { bilingual, total: rows.length });
  ok(diff.easy > 0 && diff.medium > 0 && diff.hard > 0,
     `${g}: all three difficulties are represented`, diff);
  ok(rows.length >= 20, `${g}: the pack is deep enough to play a full game without repeats`, rows.length);
}

console.log(Object.entries(perGenre).map(([g, n]) => `${g}=${n}`).join('  '), ` total=${total}`);
for (const f of fails) console.log(f);
console.log(`\npassed ${notes.length}  failed ${fails.length}`);
process.exit(fails.length ? 1 : 0);
