#!/bin/bash
# The harness RIG is a String.raw template. A backtick inside it silently ends
# the string. Anchors on the real DECLARATION (line-start), not any mention of
# it in a comment — an earlier version matched its own warning text and happily
# reported a 65-character RIG as clean.
#
# Bare invocation checks the harness. It used to crash with a raw ENOENT stack
# trace instead, which reads exactly like a corrupt file — a guard that fails
# unclearly is worse than no guard, so it defaults and it says what it checked.
TARGET="${1:-$(dirname "$0")/harness.mjs}"
if [ ! -f "$TARGET" ]; then
  echo "rigcheck: no such file: $TARGET" >&2
  exit 2
fi
node -e '
const f = process.argv[1];
const s = require("fs").readFileSync(f, "utf8");
const m = s.match(/^const RIG = String\.raw`/m);
if (!m) { console.log("no RIG declaration in " + f); process.exit(0); }
const start = m.index + m[0].length;
const end = s.indexOf("`;", start);
if (end < 0) { console.log("RIG NEVER CLOSES — file is corrupt"); process.exit(1); }
const rig = s.slice(start, end);
const bt = (rig.match(/`/g) || []).length;
const dollar = (rig.match(/\$\{/g) || []).length;
if (rig.length < 1000) { console.log("RIG suspiciously short (" + rig.length + " chars) — anchor is probably wrong"); process.exit(1); }
if (bt || dollar) {
  console.log("RIG CORRUPT: " + bt + " stray backticks, " + dollar + " ${} interpolations");
  let k = -1; while ((k = rig.indexOf("`", k + 1)) >= 0) console.log("   ..." + rig.slice(Math.max(0,k-60), k+25).replace(/\n/g," "));
  process.exit(1);
}
console.log("RIG clean (" + rig.length + " chars)");
' "$TARGET"
