#!/usr/bin/env node
/**
 * Build a screenshot corpus for the docker harness from REAL pi session logs.
 *
 * The harness ships one 6-line faux session, so every transcript-bearing
 * surface screenshots as an empty right-hand pane ("Pick a session on the left
 * to continue"). That is why the captures looked hollow.
 *
 * This transplants real sessions out of ~/.pi/agent/sessions into the
 * container's session store, rewriting each log's `cwd` to the fixture folder
 * so the dashboard groups them under /fixtures/sample-git.
 *
 * Session logs are append-only JSONL:
 *   line 1        {"type":"session","version":3,"id":…,"timestamp":…,"cwd":…}
 *   session_info  {"type":"session_info",…,"name":"add-auto-session-naming"}
 *   message…      the transcript, chained by id/parentId
 *
 * `cwd` on line 1 is the ONLY field that decides folder grouping, and
 * `session_info.name` is what session-scanner.ts:304 shows as the card title —
 * so a rewrite of one field per file is enough. Nothing is synthesised.
 *
 *   node design-scratch/shots/corpus.mjs [--count 8] [--max-lines 700]
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const SRC = join(homedir(), ".pi", "agent", "sessions");
const FIXTURE_CWD = "/fixtures/sample-git";
const CONTAINER_DIR = "/home/pi/.pi/agent/sessions/--fixtures-sample-git--";
const STAGE = "/tmp/pi-shots-corpus";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i === -1 ? d : Number(process.argv[i + 1]);
};
const COUNT = arg("--count", 8);
const MAX_LINES = arg("--max-lines", 700);

/** Container that publishes the harness dashboard port. */
function container(port) {
  const out = execFileSync("docker",
    ["ps", "--filter", `publish=${port}`, "--format", "{{.Names}}"], { encoding: "utf8" });
  const name = out.trim().split("\n")[0];
  if (!name) throw new Error(`no container publishing port ${port} — is the harness up?`);
  return name;
}

/** Read a log's headline facts without holding the whole transcript. */
function inspect(path) {
  let raw;
  try { raw = readFileSync(path, "utf8"); } catch { return null; }
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length < 20) return null;

  let head;
  try { head = JSON.parse(lines[0]); } catch { return null; }
  if (head.type !== "session" || !head.cwd) return null;

  let name = null;
  let messages = 0;
  for (const l of lines) {
    // Cheap prefilter — JSON.parse on every line of 1.6 GB is the slow path.
    if (name === null && l.includes('"type":"session_info"')) {
      try { name = JSON.parse(l).name ?? null; } catch { /* keep scanning */ }
    } else if (l.includes('"type":"message"')) messages++;
  }
  return { path, lines, head, name, messages };
}

console.log(`scanning ${SRC} …`);
const dirs = readdirSync(SRC).filter((d) => d.includes("pi-agent-dashboard"));

// Prefer real, substantial, NAMED sessions — a named card is what makes the
// session list read like a workbench instead of a fixture.
const pool = [];
for (const d of dirs) {
  let files;
  try { files = readdirSync(join(SRC, d)); } catch { continue; }
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    const p = join(SRC, d, f);
    let size;
    try { size = statSync(p).size; } catch { continue; }
    if (size < 80_000 || size > 1_200_000) continue;
    pool.push({ p, f, size });
  }
}
console.log(`  ${pool.length} candidate logs in size band`);

// Spread the picks across the pool so the corpus is not eight variations of
// one week's work.
pool.sort((a, b) => a.f.localeCompare(b.f));
const stride = Math.max(1, Math.floor(pool.length / (COUNT * 3)));
const picked = [];
for (let i = 0; i < pool.length && picked.length < COUNT; i += stride) {
  const info = inspect(pool[i].p);
  if (!info || !info.name || info.messages < 15) continue;
  picked.push({ ...info, file: pool[i].f });
}
if (picked.length === 0) throw new Error("no usable session logs found");

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

for (const s of picked) {
  // Rewrite ONLY the cwd on the session line; everything else is verbatim.
  const head = { ...s.head, cwd: FIXTURE_CWD };
  const body = s.lines.slice(1, MAX_LINES);
  writeFileSync(join(STAGE, s.file), [JSON.stringify(head), ...body].join("\n") + "\n");
  console.log(`  + ${String(s.messages).padStart(4)} msgs  ${s.name}`);
}

const PORT = process.env.PW_E2E_PORT ?? "18916";
const C = container(PORT);
execFileSync("docker", ["exec", C, "sh", "-lc", `mkdir -p ${CONTAINER_DIR}`], { stdio: "inherit" });
for (const s of picked) {
  execFileSync("docker", ["cp", join(STAGE, s.file), `${C}:${CONTAINER_DIR}/${s.file}`]);
}
execFileSync("docker", ["exec", C, "sh", "-lc",
  `chown -R pi:pi /home/pi/.pi/agent/sessions 2>/dev/null || true; ls -1 ${CONTAINER_DIR} | wc -l`],
  { stdio: "inherit" });

console.log(`\n${picked.length} sessions → ${C}:${CONTAINER_DIR}`);
console.log("restart the container so session-scanner re-reads the store:");
console.log(`  docker restart ${C}`);
