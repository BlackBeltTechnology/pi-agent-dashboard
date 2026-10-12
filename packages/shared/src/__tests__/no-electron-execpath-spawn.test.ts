/**
 * Repo-lint: Electron callers of launchDashboardServer must pass an
 * explicit `nodeBin:` OR set `ELECTRON_RUN_AS_NODE` in the env, so the
 * spawned process uses a real Node binary instead of the Electron GUI
 * binary (which silently re-launches the app and exits on the
 * single-instance lock).
 *
 * Also enforces that only `pick-node.ts` may reference `process.execPath`
 * inside `packages/electron/src/lib/**`.
 *
 * See design D4 in openspec/changes/fix-electron-server-launch-node-bin/design.md.
 */

import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The only file in packages/electron/src/lib/ that may reference
 * process.execPath directly (it wraps the value inside PickNodeInput
 * and passes it through rather than using it as a Node binary itself).
 */
const EXECPATH_ALLOWLIST = new Set(["pick-node.ts"]);

/** Walk .ts/.tsx files, excluding node_modules, dist, and __tests__. */
async function* walk(dir: string): AsyncGenerator<string> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", "__tests__"].includes(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      yield full;
    }
  }
}

describe("no-electron-execpath-spawn", () => {
  it("launchDashboardServer calls in electron/lib include nodeBin or ELECTRON_RUN_AS_NODE", async () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "..", "..", "..", "..");
    const electronLibDir = path.join(repoRoot, "packages", "electron", "src", "lib");

    const violations: Array<{ file: string; line: number; text: string }> = [];

    for await (const file of walk(electronLibDir)) {
      const content = await fs.readFile(file, "utf-8");
      // Find all launchDashboardServer call sites. We look for the function
      // name on a line, then scan forward for the matching closing paren to
      // extract the options object text.
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!line.includes("launchDashboardServer(")) continue;

        // Collect the call body: from this line to the matching closing paren.
        let depth = 0;
        let body = "";
        for (let j = i; j < lines.length; j++) {
          const l = lines[j]!;
          body += l + "\n";
          for (const ch of l) {
            if (ch === "(") depth++;
            else if (ch === ")") depth--;
          }
          if (depth === 0 && body.includes("launchDashboardServer(")) break;
        }

        const hasNodeBin = /\bnodeBin\s*:/.test(body);
        const hasElectronRunAsNode = /ELECTRON_RUN_AS_NODE/.test(body);

        if (!hasNodeBin && !hasElectronRunAsNode) {
          violations.push({
            file: path.relative(repoRoot, file),
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }

    if (violations.length > 0) {
      const msg =
        `launchDashboardServer() called from Electron lib without nodeBin: or ELECTRON_RUN_AS_NODE.\n` +
        `In Electron, process.execPath is the GUI binary — spawning it without ELECTRON_RUN_AS_NODE=1\n` +
        `re-launches the app, hits the single-instance lock, and exits silently.\n\n` +
        `Fix: call pickNodeForServer() and pass nodeBin: pick.nodeBin.\n` +
        `See design D4: openspec/changes/fix-electron-server-launch-node-bin/design.md\n\n` +
        `Offenders (${violations.length}):\n` +
        violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join("\n");
      expect(violations, msg).toHaveLength(0);
    }
  });

  it("process.execPath not used directly as a node binary in electron/lib (outside pick-node.ts)", async () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "..", "..", "..", "..");
    const electronLibDir = path.join(repoRoot, "packages", "electron", "src", "lib");

    // Pattern: process.execPath used as a binary path assignment (not as a
    // processExecPath: injection key which is the permitted picker-call pattern).
    //   Flagged:   nodeBin = ... ?? process.execPath
    //   Flagged:   nodeBin: process.execPath
    //   Allowed:   processExecPath: process.execPath   (picker input)
    //   Allowed:   string interpolation / log messages
    const BINARY_EXECPATH_RE = /(?:nodeBin|cmd|bin)\s*(?:=|:)[^,;\n]*\bprocess\.execPath\b|\?\?\s*process\.execPath/;
    // Safe patterns that should not be flagged even if they match above
    const SAFE_RE = /processExecPath\s*:\s*process\.execPath/;

    const violations: Array<{ file: string; line: number; text: string }> = [];

    for await (const file of walk(electronLibDir)) {
      const basename = path.basename(file);
      if (EXECPATH_ALLOWLIST.has(basename)) continue;

      const content = await fs.readFile(file, "utf-8");
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (BINARY_EXECPATH_RE.test(line) && !SAFE_RE.test(line)) {
          violations.push({
            file: path.relative(repoRoot, file),
            line: i + 1,
            text: line.trim(),
          });
        }
      }
    }

    if (violations.length > 0) {
      const msg =
        `process.execPath used directly as a Node binary in packages/electron/src/lib.\n` +
        `In Electron main, process.execPath is the GUI binary, not a Node interpreter.\n` +
        `Use pickNodeForServer() from pick-node.ts to select the correct binary.\n\n` +
        `Allowed file: ${[...EXECPATH_ALLOWLIST].join(", ")}\n` +
        `Allowed pattern: processExecPath: process.execPath (picker injection)\n\n` +
        `Offenders (${violations.length}):\n` +
        violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join("\n");
      expect(violations, msg).toHaveLength(0);
    }
  });
});
