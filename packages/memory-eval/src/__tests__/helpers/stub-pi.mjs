#!/usr/bin/env node
// Scripted stand-in for `pi -p`. Behaviour comes from the JSON file named by
// STUB_CONFIG:
//   { logFile, pidFile?, calls?: [ per-invocation behaviours ], default?: behaviour,
//     verdicts?: { validity, helpfulness }, verdictById?: { [itemId]: verdict }, omit?: [itemId] }
// behaviour: { exit?, stderr?, stdout?, delayMs?, rawStdout? }
// Every invocation appends { argv, cwd, stdin } to logFile (JSON lines).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync(process.env.STUB_CONFIG, "utf8"));
let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) stdin += chunk;

const idx = existsSync(cfg.logFile) ? readFileSync(cfg.logFile, "utf8").split("\n").filter(Boolean).length : 0;
appendFileSync(cfg.logFile, `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), stdin })}\n`);
if (cfg.pidFile) writeFileSync(cfg.pidFile, String(process.pid));

const b = cfg.calls?.[idx] ?? cfg.default ?? {};
if (b.delayMs) await new Promise((r) => setTimeout(r, b.delayMs));
if (b.stderr) process.stderr.write(b.stderr);
if (b.exit) process.exit(b.exit);
if (b.rawStdout !== undefined) {
  process.stdout.write(b.rawStdout);
  process.exit(0);
}
const items = [...stdin.matchAll(/<item id="([^"]+)" kind="([^"]+)"/g)].map((m) => ({ id: m[1], kind: m[2] }));
const answers = items
  .filter((i) => !(cfg.omit ?? []).includes(i.id))
  .map((i) => ({
    id: i.id,
    verdict: cfg.verdictById?.[i.id] ?? (i.kind === "validity" ? (cfg.verdicts?.validity ?? "valid") : (cfg.verdicts?.helpfulness ?? "helpful")),
    note: "stub",
  }));
process.stdout.write(JSON.stringify(answers));
