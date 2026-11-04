#!/usr/bin/env node
// GENERIC agent CLI: the agent accepts / rejects a whole mock (page), same file the site buttons write.
//   node decide.mjs list
//   node decide.mjs accept <mock-id> ["note"]
//   node decide.mjs reject <mock-id> "why"        (note required on reject)
//   node decide.mjs reopen <mock-id>
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const file = path.join(here, "mocks/decisions.json");
const ids = fs.readdirSync(path.join(here, "mocks")).filter((f) => f.endsWith(".mock.tsx")).map((f) => f.replace(".mock.tsx", ""));
const d = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const [cmd, rawId, ...rest] = process.argv.slice(2);
// accept any reference ("#<id>/1/proposed/2" or a full URL); decisions are per page
const id = rawId?.replace(/^.*#/, "").split("/")[0];
const note = rest.join(" ").trim();
const st = (v) => (typeof v === "string" ? v : v?.status) ?? "open";
if (cmd === "list" || !cmd) {
  for (const i of ids) { const v = d[i]; console.log(`${st(v).padEnd(8)} ${i}${v?.by ? `  (by ${v.by})` : ""}${v?.note ? `  - ${v.note}` : ""}`); }
  process.exit(0);
}
if (!ids.includes(id)) { console.error(`unknown mock: ${id}\nknown: ${ids.join(", ")}`); process.exit(1); }
if (cmd === "reopen") delete d[id];
else if (cmd === "accept" || cmd === "reject") {
  if (cmd === "reject" && !note) { console.error("reject needs a reason: node decide.mjs reject <id> \"why\""); process.exit(1); }
  d[id] = { status: cmd === "accept" ? "accepted" : "rejected", by: "agent", ...(note ? { note } : {}), at: new Date().toISOString() };
} else { console.error(`unknown command: ${cmd}`); process.exit(1); }
fs.writeFileSync(file, JSON.stringify(d, null, 2) + "\n");
console.log(`${st(d[id])} ${id}`);
