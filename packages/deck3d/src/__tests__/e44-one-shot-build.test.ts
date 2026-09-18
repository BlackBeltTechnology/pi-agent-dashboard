/**
 * E44 (task 10.44) — skill: One-shot build, L1-browser (chromium-gated).
 *
 * `build talk.md -o talk.html` is parse + render: it writes `talk.json`
 * (the intermediate IR, beside the html) and `talk.html`, and the json is
 * byte-equal to running `parse talk.md` on its own.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromiumAvailable } from "./helpers/chromium.js";

const BIN = new URL("../../bin/deck3d", import.meta.url).pathname;
const hasChromium = await chromiumAvailable();

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

const MD = `# Talk

Intro.

- one
- two
`;

describe.skipIf(!hasChromium)("E44 one-shot build (chromium)", () => {
  it("writes talk.json + talk.html, talk.json byte-equal to parse output", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e44-"));
    writeFileSync(join(dir, "talk.md"), MD);

    const build = runCli(["build", "talk.md", "-o", "talk.html"], dir);
    expect(build.status, build.stderr).toBe(0);
    expect(existsSync(join(dir, "talk.json"))).toBe(true);
    expect(existsSync(join(dir, "talk.html"))).toBe(true);

    const parse = runCli(["parse", "talk.md", "-o", "parsed.json"], dir);
    expect(parse.status, parse.stderr).toBe(0);
    expect(readFileSync(join(dir, "talk.json"), "utf8")).toBe(readFileSync(join(dir, "parsed.json"), "utf8"));
  }, 120_000);
});
