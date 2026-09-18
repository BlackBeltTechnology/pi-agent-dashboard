/**
 * X12 — harvest: engine upgrade breaks ids (#X12, 10.75).
 *
 * Observable: the committed harvest fixture snapshot
 * (`fixtures/strategy-lab.json`, whose diagrams were harvested with the pinned
 * engine) deep-equals a fresh harvest of `fixtures/strategy-lab.md`, and a
 * mismatch message names the `mermaid` pin.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Diagram } from "../../../ir/types.js";
import { parseMarkdown } from "../../markdown.js";
import { chromiumAvailable } from "../../../__tests__/helpers/chromium.js";
import { harvestDiagram } from "../index.js";

const hasChromium = await chromiumAvailable();
const FIXTURES = new URL("../../../../fixtures", import.meta.url).pathname;
const PACKAGE_JSON = new URL("../../../../package.json", import.meta.url).pathname;
const SNAPSHOT = "fixtures/strategy-lab.json";

interface CommittedDeck {
  meta: { mermaid?: string };
  slides: Array<{ id: string; diagram: Diagram }>;
}

const PIN = (JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as { dependencies: { mermaid: string } }).dependencies
  .mermaid;

function snapshotMessage(slideId: string): string {
  return (
    `harvest snapshot mismatch for slide "${slideId}" — the engine is pinned to mermaid ${PIN} (exact). ` +
    `A diff here means the pinned engine's rendered id / structure scheme changed, or ${SNAPSHOT} is stale; ` +
    `bump the pin deliberately and regenerate ${SNAPSHOT}.`
  );
}

/** Deep-equal against the committed snapshot, failing with a pin-named message. */
function assertSnapshot(actual: unknown, expected: unknown, slideId: string): void {
  try {
    expect(actual).toEqual(expected);
  } catch (err) {
    throw new Error(`${snapshotMessage(slideId)}\n${(err as Error).message}`);
  }
}

describe.skipIf(!hasChromium)("harvest: engine upgrade breaks ids (X12)", () => {
  it("pins the engine exactly and re-harvests byte-identical to the committed snapshot", async () => {
    // An exact pin, not a range — the fixture guard is only meaningful then.
    expect(PIN).toMatch(/^\d+\.\d+\.\d+$/);
    const committed = JSON.parse(readFileSync(join(FIXTURES, "strategy-lab.json"), "utf8")) as CommittedDeck;
    expect(committed.meta.mermaid).toBe(PIN);

    const parsed = parseMarkdown(readFileSync(join(FIXTURES, "strategy-lab.md"), "utf8"));
    const mermaidSlides = parsed.slides.filter((s) => s.mermaid);
    // Both supported diagram types must be covered by the snapshot.
    const kinds: string[] = [];
    for (const slide of mermaidSlides) {
      const { diagram } = await harvestDiagram(slide.mermaid!, slide.id);
      const expected = committed.slides.find((s) => s.id === slide.id)?.diagram;
      expect(expected, `no committed diagram for slide "${slide.id}" in ${SNAPSHOT}`).toBeDefined();
      assertSnapshot(diagram, expected, slide.id);
      kinds.push(diagram.kind);
    }
    expect(kinds.sort()).toEqual(["flowchart", "sequence"]);
  }, 120_000);

  it("names the mermaid pin when the snapshot drifts", () => {
    expect(() => assertSnapshot({ kind: "none" }, { kind: "flowchart" }, "drift")).toThrow(
      new RegExp(`mermaid ${PIN.replace(/\./g, "\\.")}`),
    );
  });
});
