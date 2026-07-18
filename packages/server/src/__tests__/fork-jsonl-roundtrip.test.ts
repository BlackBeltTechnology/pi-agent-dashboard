/**
 * Round-trip test: createBranchedSessionFile MUST end the new JSONL at the
 * given entry id. Catches the fork-bubble off-by-one bug from the upstream
 * angle: if the bridge ever stamps a correct entry id on a bubble, this
 * function must produce a file whose tail entry equals that id.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBranchedSessionFile } from "../session/session-file-reader.js";

const FIXTURE = join(__dirname, "fixtures", "fork-jsonl-roundtrip.jsonl");

function readEntries(path: string): any[] {
  return readFileSync(path, "utf-8").trim().split("\n").map(l => JSON.parse(l));
}

describe("createBranchedSessionFile round-trip", () => {
  it("for every non-header entry id, the forked JSONL ends at that id", () => {
    // Copy fixture to a tmp dir so the function can write its sibling output there.
    const tmp = mkdtempSync(join(tmpdir(), "fork-roundtrip-"));
    const tmpFixture = join(tmp, "src.jsonl");
    require("node:fs").copyFileSync(FIXTURE, tmpFixture);

    try {
      const allEntries = readEntries(tmpFixture);
      const candidates = allEntries.filter(e => e.type === "message" || e.type === "model_change").map(e => e.id);
      expect(candidates.length).toBeGreaterThan(0);

      for (const targetId of candidates) {
        const newPath = createBranchedSessionFile(tmpFixture, targetId);
        const newEntries = readEntries(newPath);

        const header = newEntries[0];
        expect(header.type).toBe("session");

        const lastEntry = newEntries[newEntries.length - 1];
        expect(lastEntry.id).toBe(targetId);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws on unknown entry id", () => {
    expect(() => createBranchedSessionFile(FIXTURE, "does-not-exist")).toThrow(/not found/i);
  });
});
