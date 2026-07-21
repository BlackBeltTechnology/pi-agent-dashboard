/**
 * Repo-lint — guards the immutable-bundle invariant from change:
 * eliminate-electron-runtime-install (Phase 7.4).
 *
 * Under R3, the Electron arm MUST NOT install, materialize, or otherwise
 * write into `~/.pi-dashboard/`. The only places that may still reference
 * the literal `.pi-dashboard` string are:
 *
 *   1. `packages/shared/src/legacy-managed-dir.ts` — the dedicated
 *      detection helper used by Doctor + server CLI to surface an
 *      advisory row pointing at the leftover directory.
 *   2. `packages/shared/src/managed-paths.ts` and the Electron mirror
 *      `packages/electron/src/lib/managed-paths.ts` — kept ONLY so the
 *      shared-doctor MANAGED_DIR check + standalone pi-core update path
 *      can probe the legacy install when a user previously installed pi
 *      there manually. Read-only / pi-core-update only; NOT used by any
 *      Electron startup or install code path.
 *   3. `packages/shared/src/platform/binary-lookup.ts`,
 *      `packages/shared/src/platform/managed-node-path.ts`,
 *      `packages/shared/src/tool-registry/strategies.ts` — fallback
 *      probes that READ `~/.pi-dashboard/node_modules/` for a managed pi
 *      install. Read-only.
 *   4. `packages/server/src/pi-core-updater.ts`,
 *      `packages/server/src/pi-core-checker.ts` — the `/api/pi-core/`
 *      endpoint (standalone arm only) writes managed pi here. Hidden in
 *      the Electron client UI per task 3.3.
 *   5. `packages/electron/src/lib/doctor.ts` — advisory `rm -rf` hint
 *      strings rendered from the detector output.
 *
 * Any NEW reference outside this allowlist must be questioned: it likely
 * means runtime install is creeping back into the Electron arm.
 *
 * The lint walks `packages/electron/src/lib/`, `packages/server/src/`,
 * and `packages/shared/src/` looking for the literal `.pi-dashboard`,
 * then asserts every match maps to an allowlisted file.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");

// Paths are relative to REPO_ROOT, forward-slash normalized.
// Each entry MUST be accompanied by a one-line rationale.
const ALLOWLIST: ReadonlySet<string> = new Set([
  // New module — only intentional consumer of the literal.
  "packages/shared/src/legacy-managed-dir.ts",
  // Read-only fallback probes for managed pi (standalone arm).
  "packages/shared/src/managed-paths.ts",
  "packages/shared/src/platform/binary-lookup.ts",
  "packages/shared/src/platform/managed-node-path.ts",
  "packages/shared/src/tool-registry/strategies.ts",
  "packages/shared/src/tool-registry/definitions.ts",
  "packages/shared/src/dashboard-paths.ts",
  // Shared doctor advisory text and section keys.
  "packages/shared/src/doctor-core.ts",
  // Comment-only ref (Windows-path example).
  "packages/shared/src/platform/node-spawn.ts",
  // pi-core update path (standalone arm only; client UI hidden on Electron).
  "packages/server/src/pi/pi-core-updater.ts",
  "packages/server/src/pi/pi-core-checker.ts",
  "packages/server/src/changelog/changelog-fs.ts",
  // Server CLI: advisory log line wired to legacy-managed-dir detector.
  "packages/server/src/cli.ts",
  // Node-version guard: advisory help-text only (suggests bundled PATH);
  // no read/write. See change: openspec-worktree-spawn-button.
  "packages/server/src/auth/node-guard.ts",
  // Doctor route: shared-doctor MANAGED_DIR forwarder.
  "packages/server/src/routes/doctor-routes.ts",
  // Electron Doctor: advisory row text + MANAGED_DIR consumer for shared checks.
  "packages/electron/src/lib/doctor.ts",
  "packages/electron/src/lib/doctor-bridge-contract.ts",
  "packages/electron/src/lib/managed-paths.ts",
  // pi-core update checker — standalone arm only; Electron UI hidden.
  "packages/electron/src/lib/update-checker.ts",
  // Wizard mode marker — collapsed under Phase 6.1 (one-step welcome).
  // Allowlisted pending the 6.1 collapse which migrates to ~/.pi/dashboard/.
  "packages/electron/src/lib/wizard-state.ts",
]);

const SCAN_ROOTS = [
  "packages/electron/src/lib",
  "packages/server/src",
  "packages/shared/src",
];

const SKIP_DIRS = new Set(["__tests__", "node_modules", "dist", "build", "test-support"]);

function* walk(dir: string): Generator<string> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      yield* walk(path.join(dir, e.name));
    } else if (e.isFile() && /\.(ts|tsx|mts|cts|mjs|cjs|js)$/.test(e.name)) {
      yield path.join(dir, e.name);
    }
  }
}

describe("no-managed-dir-reference lint", () => {
  it("only allowlisted files reference `.pi-dashboard`", () => {
    const offenders: string[] = [];

    for (const root of SCAN_ROOTS) {
      const absRoot = path.join(REPO_ROOT, root);
      if (!fs.existsSync(absRoot)) continue;
      for (const filePath of walk(absRoot)) {
        const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
        if (ALLOWLIST.has(rel)) continue;

        let content: string;
        try {
          content = fs.readFileSync(filePath, "utf-8");
        } catch {
          continue;
        }
        // Match the bare literal `.pi-dashboard`. The legacy-managed-dir
        // module splits the literal across a `+` so this regex won't hit
        // legitimate code there — but legacy-managed-dir is allowlisted
        // anyway.
        if (/\.pi-dashboard\b/.test(content)) {
          offenders.push(rel);
        }
      }
    }

    expect(offenders, `Non-allowlisted files reference ".pi-dashboard":\n  ${offenders.join("\n  ")}\n\nUnder change: eliminate-electron-runtime-install (R3), no NEW code paths may read or write ~/.pi-dashboard/. If this reference is legitimate (e.g. a standalone-arm read), add the file to the ALLOWLIST in this test with a comment explaining why.`).toEqual([]);
  });
});
