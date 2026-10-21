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
 *   { argv, env: { LGTM_INDEX_FILTERS }, sourceRoot?: { "<relpath>": "<content>" },
 *     modelPack?: { "<file>": "<content>" } }   // the --additional-packs dir, at call time
 *
 * `resolve extensions` (plan.resolveExtensions: { exit, stderr, stdout, rowCountDelta, omitFile }) answers
 * with the CAPTURED real-CLI shape (fixtures/codeql-resolve-extensions.json): one entry per
 * (predicate, model file) with `rowCount` = the file's real data rows, so a test can break it on purpose.
 *
 * See change: add-local-codeql-ratchet.
 */
import { appendFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";

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

/** The captured `resolve extensions` JSON with this pack's model files substituted for the placeholder. */
function resolveExtensions(opts) {
  const template = JSON.parse(readFileSync(join(import.meta.dirname, "codeql-resolve-extensions.json"), "utf8"));
  const [queryPackDir, entries] = Object.entries(template.data)[0];
  const shape = entries.find((e) => e.file === "<MODEL_FILE>");
  const packDir = flag("--additional-packs");
  const out = entries.filter((e) => e.file !== "<MODEL_FILE>");
  let index = 0;
  for (const name of packDir ? readdirSync(packDir).filter((n) => n.endsWith(".model.yml")).sort() : []) {
    if (name === opts.omitFile) continue;
    const doc = parseYaml(readFileSync(join(packDir, name), "utf8"));
    for (const ext of doc?.extensions ?? []) {
      const rows = ext.data?.length ?? 0;
      out.push({ ...shape, predicate: ext.addsTo.extensible, file: join(packDir, name), index: index++, rowCount: rows + (opts.rowCountDelta ?? 0) });
    }
  }
  return JSON.stringify({ ...template, data: { [queryPackDir]: out } });
}

const [cmd, sub] = argv;
if (cmd === "resolve" && sub === "extensions") {
  const opts = plan.resolveExtensions ?? {};
  if (opts.exit) {
    process.stderr.write(`${opts.stderr ?? "resolve extensions failed"}\n`);
    done(opts.exit);
  }
  record.modelPack = flag("--additional-packs") ? listFiles(flag("--additional-packs")) : null;
  process.stdout.write(opts.stdout ?? resolveExtensions(opts));
  done();
} else if (cmd === "version") {
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
  if (flag("--additional-packs")) record.modelPack = listFiles(flag("--additional-packs"));
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
