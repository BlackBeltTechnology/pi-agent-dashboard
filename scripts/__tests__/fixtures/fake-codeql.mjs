#!/usr/bin/env node
/**
 * Fake `codeql` for scripts/codeql-local.mjs tests (test seam: CODEQL_BIN).
 *
 * Driven by the JSON plan at $FAKE_CODEQL_PLAN:
 *   { log, version, resolveExit, downloadExit, createExit, createStderr,
 *     analyzeExit, analyzeWrites: { path, content }, sarif: { "<language>": <SARIF doc> } }
 * `analyzeWrites` (optional) writes `content` to the absolute `path` during
 * `database analyze` — simulates a concurrent edit (harden-codeql-ratchet-followups #E3).
 * Every invocation appends one JSON line to `plan.log`:
 *   { argv, env: { LGTM_INDEX_FILTERS }, sourceRoot?: { "<relpath>": "<content>" } }
 *
 * See change: add-local-codeql-ratchet.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const plan = JSON.parse(readFileSync(process.env.FAKE_CODEQL_PLAN, "utf8"));
const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);

function listFiles(root, rel = "") {
  const out = {};
  for (const name of readdirSync(join(root, rel))) {
    const r = rel ? `${rel}/${name}` : name;
    const abs = join(root, r);
    if (statSync(abs).isDirectory()) Object.assign(out, listFiles(root, r));
    else out[r] = readFileSync(abs, "utf8").slice(0, 2000);
  }
  return out;
}

const record = { argv, env: { LGTM_INDEX_FILTERS: process.env.LGTM_INDEX_FILTERS ?? null } };
const done = (code = 0) => {
  appendFileSync(plan.log, `${JSON.stringify(record)}\n`);
  process.exit(code);
};

const [cmd, sub] = argv;
if (cmd === "version") {
  process.stdout.write(JSON.stringify({ productName: "CodeQL", version: plan.version ?? "2.27.2" }));
  done();
} else if (cmd === "resolve") {
  done(plan.resolveExit ?? 0);
} else if (cmd === "pack") {
  done(plan.downloadExit ?? 0);
} else if (cmd === "database" && sub === "create") {
  record.sourceRoot = listFiles(flag("--source-root"));
  mkdirSync(argv[2], { recursive: true });
  if (plan.createExit) {
    process.stderr.write(`${plan.createStderr ?? "create failed"}\n`);
    done(plan.createExit);
  }
  done();
} else if (cmd === "database" && sub === "analyze") {
  if (plan.analyzeExit) {
    process.stderr.write("analyze failed\n");
    done(plan.analyzeExit);
  }
  if (plan.analyzeWrites) writeFileSync(plan.analyzeWrites.path, plan.analyzeWrites.content);
  const language = basename(argv[2]).replace(/^db-/, "");
  const out = flag("--output");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(plan.sarif?.[language] ?? { version: "2.1.0", runs: [{ tool: { driver: { name: "CodeQL" } }, results: [] }] }));
  done();
} else {
  process.stderr.write(`fake-codeql: unexpected ${argv.join(" ")}\n`);
  done(64);
}
