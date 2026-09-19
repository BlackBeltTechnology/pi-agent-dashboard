/**
 * E4 (task 10.4) — skill: Markdown grammar (zero headings), BVA (min slides).
 *
 * A markdown document with no `# Title` yields exactly one slide, id `slide`,
 * built from the whole body: `hello` becomes the subtitle and `- a` / `- b` the
 * bullets.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

describe("E4 markdown grammar — zero headings", () => {
  it("parses a heading-less body into one slide `slide` with its bullets", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e4-"));
    writeFileSync(join(dir, "notes.md"), "hello\n- a\n- b\n");

    const r = runCli(["parse", "notes.md", "-o", "deck.json"], dir);
    expect(r.status, r.stderr).toBe(0);

    const ir = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as {
      slides: Array<{ id: string; bullets: string[] }>;
    };
    expect(ir.slides).toHaveLength(1);
    expect(ir.slides[0].id).toBe("slide");
    expect(ir.slides[0].bullets).toEqual(["a", "b"]);
  });
});
