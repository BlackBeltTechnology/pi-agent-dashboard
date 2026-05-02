/**
 * Repo-level invariant: build-time scripts (CI workflows, Dockerfiles,
 * shell scripts, root-level CJS helpers) MUST NOT hardcode
 * `node_modules/electron` or `node_modules/node-pty` paths. Instead, they
 * MUST resolve through the tool registry — either via the shared shell
 * wrapper at `packages/shared/bin/pi-dashboard-resolve-tool.cjs`, or
 * (for postinstall paths that run before the shared package is built)
 * via `require.resolve("<pkg>/package.json")` matching the registry's
 * `bare-import` strategy semantics.
 *
 * This invariant exists because npm workspace hoisting moves these
 * packages between `packages/<workspace>/node_modules/<pkg>/` (nested)
 * and `<repoRoot>/node_modules/<pkg>/` (hoisted) depending on the
 * workspaces config and npm version. The v0.4.0 release crisis was
 * caused exactly by this: `cd packages/electron/node_modules/electron`
 * stopped working after `f51e352` switched workspace cross-refs to
 * plain semver.
 *
 * If this test fails, replace the offending substring with one of:
 *
 *   # Shell / YAML / Dockerfile (build-time, has access to repo source):
 *   ELECTRON_DIR=$(node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron)
 *   cd "$ELECTRON_DIR" && ...
 *
 *   # CJS root postinstall (runs DURING npm install — must inline):
 *   const ptyPkg = require.resolve("node-pty/package.json");
 *   const prebuildsDir = path.join(path.dirname(ptyPkg), "prebuilds");
 *
 * See change: register-build-time-tools.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

/** Banned substrings (after comment-stripping). */
const PATTERNS: readonly { re: RegExp; suggestion: string }[] = [
  {
    re: /node_modules\/electron(?:\/|\b)/,
    suggestion:
      "Use `node packages/shared/bin/pi-dashboard-resolve-tool.cjs electron`",
  },
  {
    re: /node_modules\/node-pty(?:\/|\b)/,
    suggestion:
      'Use `require.resolve("node-pty/package.json")` (mirrors the registry\'s bare-import strategy)',
  },
];

/**
 * Files explicitly allowed to contain the banned substrings. Each entry
 * is a repo-relative path matched exactly. Add an entry only when the
 * substring appears as a non-path token (e.g. an argument to
 * `require.resolve`, a comment quoting an example, or this lint file
 * itself). Document the reason inline.
 */
const ALLOWLIST: readonly string[] = [
  // The lint file itself contains every banned substring as test data.
  "packages/shared/src/__tests__/no-hardcoded-node-modules-paths.test.ts",
  // Root postinstall — uses `require.resolve("node-pty/package.json")`,
  // which contains "node-pty" as an argument string but not as a
  // hardcoded path. Allowlisted because it must run before the shared
  // package is unpacked. See file header for full reasoning.
  "scripts/fix-pty-permissions.cjs",
  // Sister postinstall script (workspace-scoped) — same rationale.
  "packages/server/scripts/fix-pty-permissions.cjs",
];

/**
 * Repo-relative file list to scan.
 *
 * The scope is intentionally narrow: only the build-time sites that the
 * `register-build-time-tools` change migrated, plus the postinstall
 * scripts that mirror the registry's `bare-import` semantics. Bundle /
 * Docker entrypoint scripts (`bundle-server.mjs`, `docker-make.sh`,
 * `test-electron-install-inner.sh`, etc.) are NOT in scope: those
 * operate on a known WORKDIR with deterministic node_modules layout
 * inside the build image and are not affected by host-side hoisting.
 */
const SCAN_FILES: readonly string[] = [
  ".github/workflows/publish.yml",
  ".github/workflows/ci.yml",
  "packages/electron/scripts/Dockerfile.build",
  "scripts/fix-pty-permissions.cjs",
  "packages/server/scripts/fix-pty-permissions.cjs",
];

interface Violation {
  file: string;
  line: number;
  col: number;
  text: string;
  suggestion: string;
}

/**
 * Strip a single line's trailing comment for YAML / shell / JS-style
 * line comments. Preserves substring matches inside strings as actual
 * content (we don't try to parse string literals — keeping it simple).
 *
 * Specifically:
 *   - `# ...` (YAML, shell): everything from a `#` not preceded by a
 *     non-space alphanumeric is dropped. Matches GitHub Actions /
 *     bash conventions.
 *   - `// ...` (JS): everything from `//` to end of line is dropped.
 *
 * This is intentionally simple. False positives only matter if a banned
 * pattern appears INSIDE a string literal (which would still be the
 * bug we want to catch); false negatives only matter for inline
 * comments (`echo foo  # comment node_modules/electron`), which we
 * exclude correctly.
 */
function stripLineComment(line: string): string {
  // JS-style first.
  const jsIdx = line.indexOf("//");
  if (jsIdx >= 0) line = line.slice(0, jsIdx);
  // Shell/YAML `#` — only when preceded by whitespace or start-of-line.
  const hashMatch = line.match(/(^|\s)#/);
  if (hashMatch && typeof hashMatch.index === "number") {
    line = line.slice(0, hashMatch.index);
  }
  return line;
}

describe("no hardcoded node_modules/<dep> paths in build-time files", () => {
  it("only allowlisted files reference node_modules/electron or node_modules/node-pty", () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "..", "..", "..", "..");

    const violations: Violation[] = [];
    const allowSet = new Set(
      ALLOWLIST.map((p) => path.resolve(repoRoot, p).replace(/\\/g, "/")),
    );

    for (const rel of SCAN_FILES) {
      const file = path.resolve(repoRoot, rel);
      if (!fs.existsSync(file)) continue;
      const normalized = file.replace(/\\/g, "/");
      if (allowSet.has(normalized)) continue;

      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split(/\r?\n/);

      lines.forEach((rawLine, idx) => {
        const stripped = stripLineComment(rawLine);
        for (const { re, suggestion } of PATTERNS) {
          const m = stripped.match(re);
          if (!m) continue;
          const col = rawLine.indexOf(m[0]);
          violations.push({
            file: path.relative(repoRoot, file),
            line: idx + 1,
            col: col >= 0 ? col + 1 : 1,
            text: rawLine.trim(),
            suggestion,
          });
        }
      });
    }

    if (violations.length > 0) {
      const msg =
        `Hardcoded \`node_modules/<dep>\` path(s) found in build-time files.\n` +
        `These break under npm workspace hoisting changes (see v0.4.0 release crisis).\n` +
        `Use the tool registry instead. See change: register-build-time-tools.\n\n` +
        `Offenders (${violations.length}):\n` +
        violations
          .map(
            (v) =>
              `  ${v.file}:${v.line}:${v.col}  ${v.text}\n      → ${v.suggestion}`,
          )
          .join("\n");
      expect(violations, msg).toEqual([]);
    }
  });
});
