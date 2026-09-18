/**
 * X2 (task 10.65) — render: build without chromium.
 *
 * With `PLAYWRIGHT_BROWSERS_PATH` pointed at an empty directory, a markdown deck
 * with **no** mermaid never needs a browser to parse or render, so `build` must
 * write the HTML, print `check skipped: chromium missing (npx playwright install
 * chromium)` and exit 0 — but under `--strict` the unrunnable check fails the
 * build (non-zero).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

const MD = `# Notes

A browser-free deck.

- one
- two
`;

function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8", env });
}

describe("X2 build without chromium", () => {
  it("writes the html and skips check; --strict fails the build", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-render-x2-"));
    writeFileSync(join(dir, "notes.md"), MD);
    const emptyBrowsers = mkdtempSync(join(tmpdir(), "deck3d-render-x2-browsers-"));
    const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: emptyBrowsers };

    const build = runCli(["build", "notes.md", "-o", "notes.html"], dir, env);
    expect(build.status, build.stderr).toBe(0);
    expect(existsSync(join(dir, "notes.html"))).toBe(true);
    expect(build.stderr).toContain("chromium missing");
    expect(build.stderr).toContain("npx playwright install chromium");
    expect(build.stderr).toContain("check skipped: chromium missing (npx playwright install chromium)");

    const strict = runCli(["build", "notes.md", "-o", "notes-strict.html", "--strict"], dir, env);
    expect(strict.status, strict.stderr).not.toBe(0);
    expect(strict.stderr).toContain("npx playwright install chromium");
  }, 60_000);
});
