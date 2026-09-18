import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

const MD = `# Talk

Intro.

- one
- two
`;

describe("deck3d build / render CLI", () => {
  it("build writes <name>.json beside <name>.html, equal to parse output (E44)", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-build-"));
    writeFileSync(join(dir, "talk.md"), MD);
    const build = runCli(["build", "talk.md", "-o", "talk.html"], dir);
    expect(build.status, build.stderr).toBe(0);
    expect(existsSync(join(dir, "talk.html"))).toBe(true);
    expect(existsSync(join(dir, "talk.json"))).toBe(true);

    const parse = runCli(["parse", "talk.md", "-o", "parsed.json"], dir);
    expect(parse.status, parse.stderr).toBe(0);
    expect(readFileSync(join(dir, "talk.json"), "utf8")).toBe(readFileSync(join(dir, "parsed.json"), "utf8"));

    const html = readFileSync(join(dir, "talk.html"), "utf8");
    expect(html).toContain("window.__DECK=");
    expect(html).not.toMatch(/mermaid/i);
  }, 120_000);

  it("--help exits 0 and lists the commands", () => {
    const r = runCli(["--help"], process.cwd());
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("render");
    expect(r.stdout).toContain("snapshot");
  });

  it("render refuses an invalid deck.json and writes no html (X11)", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-build-"));
    writeFileSync(join(dir, "bad.json"), '{ "meta": {}, }');
    const r = runCli(["render", "bad.json", "-o", "bad.html"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("invalid JSON");
    expect(existsSync(join(dir, "bad.html"))).toBe(false);
  });
});
