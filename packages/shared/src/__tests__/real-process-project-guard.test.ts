/**
 * Repo-level invariant for the real-process vitest phase (change:
 * isolate-real-process-tests, D2).
 *
 * Server tests that spawn a REAL operating-system process under test (a
 * keeper, a mock-pi, a bin wrapper, a signal-forwarding CLI, a full server)
 * must not run inside the saturated parallel unit run — they starve and fail
 * on timing, never on the diff under test. They are collected by
 * `packages/server/vitest.real-process.config.ts`, which runs AFTER the
 * parallel projects with `maxWorkers: 2`.
 *
 * `packages/server/vitest.real-process-files.ts` is the single source of
 * truth: the real-process config `include`s it, the main server config
 * `exclude`s it. This lint locks:
 *
 *   (a) every listed file exists;
 *   (b) the main server project excludes exactly the list (one source of
 *       truth — no hand-copied second list), so the two projects are disjoint
 *       and every test still runs exactly once;
 *   (c) every server test matching the spawn predicate is listed, unless it
 *       carries `// real-process-exempt: <reason>` (same opt-out shape as the
 *       `no-direct-*` lints);
 *   (d) no vitest config other than the real-process one sets `retry:` —
 *       retries are scoped to that one project, CI-only, on purpose.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "..", "..", "..", "..");
const SERVER_DIR = path.join(REPO_ROOT, "packages", "server");
const LIST_FILE = path.join(SERVER_DIR, "vitest.real-process-files.ts");
const MAIN_CONFIG = path.join(SERVER_DIR, "vitest.config.ts");
const REAL_PROCESS_CONFIG = path.join(SERVER_DIR, "vitest.real-process.config.ts");

/**
 * The spawn predicate. A server test is a real-process test when it
 * value-imports a long-lived spawner (`spawn` / `spawnSync` / `fork`) from
 * `node:child_process`, or drives one of the repo's real-process helpers.
 *
 * `execSync` / `execFileSync` / `execFile` are deliberately NOT in the
 * predicate. Not because they are all synchronous (`execFile` is not), but
 * because the ~14 git and file-render tests that use them run a short CLI for
 * its OUTPUT and never observe a process under test through the process table,
 * a socket, or a log file — the thing that needs an idle machine.
 */
const NAMED_SPAWN_IMPORT_RE =
  /^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"node:child_process"/m;
/** `import * as childProcess from "node:child_process"` — captures the alias. */
const NAMESPACE_IMPORT_RE =
  /^import\s+\*\s+as\s+(\w+)\s+from\s+"node:child_process"/m;
const SPAWNERS = ["spawn", "spawnSync", "fork"];
const HELPER_RE = /\b(?:spawnKeeper|bootRealServer)\s*\(/;

/** Per-file opt-out marker: `// real-process-exempt: <reason>`. */
const OPT_OUT_RE = /real-process-exempt:\s*\S/;

function isRealProcessTest(source: string): boolean {
  const m = source.match(NAMED_SPAWN_IMPORT_RE);
  if (m) {
    const named = m[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      // `type ChildProcess` inside a value import is a type-only specifier.
      .filter((s) => !s.startsWith("type "))
      .map((s) => s.split(/\s+as\s+/)[0].trim());
    if (named.some((n) => SPAWNERS.includes(n))) return true;
  }
  // A namespace import only counts when a SPAWNER is actually called through
  // the alias — the ~8 files that namespace-import for `execSync` alone stay
  // out, same boundary as the named-import branch.
  const ns = source.match(NAMESPACE_IMPORT_RE);
  if (ns) {
    const alias = ns[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${alias}\\.(?:${SPAWNERS.join("|")})\\s*\\(`).test(source)) return true;
  }
  return HELPER_RE.test(source);
}

/** Every `packages/server/src/**​/__tests__/**​/*.test.ts`, server-relative. */
function serverTestFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      serverTestFiles(full, acc);
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      const rel = path.relative(SERVER_DIR, full).replace(/\\/g, "/");
      if (/^src\/.*__tests__\/.*\.test\.ts$/.test(rel)) acc.push(rel);
    }
  }
  return acc;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);

/** Every `vitest*.config.ts` in the tree. */
function vitestConfigs(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) vitestConfigs(full, acc);
    else if (/^vitest\..*config\.ts$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** Parse the exported string array out of the list module (text, not import). */
function readList(): string[] {
  const src = fs.readFileSync(LIST_FILE, "utf-8");
  const m = src.match(/REAL_PROCESS_TESTS[^=]*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error(`REAL_PROCESS_TESTS array not found in ${LIST_FILE}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("real-process vitest project guard", () => {
  it("(a) every listed file exists", () => {
    const missing = readList().filter(
      (rel) => !fs.existsSync(path.join(SERVER_DIR, rel)),
    );
    expect(
      missing,
      `vitest.real-process-files.ts lists files that do not exist:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("(b) the main server project excludes exactly the list (one source of truth)", () => {
    const main = fs.readFileSync(MAIN_CONFIG, "utf-8");
    expect(
      /from\s+"\.\/vitest\.real-process-files(?:\.js)?"/.test(main),
      "packages/server/vitest.config.ts must import REAL_PROCESS_TESTS from ./vitest.real-process-files",
    ).toBe(true);
    const excludeBlock = main.match(/exclude:\s*\[([\s\S]*?)\]/);
    expect(
      excludeBlock?.[1].includes("REAL_PROCESS_TESTS"),
      "packages/server/vitest.config.ts must set `exclude` from REAL_PROCESS_TESTS, not a hand-copied list",
    ).toBe(true);

    // A server-test path excluded here but NOT in REAL_PROCESS_TESTS would run
    // in NEITHER phase (the real-process project includes only the list), which
    // silently drops a test while both configs still look well-formed.
    const stray = [...(excludeBlock?.[1] ?? "").matchAll(/"([^"]+)"/g)]
      .map((x) => x[1])
      .filter((p) => /^src\/.*\.test\.ts$/.test(p) && !readList().includes(p));
    expect(
      stray,
      "these server tests are excluded from the main project but not in " +
        "REAL_PROCESS_TESTS, so they run in neither phase:\n  " + stray.join("\n  "),
    ).toEqual([]);

    const realCfg = fs.readFileSync(REAL_PROCESS_CONFIG, "utf-8");
    expect(
      /include:\s*\[?\s*\.{0,3}\s*REAL_PROCESS_TESTS/.test(realCfg),
      "packages/server/vitest.real-process.config.ts must `include` REAL_PROCESS_TESTS",
    ).toBe(true);

    // Disjointness follows only if every listed file would otherwise be
    // collected by the main include glob — i.e. the exclude is load-bearing.
    const collected = new Set(serverTestFiles(path.join(SERVER_DIR, "src")));
    const notCollected = readList().filter((rel) => !collected.has(rel));
    expect(
      notCollected,
      "listed files are outside the main include glob, so the exclude is dead:\n  " +
        notCollected.join("\n  "),
    ).toEqual([]);
  });

  it("(c) every server test that spawns a real process is listed or exempt", () => {
    const listed = new Set(readList());
    const offenders: string[] = [];
    for (const rel of serverTestFiles(path.join(SERVER_DIR, "src"))) {
      if (listed.has(rel)) continue;
      const source = fs.readFileSync(path.join(SERVER_DIR, rel), "utf-8");
      if (!isRealProcessTest(source)) continue;
      if (OPT_OUT_RE.test(source)) continue;
      offenders.push(rel);
    }
    expect(
      offenders,
      "these server tests spawn a real process but run in the parallel unit " +
        "project, where they starve. Add them to " +
        "packages/server/vitest.real-process-files.ts, or annotate the call " +
        "with `// real-process-exempt: <reason>`:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("(d) only the real-process config configures retries", () => {
    const offenders = vitestConfigs(REPO_ROOT)
      .filter((f) => path.resolve(f) !== path.resolve(REAL_PROCESS_CONFIG))
      .filter((f) => /(^|\s)retry:/m.test(fs.readFileSync(f, "utf-8")))
      .map((f) => path.relative(REPO_ROOT, f));

    expect(
      offenders,
      "retries are scoped to the real-process project only (CI-only, reported). " +
        "Remove `retry:` from:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });
});
