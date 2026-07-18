/**
 * Repo-level invariant: `process.platform === "<os>"` branches (and the
 * inverse `!==` form) MUST NOT appear outside the canonical platform
 * primitive locations. All OS-specific behaviour lives under
 * `packages/shared/src/platform/**` (and `packages/electron/src/platform/**`
 * for Electron-specific primitives) plus a small documented allowlist.
 *
 * If this test fails, either:
 *   (a) Move the platform-aware logic into a platform/* primitive that
 *       takes an optional `platform: NodeJS.Platform` parameter, OR
 *   (b) Add an opt-out marker `// platform-branch-ok` on the same line
 *       for a genuine, localised OS probe (e.g. a top-level env fingerprint).
 *
 * See change: consolidate-windows-spawn-and-platform-handlers.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

/**
 * Files / directory-prefixes where platform branches are allowed.
 *
 * Each entry is a repo-relative path using forward slashes. Entries
 * ending in `/` match any file under that directory (prefix match);
 * entries without a trailing slash must match exactly.
 *
 * Every entry has a one-line reason and a follow-up owner.
 */
const ALLOWLIST: readonly string[] = [
  // Canonical platform primitives — the whole POINT is platform branching.
  "packages/shared/src/platform/",
  // Electron-specific platform primitives.
  "packages/electron/src/platform/",

  // ── Seed allowlist (documented follow-ups, out of scope for this change)

  // Extension's pgid/ps scanner — platform-aware but uses `_platform` test
  // hooks rather than shared primitives; consolidating into
  // shared/platform/process-scan.ts is a separate change.
  "packages/extension/src/process-scanner.ts",

  // Electron dependency detection predates the tool-registry; migration
  // to ToolRegistry.resolve is a separate change.
  "packages/electron/src/lib/dependency-detector.ts",

  // Electron top-level bootstrap: process.platform printed in log output,
  // legitimate observability use.
  "packages/electron/src/main.ts",

  // Electron doctor: reports process.platform to the user.
  "packages/electron/src/lib/doctor.ts",

  // Electron forge config: build-time darwin special-case.
  "packages/electron/forge.config.ts",

  // Server process-manager: one domain branch in spawnHeadless picking
  // Unix "sh -c tail -f" wrapper vs Windows direct node.exe spawn.
  // The wrapper is genuinely Unix-only (sh+tail); splitting the headless
  // mechanism into two is tracked as a follow-up.
  "packages/server/src/spawn-process/process-manager.ts",

  // Boot-parent liveness primitive: genuinely OS-specific — live-ppid read
  // (Linux /proc/self/stat vs macOS `ps` vs Windows process.ppid) + the
  // win32-only koffi Tier-2 handle load. A platform primitive that happens
  // to live in the server package. See change: electron-attach-ownership-fixes.
  "packages/server/src/lifecycle/boot-parent-liveness.ts",

  // Server editor registry: selects per-OS process patterns from a data
  // table. Genuine data-lookup branching, benign.
  "packages/server/src/editor-registry.ts",

  // Server tunnel: surfaces process.platform in a response body.
  "packages/server/src/tunnel/tunnel.ts",

  // ngrok provider: per-OS ngrok.yml config-file location lookup (darwin
  // Application Support / win32 LOCALAPPDATA / XDG). Genuine data-lookup
  // branch like editor-registry.ts, benign. See change: add-tunnel-providers.
  "packages/server/src/tunnel-providers/ngrok.ts",

  // Server browse: returns process.platform in BrowseResult for the
  // client path-picker (protocol surface).
  "packages/server/src/browse.ts",

  // Client session-grouping: reads process.platform in a comment-only
  // doc reference and uses inferPlatform heuristic; no actual branch.
  "packages/client/src/lib/session/session-grouping.ts",

  // ── Follow-up: migrate to electron/src/platform/ per deferred
  // consolidate-platform-handlers (18→13 file refactor).

  // App menu: darwin detection for role:appMenu (Electron convention).
  "packages/electron/src/lib/app-menu.ts",
  // Bundled node: win32 binary name suffix; data-lookup branch.
  "packages/electron/src/lib/bundled-node.ts",
  // Server lifecycle: win32 managed-tsx.cmd + which/where probes.
  "packages/electron/src/lib/server-lifecycle.ts",
  // Tray icon: platform-specific asset selection; will move to
  // electron/src/platform/tray-icon.ts in deferred consolidation.
  "packages/electron/src/lib/tray.ts",

  // Server editor PID registry: per-OS process pattern matching for
  // orphan detection on boot. Genuine data-table branching.
  "packages/server/src/editor-pid-registry.ts",
  // Electron dependency installer: Windows npm is npm.cmd (batch wrapper);
  // spawn('npm') without .cmd extension fails ENOENT on Windows. The branch
  // routes around this by preferring bundled node+npm-cli.js on Windows.
  // Follow-up: migrate to a platform/exec npm-resolver primitive.
  "packages/electron/src/lib/dependency-installer.ts",
  // fix-pty-permissions: Windows short-circuit (no chmod needed).
  "packages/server/src/fix-pty-permissions.ts",
  // package-manager-wrapper: comment-only reference; no runtime branch.
  "packages/server/src/package/package-manager-wrapper.ts",
  // terminal-manager: win32 branch for node-pty spawnOptions; will move
  // to platform/terminal in deferred consolidation.
  "packages/server/src/terminal/terminal-manager.ts",
];

const PLATFORM_BRANCH_RE = /process\.platform\s*(===|!==)\s*["'](win32|linux|darwin)["']/;

const OPT_OUT_MARKER = "platform-branch-ok";

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

/** Check if a repo-relative normalised path is covered by the allowlist. */
function isAllowed(relPath: string, allow: readonly string[]): boolean {
  for (const entry of allow) {
    if (entry.endsWith("/")) {
      if (relPath.startsWith(entry)) return true;
    } else {
      if (relPath === entry) return true;
    }
  }
  return false;
}

describe("no direct process.platform branches outside platform/**", () => {
  it("only allowlisted files contain process.platform === \"<os>\" branches", async () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "..", "..", "..", "..");
    const packagesDir = path.resolve(repoRoot, "packages");

    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const pkg of await fs.readdir(packagesDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const srcDir = path.join(packagesDir, pkg.name, "src");
      try { await fs.access(srcDir); } catch { continue; }

      for await (const file of walk(srcDir)) {
        const relPath = path.relative(repoRoot, file).replace(/\\/g, "/");
        if (isAllowed(relPath, ALLOWLIST)) continue;

        const content = await fs.readFile(file, "utf-8");
        const lines = content.split(/\r?\n/);
        lines.forEach((line, idx) => {
          if (!PLATFORM_BRANCH_RE.test(line)) return;
          if (line.includes(OPT_OUT_MARKER)) return;
          violations.push({ file: relPath, line: idx + 1, text: line.trim() });
        });
      }
    }

    if (violations.length > 0) {
      const msg =
        `Direct process.platform branches found outside the allowlist.\n` +
        `Move the logic into a platform/* primitive or add a ` +
        `\`// ${OPT_OUT_MARKER}\` comment on the line with a justification.\n\n` +
        `Offenders (${violations.length}):\n` +
        violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join("\n");
      expect(violations, msg).toEqual([]);
    }
  });
});
