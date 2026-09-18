/**
 * E2 (task 10.2) — ir: Parse is deterministic (prior overrides input).
 *
 * Case A: parse with no prior target. Case B: parse over a target whose
 * `overrides.slides["intro"].mode` is `light`. Case C: B plus `--fresh`.
 * A and C are byte-identical; B differs from C only inside `overrides`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

const MD = `# Intro

A talk.

- one
- two
`;

describe("E2 parse determinism with prior overrides", () => {
  it("A and C are byte-identical while B differs only inside overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e2-"));
    writeFileSync(join(dir, "talk.md"), MD);

    // Case A — no `-o` target: default `talk.json`, empty overrides.
    const a = runCli(["parse", "talk.md"], dir);
    expect(a.status, a.stderr).toBe(0);
    const aBytes = readFileSync(join(dir, "talk.json"), "utf8");

    // Case B — target carrying a prior override.
    const prior = JSON.stringify({ overrides: { slides: { intro: { mode: "light" } } } });
    writeFileSync(join(dir, "b.json"), prior);
    const b = runCli(["parse", "talk.md", "-o", "b.json"], dir);
    expect(b.status, b.stderr).toBe(0);

    // Case C — same target + `--fresh`: previous overrides are discarded.
    writeFileSync(join(dir, "c.json"), prior);
    const c = runCli(["parse", "talk.md", "-o", "c.json", "--fresh"], dir);
    expect(c.status, c.stderr).toBe(0);
    const cBytes = readFileSync(join(dir, "c.json"), "utf8");

    expect(aBytes).toBe(cBytes);

    const bObj = JSON.parse(readFileSync(join(dir, "b.json"), "utf8")) as Record<string, unknown>;
    const cObj = JSON.parse(cBytes) as Record<string, unknown>;

    // B kept the prior override; C dropped it (`--fresh`).
    const bOverrides = bObj.overrides as { slides: Record<string, { mode: string }> };
    expect(bOverrides.slides.intro.mode).toBe("light");
    const cOverrides = cObj.overrides as { slides: Record<string, unknown> };
    expect(cOverrides.slides).toEqual({});

    // Deep-diff outside `overrides` is empty: derived data and provenance match.
    expect(bObj.meta).toEqual(cObj.meta);
    expect(bObj.defaults).toEqual(cObj.defaults);
    expect(bObj.slides).toEqual(cObj.slides);
  });
});
