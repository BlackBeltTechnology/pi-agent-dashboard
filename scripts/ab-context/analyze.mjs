#!/usr/bin/env node
// Aggregate rows.jsonl → non-inferiority verdict + token delta.
// Usage: node analyze.mjs rows.jsonl
// Env:   NI_MARGIN  allowed adherence drop for arm B (default 0.10)
import fs from "node:fs";

const MARGIN = Number(process.env.NI_MARGIN || 0.10);
const rows = fs.readFileSync(process.argv[2] || "rows.jsonl", "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
if (!rows.length) { console.error("no rows"); process.exit(1); }

const arms = [...new Set(rows.map((r) => r.arm))].sort();   // ["A","B"]
const [A, B] = arms;
const pct = (x) => (100 * x).toFixed(0) + "%";

// ── adherence: group by task+check, pass-rate per arm (na excluded) ──
const cells = new Map();  // key `${task}|${check}` → {A:{p,n}, B:{p,n}}
for (const r of rows) {
  for (const [check, v] of Object.entries(r.checks || {})) {
    if (v === "na") continue;
    const k = `${r.taskId}|${check}`;
    const cell = cells.get(k) || {};
    const a = cell[r.arm] || { p: 0, n: 0 };
    a.n++; if (v === "pass") a.p++;
    cell[r.arm] = a; cells.set(k, cell);
  }
}

console.log(`\n═══ Adherence (non-inferiority margin δ=${MARGIN}) ═══`);
console.log(`arm A=${A}  arm B=${B}   verdict PASS ⟺ rateB ≥ rateA − δ\n`);
console.log(`${"task | check".padEnd(34)} ${A.padStart(9)} ${B.padStart(9)}   Δ(B−A)  NI`);
let niFail = 0;
for (const [k, cell] of [...cells.entries()].sort()) {
  const a = cell[A] || { p: 0, n: 0 }, b = cell[B] || { p: 0, n: 0 };
  const ra = a.n ? a.p / a.n : NaN, rb = b.n ? b.p / b.n : NaN;
  const d = rb - ra;
  const ni = rb >= ra - MARGIN ? "PASS" : "FAIL";
  if (ni === "FAIL") niFail++;
  const cellStr = (r, n) => `${isNaN(r) ? "  -" : pct(r)}(${n})`.padStart(9);
  console.log(`${k.replace("|", " | ").padEnd(34)} ${cellStr(ra, a.n)} ${cellStr(rb, b.n)}   ${(d >= 0 ? "+" : "") + (100 * d).toFixed(0) + "pp"}  ${ni}`);
}

// ── tokens & cost per arm ──
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const tok = {};
for (const arm of arms) {
  const rs = rows.filter((r) => r.arm === arm);
  tok[arm] = {
    total: mean(rs.map((r) => r.usage.total)),
    output: mean(rs.map((r) => r.usage.output)),
    cacheWrite: mean(rs.map((r) => r.usage.cacheWrite)),
    cost: mean(rs.map((r) => r.usage.cost)),
    tools: mean(rs.map((r) => r.nTools)),
    n: rs.length,
  };
}
console.log(`\n═══ Efficiency (mean per run) ═══`);
console.log(`${"metric".padEnd(14)} ${A.padStart(12)} ${B.padStart(12)}   Δ`);
for (const m of ["total", "output", "cacheWrite", "cost", "tools"]) {
  const a = tok[A][m], b = tok[B][m];
  const d = a ? (100 * (b - a) / a).toFixed(1) + "%" : "-";
  const fmt = (x) => m === "cost" ? "$" + x.toFixed(4) : x.toFixed(m === "tools" ? 1 : 0);
  console.log(`${m.padEnd(14)} ${fmt(a).padStart(12)} ${fmt(b).padStart(12)}   ${d}`);
}

console.log(`\n═══ Verdict ═══`);
console.log(niFail === 0
  ? `✅ B non-inferior on all ${cells.size} adherence cells (margin ${MARGIN}). Token Δ(total)=${((100 * (tok[B].total - tok[A].total) / (tok[A].total || 1)).toFixed(1))}%.`
  : `⚠️  B FAILED non-inferiority on ${niFail}/${cells.size} cells — inspect those before trimming. Small N ⇒ rerun with higher N before trusting.`);
console.log(`(runs: A=${tok[A].n} B=${tok[B].n}. Non-inferiority at small N is weak — see README.)\n`);
