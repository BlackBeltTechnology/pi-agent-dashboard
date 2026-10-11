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
import { dirname, join } from "node:path";
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

/**
 * test-plan #X11 (change deck3d-pptx-import) — commands that decode or render
 * images need chromium and say how to install it; `pptx import` does not.
 */
describe("X11 art / variants / pptx import without chromium", () => {
  it("art trace and variants render exit non-zero with the install hint; pptx import exits 0", async () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-x11-"));
    const emptyBrowsers = mkdtempSync(join(tmpdir(), "deck3d-x11-browsers-"));
    const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: emptyBrowsers };
    const { solidPng, buildPptx, basicDeck } = await import("../../__tests__/helpers/pptx.js");
    writeFileSync(join(dir, "logo.png"), solidPng(8, 8, [0, 0, 0, 255]));
    const trace = runCli(["art", "trace", "logo.png"], dir, env);
    expect(trace.status).not.toBe(0);
    expect(trace.stderr).toContain("npx playwright install chromium");

    writeFileSync(join(dir, "deck.md"), MD);
    expect(runCli(["parse", "deck.md", "-o", "deck.json"], dir, env).status).toBe(0);
    writeFileSync(
      join(dir, "style.json"),
      JSON.stringify({ version: 1, steps: [{ id: "s", title: "s", question: "?", slides: ["notes"], round: 1, variants: [{ name: "A", label: "a", overrides: {} }, { name: "B", label: "b", overrides: {} }] }] }),
    );
    const variants = runCli(["variants", "render", "--step", "s"], dir, env);
    expect(variants.status).not.toBe(0);
    expect(variants.stderr).toContain("npx playwright install chromium");

    writeFileSync(join(dir, "talk.pptx"), buildPptx(basicDeck(2)));
    const imp = runCli(["pptx", "import", "talk.pptx", "-o", "talk"], dir, { ...env, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` });
    expect(imp.status, imp.stderr).toBe(0);
  }, 120_000);
});

