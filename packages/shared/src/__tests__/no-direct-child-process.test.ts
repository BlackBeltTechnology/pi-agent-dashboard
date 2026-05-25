/**
 * Repo-level invariant: `node:child_process` MUST NOT be imported directly
 * outside `packages/shared/src/platform/exec.ts` (and, once added,
 * `packages/shared/src/platform/runner.ts`). All subprocess execution goes
 * through the safe wrappers so `windowsHide: true` and other defaults are
 * uniform.
 *
 * If this test fails, migrate the offending file's import to:
 *   import { ... } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
 *
 * See change: platform-command-executor.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

/** Files allowed to import from node:child_process directly. */
const ALLOWLIST: readonly string[] = [
  "packages/shared/src/platform/exec.ts",
  "packages/shared/src/platform/runner.ts",
  // Platform primitives that legitimately own the raw child_process
  // APIs (Windows detached-spawn + cross-platform subprocess adapter).
  // See change: consolidate-windows-spawn-and-platform-handlers.
  "packages/shared/src/platform/detached-spawn.ts",
  "packages/shared/src/platform/subprocess-adapter.ts",
  // Legacy-pi cleanup needs a synchronous npm-root probe at server
  // startup; predates the platform/exec wrapper. See origin commit
  // ab711621 (feat(bootstrap): detect + one-click cleanup of legacy
  // @mariozechner/pi-coding-agent).
  "packages/server/src/legacy-pi-cleanup.ts",
  // The startup recovery HTTP server runs precisely when top-level
  // dependencies are missing (corrupted node_modules) — importing the
  // platform/exec wrapper there would defeat the recovery flow because
  // its transitive deps may be the very things that are missing. The
  // file's own header explicitly mandates: "Keep it dependency-free."
  // See change: add-startup-recovery-server (commit e606e8b0).
  "packages/server/src/recovery-server.ts",
];

/**
 * Regex catches any textual reference to the `node:child_process` module:
 *   - import X from "node:child_process"
 *   - import { X } from 'node:child_process'
 *   - require("node:child_process")
 *   - const X = await import("node:child_process")
 *
 * We intentionally match the `node:` prefix strictly — this codebase uses
 * ESM node-protocol imports everywhere, and the bare `child_process`
 * alias is already absent.
 */
const CHILD_PROCESS_IMPORT_RE = /(?:from\s+|require\s*\(\s*|import\s*\(\s*)["']node:child_process["']/;

/**
 * Per-line opt-out marker. Use for embedded scripts (e.g. `node -e` orchestrators
 * or Electron renderer bootstrap strings) where the `require("node:child_process")`
 * is source text that runs in a separate Node process, not an import by the
 * host module. Add this comment on the same line as the allowed usage:
 *   const { spawn } = require("node:child_process"); // ban:child_process-ok
 */
const OPT_OUT_MARKER = "ban:child_process-ok";

/** Recursively walk a directory, yielding all .ts / .tsx files. */
async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip nested node_modules, dist, and test directories
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
      yield* walk(full);
    } else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      yield full;
    }
  }
}

describe("no direct node:child_process imports outside platform/exec.ts", () => {
  it("only allowlisted files import node:child_process", async () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "..", "..", "..", "..");
    const packagesDir = path.resolve(repoRoot, "packages");

    const violations: Array<{ file: string; line: number; text: string }> = [];
    const allowSet = new Set(
      ALLOWLIST.map((p) => path.resolve(repoRoot, p).replace(/\\/g, "/")),
    );

    for (const pkg of await fs.readdir(packagesDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const srcDir = path.join(packagesDir, pkg.name, "src");
      try {
        await fs.access(srcDir);
      } catch {
        continue; // package has no src/
      }
      for await (const file of walk(srcDir)) {
        const normalized = file.replace(/\\/g, "/");
        if (allowSet.has(normalized)) continue;

        const content = await fs.readFile(file, "utf-8");
        const lines = content.split(/\r?\n/);
        lines.forEach((line, idx) => {
          if (!CHILD_PROCESS_IMPORT_RE.test(line)) return;
          if (line.includes(OPT_OUT_MARKER)) return;
          violations.push({ file: path.relative(repoRoot, file), line: idx + 1, text: line.trim() });
        });
      }
    }

    if (violations.length > 0) {
      const msg =
        `Direct node:child_process imports found outside the allowlist.\n` +
        `Migrate each to:\n` +
        `  import { ... } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";\n\n` +
        `Offenders (${violations.length}):\n` +
        violations
          .map((v) => `  ${v.file}:${v.line}  ${v.text}`)
          .join("\n");
      // Use a plain expect to surface the full diff in the test output.
      expect(violations, msg).toEqual([]);
    }
  });
});
