/**
 * Repo-lint: forbid `path.dirname(path.dirname(...getBundledNodePath...))`
 * in any source file under `packages/electron/src/`.
 *
 * The dirname-chain pattern is POSIX-only (<res>/node/bin/node → <res>/node)
 * and silently resolves to <res> on Windows where the bundled-Node layout is
 * one segment shallower (<res>/node/node.exe). When the result is passed to
 * pickNodeForServer, it looks for <res>/node.exe, doesn't find it, and falls
 * back to execpath-fallback with ELECTRON_RUN_AS_NODE=1 — a regression that
 * shipped once already.
 *
 * The correct helper is `getBundledNodeDir()` from `bundled-node.ts`, which
 * encapsulates the per-platform layout difference.
 *
 * See change: fix-electron-launch-source-bundled-node-dir.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, "..");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, acc);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

// Matches `path.dirname(...path.dirname(...getBundledNodePath...))` with
// arbitrary whitespace, on a single line OR across up to ~3 lines (we
// collapse newlines for scanning). Tolerates intermediate variables only
// if they appear inside the same dirname-chain expression — the lint is
// intentionally narrow so it only flags the actual anti-pattern.
const FORBIDDEN_RE =
  /path\.dirname\s*\([^()]*path\.dirname\s*\([^()]*getBundledNodePath\s*\(\s*\)\s*[^()]*\)\s*[^()]*\)/;

describe("no-dirname-chain-on-bundled-node-path", () => {
  it("no source file chains path.dirname twice around getBundledNodePath()", () => {
    const files = walk(SRC_ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      // Skip the helper file that documents the anti-pattern in its jsdoc.
      if (f.endsWith(path.join("lib", "bundled-node.ts"))) continue;
      const raw = readFileSync(f, "utf-8");
      // Strip line comments to avoid false positives in commentary that
      // references the anti-pattern (e.g. the launch-source warning comment).
      const stripped = raw
        .replace(/\/\/.*$/gm, "")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      // Collapse whitespace+newlines for cross-line matches.
      const flat = stripped.replace(/\s+/g, " ");
      if (FORBIDDEN_RE.test(flat)) {
        // Find original line for a helpful error.
        const lines = raw.split("\n");
        const idx = lines.findIndex((l) => /getBundledNodePath/.test(l));
        offenders.push(
          `${path.relative(SRC_ROOT, f)}:${idx + 1}\n  ${lines[idx]?.trim() ?? "<unknown>"}`,
        );
      }
    }
    expect(
      offenders,
      [
        "Found path.dirname(path.dirname(getBundledNodePath())) — forbidden.",
        "Use getBundledNodeDir() from bundled-node.ts instead.",
        "Windows layout is one segment shallower than POSIX, so the dirname-chain silently resolves to <resources> on Windows.",
        "Offenders:",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });
});
