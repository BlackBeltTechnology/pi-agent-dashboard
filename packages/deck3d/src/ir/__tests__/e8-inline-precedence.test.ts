/**
 * E8 (task 10.8) — ir: Inline override clobbers deck.json (precedence).
 *
 * The markdown sets `<!-- deck3d: {"mode":"light"} -->` on a slide whose
 * `deck.json` override has `mode: "dark"` (plus `scene: "orbits"`). Parse writes
 * `light`, keeps the untouched `scene`, and warns naming the clobbered key.
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

interface DeckJson {
  overrides: { slides?: Record<string, { mode?: string; scene?: string }> };
}

const MD = `# Intro

A talk.

- one

<!-- deck3d: {"mode":"light"} -->
`;

describe("E8 inline override precedence", () => {
  it("markdown wins over deck.json on the same key and warns", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e8-"));
    writeFileSync(join(dir, "talk.md"), MD);

    const first = runCli(["parse", "talk.md", "-o", "target.json"], dir);
    expect(first.status, first.stderr).toBe(0);
    const targetPath = join(dir, "target.json");
    const deck = JSON.parse(readFileSync(targetPath, "utf8")) as DeckJson;
    deck.overrides.slides = { intro: { mode: "dark", scene: "orbits" } };
    writeFileSync(targetPath, JSON.stringify(deck, null, 2));

    const reparsed = runCli(["parse", "talk.md", "-o", "target.json"], dir);
    expect(reparsed.status, reparsed.stderr).toBe(0);
    expect(reparsed.stderr).toContain('overrides.slides["intro"].mode');

    const after = JSON.parse(readFileSync(targetPath, "utf8")) as DeckJson;
    expect(after.overrides.slides?.intro.mode).toBe("light");
    expect(after.overrides.slides?.intro.scene).toBe("orbits");
  });
});
