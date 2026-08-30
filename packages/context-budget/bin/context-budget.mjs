#!/usr/bin/env node
/**
 * context-budget — measure the per-turn context cost of a pi session.
 *
 *   context-budget measure [-o file] [--drop a,b]   run pi headless, capture, report
 *   context-budget report <file>                    re-print a capture
 *   context-budget diff <before> <after> [--expect-removed a,b]
 *
 * `measure` spawns a real headless pi turn with the meter extension attached,
 * so the numbers come from an actual provider request rather than a model of one.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const meter = resolve(here, "../src/meter.ts");

const argv = process.argv.slice(2);
const cmd = argv[0] ?? "measure";

function flag(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const load = (f) => {
  if (!existsSync(f)) {
    console.error(`no such capture: ${f}`);
    process.exit(2);
  }
  const parsed = JSON.parse(readFileSync(f, "utf8"));
  return parsed.breakdown ?? parsed;
};

// Prefer the built output; fall back to source for tsx/pi-loaded contexts.
// `dist/` is gitignored and only produced by `prepublishOnly`, so both specifiers
// are computed at runtime — a literal "../dist/index.js" would read as a dangling
// relative import to the publish-correctness checker, which packs an unbuilt tree.
const distEntry = pathToFileURL(resolve(here, "../dist/index.js")).href;
const srcEntry = pathToFileURL(resolve(here, "../src/index.ts")).href;
const lib = await import(distEntry).catch(async () => {
  try {
    return await import(srcEntry);
  } catch {
    console.error("context-budget: no build found — run `npm run build --workspace=@blackbelt-technology/pi-dashboard-context-budget`");
    process.exit(1);
  }
});

if (cmd === "measure") {
  const out = resolve(flag("-o", flag("--out", "./context-budget.json")));
  const drop = flag("--drop", "");
  // stderr is PIPED, never inherited: pi's dashboard bridge keeps an inherited
  // stderr open after the turn ends, which hangs the CLI forever. The timeout is
  // a second belt — the capture is written the moment the request is built, so a
  // late-exiting pi must not block the report.
  const res = spawnSync("pi", ["-e", meter, "-p", "reply with the single word: ok"], {
    stdio: ["ignore", "ignore", "pipe"],
    timeout: Number(process.env.CONTEXT_BUDGET_TIMEOUT_MS ?? 180_000),
    env: { ...process.env, CONTEXT_BUDGET_OUT: out, CONTEXT_BUDGET_DROP: drop },
  });
  if (res.error && !existsSync(out)) {
    console.error(`failed to run pi: ${res.error.message}`);
    if (res.stderr?.length) console.error(String(res.stderr).slice(-2000));
    process.exit(1);
  }
  if (!existsSync(out)) {
    console.error("pi ran but no payload was captured — did the request reach the provider?");
    if (res.stderr?.length) console.error(String(res.stderr).slice(-2000));
    process.exit(1);
  }
  console.log(lib.formatReport(load(out)));
  console.log(`\ncapture: ${out}`);
} else if (cmd === "report") {
  console.log(lib.formatReport(load(resolve(argv[1]))));
} else if (cmd === "diff") {
  const expect = flag("--expect-removed", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const delta = lib.comparePayloads(load(resolve(argv[1])), load(resolve(argv[2])), { expectRemoved: expect });
  console.log(lib.formatDelta(delta));
  if (delta.unmetExpectations.length) process.exit(1);
} else {
  console.error(`unknown command: ${cmd}`);
  process.exit(2);
}
