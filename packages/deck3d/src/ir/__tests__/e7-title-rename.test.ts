/**
 * E7 (task 10.7) — ir: Title rename without pin.
 *
 * A target carries `overrides.slides["old-title"]`; the markdown title is
 * renamed. Parse exits 0, warns naming the orphan slug and suggesting the
 * `{#old-title}` pin, the derived slide gets the new slug, and the override is
 * kept (inert).
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
  slides: Array<{ id: string }>;
  overrides: { slides?: Record<string, { mode?: string }> };
}

describe("E7 title rename without pin", () => {
  it("warns naming the old slug, suggests the pin, and keeps the override", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e7-"));
    writeFileSync(join(dir, "talk.md"), "# Old Title\n\n- a\n");

    const first = runCli(["parse", "talk.md", "-o", "target.json"], dir);
    expect(first.status, first.stderr).toBe(0);
    const targetPath = join(dir, "target.json");
    const deck = JSON.parse(readFileSync(targetPath, "utf8")) as DeckJson;
    deck.overrides.slides = { "old-title": { mode: "light" } };
    writeFileSync(targetPath, JSON.stringify(deck, null, 2));

    // Rename the slide, unpinned.
    writeFileSync(join(dir, "talk.md"), "# New Title\n\n- a\n");
    const renamed = runCli(["parse", "talk.md", "-o", "target.json"], dir);
    expect(renamed.status, renamed.stderr).toBe(0);

    expect(renamed.stderr).toContain('overrides.slides["old-title"]');
    expect(renamed.stderr).toContain("{#old-title}");

    const after = JSON.parse(readFileSync(targetPath, "utf8")) as DeckJson;
    expect(after.slides[0].id).toBe("new-title");
    expect(after.overrides.slides?.["old-title"]).toEqual({ mode: "light" });
  });
});
