/**
 * E3 (task 10.3) — design D1 slide ids.
 *
 * Colliding/empty/ASCII-folded titles get `-<ordinal>` suffixes and an empty
 * heading falls back to `slide`; an explicit `{#pin}` wins. Every id matches
 * the reserved-prefix-free slug pattern.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;
const ID_RE = /^(?!deck3d-)[a-z0-9-]+$/;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

const MD = [
  "# Ágensrajok",
  "",
  "- a",
  "",
  "# Agensrajok",
  "",
  "- b",
  "",
  "# Agensrajok",
  "",
  "- c",
  "",
  "# ",
  "",
  "- d",
  "",
  "# Final {#pin}",
  "",
  "- e",
  "",
].join("\n");

describe("E3 slide id derivation", () => {
  it("assigns folded slugs with collision ordinals, a `slide` fallback and a pin", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e3-"));
    writeFileSync(join(dir, "titles.md"), MD);

    const r = runCli(["parse", "titles.md", "-o", "titles.json"], dir);
    expect(r.status, r.stderr).toBe(0);

    const ir = JSON.parse(readFileSync(join(dir, "titles.json"), "utf8")) as {
      slides: Array<{ id: string }>;
    };
    const ids = ir.slides.map((s) => s.id);
    expect(ids).toEqual(["agensrajok", "agensrajok-2", "agensrajok-3", "slide", "pin"]);
    for (const id of ids) expect(id, `id ${id}`).toMatch(ID_RE);
  });
});
