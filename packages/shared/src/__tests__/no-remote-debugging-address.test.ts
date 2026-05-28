/**
 * Repo-level invariant: nothing in `packages/electron/src/**` MAY call
 *   app.commandLine.appendSwitch("remote-debugging-address", ...)
 * (any quote style, any spacing). Chromium's CDP defaults to loopback
 * (127.0.0.1); appending `remote-debugging-address` would expose the
 * debug surface on the LAN, turning local automation into a remote RCE.
 *
 * This lint encodes Decision 3 of the proposal — the promiscuous-bind
 * escape hatch must not exist anywhere in the Electron sources.
 *
 * See change: ship-browser-skill-and-electron-cdp.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

/**
 * Matches any literal mention of the Chromium switch name, e.g.:
 *   appendSwitch("remote-debugging-address", "0.0.0.0")
 *   appendSwitch('remote-debugging-address', host)
 *   appendSwitch(`remote-debugging-address`, host)
 * The check intentionally flags any string occurrence — there is no
 * legitimate reason to mention this token in Electron source code.
 */
const FORBIDDEN_RE = /['"`]remote-debugging-address['"`]/;

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
      yield* walk(full);
    } else if (entry.isFile() && /\.(ts|tsx|mts|cts|js|cjs|mjs)$/.test(entry.name)) {
      yield full;
    }
  }
}

describe("no remote-debugging-address in packages/electron/src/", () => {
  it("never appends Chromium's promiscuous-bind switch", async () => {
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const repoRoot = path.resolve(here, "..", "..", "..", "..");
    const electronSrc = path.resolve(repoRoot, "packages", "electron", "src");

    const violations: Array<{ file: string; line: number; text: string }> = [];
    for await (const file of walk(electronSrc)) {
      const content = await fs.readFile(file, "utf-8");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (FORBIDDEN_RE.test(line)) {
          violations.push({
            file: path.relative(repoRoot, file),
            line: idx + 1,
            text: line.trim(),
          });
        }
      });
    }

    if (violations.length > 0) {
      const msg =
        `Forbidden literal "remote-debugging-address" found in Electron sources.\n` +
        `Chromium's CDP defaults to loopback (127.0.0.1); never bind to all interfaces.\n` +
        `If a user wants remote CDP, they can SSH-tunnel localhost:9222.\n\n` +
        `Offenders (${violations.length}):\n` +
        violations.map((v) => `  ${v.file}:${v.line}  ${v.text}`).join("\n");
      expect(violations, msg).toEqual([]);
    }
  });
});
