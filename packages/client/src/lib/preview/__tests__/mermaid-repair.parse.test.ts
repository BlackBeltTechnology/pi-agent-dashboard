// Real-mermaid parse smoke check for the repair fixtures (test-plan E16):
// every `broken` fixture's original is REJECTED by the pinned mermaid build
// (catches vacuous fixtures) and its repaired source is ACCEPTED. Parse-level
// only — jsdom has no layout, so render is covered manually.
// See change: add-mermaid-auto-repair.
import mermaid from "mermaid";
import { beforeAll, describe, expect, it } from "vitest";
import { mermaidConfig } from "../../../components/preview/mermaid-config.js";
import { repairMermaid } from "../mermaid-repair.js";
import { FIXTURES } from "./mermaid-repair.fixtures.js";

async function parses(code: string): Promise<boolean> {
  try {
    await mermaid.parse(code);
    return true;
  } catch {
    return false;
  }
}

describe("repair fixtures against real mermaid", () => {
  beforeAll(() => {
    mermaid.initialize(mermaidConfig("light"));
  });

  it.each(FIXTURES.filter((f) => f.broken).map((f) => [f.name, f] as const))(
    "%s: original rejects, repaired resolves",
    async (_name, f) => {
      expect(await parses(f.src), `original should fail:\n${f.src}`).toBe(false);
      const r = repairMermaid(f.src);
      expect(r.applied.length).toBeGreaterThan(0);
      expect(await parses(r.code), `repaired should parse (${r.applied.join(",")}):\n${r.code}`).toBe(true);
    },
  );

  it.each(FIXTURES.filter((f) => !f.broken).map((f) => [f.name, f] as const))("%s: parses as-is", async (_name, f) => {
    expect(await parses(f.src)).toBe(true);
  });
});
