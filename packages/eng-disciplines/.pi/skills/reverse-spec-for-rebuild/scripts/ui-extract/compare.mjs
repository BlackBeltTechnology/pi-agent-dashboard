#!/usr/bin/env node
// Usage: node compare.mjs <prose.bpmn> <from-code.bpmn>
// Ref-level comparison of a prose-authored flow and a code-derived flow (deterministic, sorted).
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2);
if (!b) {
  console.error("usage: compare.mjs <prose.bpmn> <from-code.bpmn>");
  process.exit(2);
}
const refs = (f) => {
  const x = readFileSync(f, "utf8");
  const docs = [...x.matchAll(/<bpmn:documentation>([\s\S]*?)<\/bpmn:documentation>/g)].map((m) => m[1]);
  const set = new Set();
  for (const d of docs) {
    for (const m of d.matchAll(/\b(?:BR|QUIRK|GAP)-\d+\b/g)) set.add(m[0]);
    for (const m of d.matchAll(/spec:[\w-]+#[^;\n|]+/g)) set.add(m[0].trim().replace(/&amp;/g, "&"));
  }
  return set;
};
const A = refs(a);
const B = refs(b);
const sort = (s) => [...s].sort();
const out = {
  both: sort([...A].filter((r) => B.has(r))),
  onlyProse: sort([...A].filter((r) => !B.has(r))),
  onlyCode: sort([...B].filter((r) => !A.has(r))),
};
console.log(JSON.stringify(out, null, 1));
