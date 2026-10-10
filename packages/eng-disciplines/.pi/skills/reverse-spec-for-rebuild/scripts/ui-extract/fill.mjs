#!/usr/bin/env node
// Usage: node fill.mjs <prompt.md> <job.json> <screenId> > brief.md
// Fills {KEY} placeholders from job.common + the job.screens entry with ID=<screenId>; fails on leftovers.
import { readFileSync } from "node:fs";

const [tpl, jobFile, id] = process.argv.slice(2);
const job = JSON.parse(readFileSync(jobFile, "utf8"));
const screen = job.screens.find((s) => s.ID === id);
if (!screen) {
  console.error(`no screen '${id}' in ${jobFile}`);
  process.exit(2);
}
let s = readFileSync(tpl, "utf8");
for (const [k, v] of Object.entries({ ...job.common, ...screen })) s = s.split(`{${k}}`).join(v);
const left = s.match(/\{[A-Z]+\}/g);
if (left) {
  console.error(`unfilled: ${[...new Set(left)].join(" ")}`);
  process.exit(1);
}
process.stdout.write(s);
