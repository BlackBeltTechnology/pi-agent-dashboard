/**
 * Repo-level invariant: `process.kill(...)` MUST NOT be called directly
 * outside `packages/shared/src/platform/`. All termination / liveness must
 * go through the platform helpers (`isProcessAlive`, `killProcess`,
 * `killPidWithGroup`) so that Windows tree-kill (taskkill /F /T /PID) and
 * POSIX process-group semantics are applied uniformly.
 *
 * If this test fails, migrate the offending file's call to:
 *   import { isProcessAlive, killProcess, killPidWithGroup }
 *     from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
 *
 * See change: route-kill-paths-through-platform.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

/** Files or directories allowed to call `process.kill(...)` directly. */
const ALLOWLIST_DIRS: readonly string[] = [
  "packages/shared/src/platform",
];

/**
 * Regex catches any textual reference to `process.kill(...)`. We match on
 * whole-word `process` to avoid flagging `childProcess.kill(...)`, which
 * is the `ChildProcess#kill()` instance method, not the global
 * `process.kill`. Calls on `ChildProcess` instances are banned separately
 * via code review / type-guided refactors, not this lint.
 */
const PROCESS_KILL_RE = /(?:^|[^.\w])process\.kill\s*\(/;

/**
 * Per-line opt-out marker. Use for embedded scripts that run in a
 * separate Node process (e.g. the `node -e` orchestrator string in
 * restart-helper.ts):
 *   const orchestrator = `process.kill(pid, 0);` // ban:process-kill-ok
 */
const OPT_OUT_MARKER = "ban:process-kill-ok";

/** Recursively walk a directory, yielding all .ts / .tsx files. */
async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
      yield* walk(full);
    } else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      yield full;
    }
  }
}

describe("no direct process.kill outside packages/shared/src/platform/", () => {
  it("only allowlisted paths call process.kill directly", async () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "..", "..", "..", "..");
    const packagesDir = path.resolve(repoRoot, "packages");

    const violations: Array<{ file: string; line: number; text: string }> = [];
    const allowPrefixes = ALLOWLIST_DIRS.map((p) =>
      path.resolve(repoRoot, p).replace(/\\/g, "/") + "/",
    );

    for (const pkg of await fs.readdir(packagesDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const srcDir = path.join(packagesDir, pkg.name, "src");
      try {
        await fs.access(srcDir);
      } catch {
        continue;
      }
      for await (const file of walk(srcDir)) {
        const normalized = file.replace(/\\/g, "/");
        if (allowPrefixes.some((prefix) => normalized.startsWith(prefix))) continue;

        const content = await fs.readFile(file, "utf-8");
        const lines = content.split(/\r?\n/);
        lines.forEach((line, idx) => {
          if (!PROCESS_KILL_RE.test(line)) return;
          if (line.includes(OPT_OUT_MARKER)) return;
          violations.push({
            file: path.relative(repoRoot, file),
            line: idx + 1,
            text: line.trim(),
          });
        });
      }
    }

    if (violations.length > 0) {
      const msg =
        `Direct process.kill(...) calls found outside packages/shared/src/platform/.\n` +
        `Migrate each to a platform helper:\n` +
        `  import { isProcessAlive, killProcess, killPidWithGroup }\n` +
        `    from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";\n\n` +
        `Offenders (${violations.length}):\n` +
        violations
          .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
          .join("\n");
      expect(violations, msg).toEqual([]);
    }
  });
});

/**
 * The shared session terminator signals ONLY through the platform helpers
 * (`killProcess` to signal, `signalZero` to probe) — test-plan #E36.
 *
 * @structural-pin import-graph lint: session-terminator.ts must signal only via platform helpers; absence of a direct process.kill is the contract
 *
 * See change: fix-session-reclaim-tmux.
 */
describe("session-terminator signals only via platform helpers", () => {
  it("has no direct process.kill and imports killProcess + signalZero from platform/process.js", async () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const file = path.resolve(here, "..", "..", "..", "server", "src", "spawn-process", "session-terminator.ts");
    const content = await fs.readFile(file, "utf-8");
    expect(content.split(/\r?\n/).filter((l) => PROCESS_KILL_RE.test(l) && !l.includes(OPT_OUT_MARKER))).toEqual([]);
    expect(content).toMatch(/killProcess as defaultKillProcess/);
    expect(content).toMatch(/signalZero as defaultSignalZero/);
    expect(content).toContain("@blackbelt-technology/pi-dashboard-shared/platform/process.js");
  });
});
