import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

const MD = `# Intro

A talk.

- one
- two
`;

describe("deck3d CLI", () => {
  it("--help exits 0 and prints usage", () => {
    const r = runCli(["--help"], process.cwd());
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("deck3d");
  });

  it("parse emits a deterministic deck.json and validate accepts it (E44/E2)", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-cli-"));
    writeFileSync(join(dir, "talk.md"), MD);
    const first = runCli(["parse", "talk.md", "-o", "a.json"], dir);
    expect(first.status, first.stderr).toBe(0);
    const second = runCli(["parse", "talk.md", "-o", "b.json"], dir);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(dir, "a.json"), "utf8")).toBe(readFileSync(join(dir, "b.json"), "utf8"));

    const validate = runCli(["validate", "a.json"], dir);
    expect(validate.status, validate.stderr).toBe(0);
    expect(validate.stdout).toContain("valid");
  });

  it("validate fails on invalid JSON naming the position (X11)", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-cli-"));
    writeFileSync(join(dir, "bad.json"), '{ "meta": {} , }');
    const r = runCli(["validate", "bad.json"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("invalid JSON");
  });
});
