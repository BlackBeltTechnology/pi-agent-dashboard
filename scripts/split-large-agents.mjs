#!/usr/bin/env node
// One-off: split a large directory AGENTS.md file-based.
// Rows <= INLINE_CAP stay verbatim in the dir AGENTS.md (lossless).
// Rows > INLINE_CAP are promoted to a per-file `<File>.AGENTS.md` sidecar
// (full detail + See-change history preserved, pull-only, not auto-injected);
// the dir row keeps a one-line summary + pointer.
// Usage: node scripts/split-large-agents.mjs <path/to/AGENTS.md> [--write]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";

const target = process.argv[2];
const write = process.argv.includes("--write");
if (!target || !existsSync(target)) {
  console.error("usage: node scripts/split-large-agents.mjs <AGENTS.md> [--write]");
  process.exit(1);
}
const INLINE_CAP = 200; // <= stays verbatim in dir; > is promoted to a sidecar
const SUMMARY_CAP = 110; // dir summary length for promoted rows (full detail in sidecar)

const dir = dirname(target);
const lines = readFileSync(target, "utf8").split("\n");
const rowRe = /^\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|\s*$/;

function collapse(s) {
  return s.replace(/\s+/g, " ").trim();
}
function summarize(purpose) {
  let s = purpose.split("<br>")[0];
  s = s.split(/\.?\s*See change:/i)[0];
  s = collapse(s);
  if (s.length <= SUMMARY_CAP) return s;
  const cut = s.slice(0, SUMMARY_CAP);
  const dot = cut.lastIndexOf(". ");
  if (dot > SUMMARY_CAP * 0.5) return cut.slice(0, dot + 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > 0 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}
// Sidecar body: full detail, <br> unfolded to blank-line-separated fragments.
function sidecarBody(name, purpose) {
  const parts = purpose.split("<br>").map((p) => collapse(p)).filter(Boolean);
  return `# ${name} — index\n\n${parts.join("\n\n")}\n`;
}

const out = [];
const sidecars = [];
let inlined = 0;
for (const line of lines) {
  const m = line.match(rowRe);
  if (!m || m[1] === "File") {
    out.push(line);
    continue;
  }
  const [, name, purpose] = m;
  const clean = collapse(purpose);
  if (clean.length <= INLINE_CAP) {
    out.push(`| \`${name}\` | ${clean} |`);
    inlined++;
    continue;
  }
  const scName = `${name}.AGENTS.md`;
  sidecars.push([join(dir, scName), sidecarBody(name, purpose)]);
  out.push(`| \`${name}\` | ${summarize(purpose)} → see \`${scName}\` |`);
}

const dirText = out.join("\n").replace(/\n+$/, "") + "\n";
console.log(`dir rows: inline=${inlined}, promoted(sidecars)=${sidecars.length}`);
console.log(`dir AGENTS.md size: ${readFileSync(target, "utf8").length} -> ${dirText.length} bytes`);
if (!write) {
  console.log("(dry-run; pass --write to apply)");
  process.exit(0);
}
writeFileSync(target, dirText, "utf8");
for (const [p, body] of sidecars) writeFileSync(p, body, "utf8");
console.log(`wrote ${target} + ${sidecars.length} sidecars`);
