/**
 * The stub asset bundle is generated (`scripts/gen-stub-assets.ts`): both
 * committed copies — `assets/preview/` (powers `fx preview`) and
 * `fixtures/business-2031/assets/` (pinned in its deck.json) — must equal the
 * generator output, or they silently drift. Change deck3d-pptx-import.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STUB_PARAMS, stubFiles } from "../stub-assets.js";

const dirs = [new URL("../../../assets/preview/", import.meta.url), new URL("../../../fixtures/business-2031/assets/", import.meta.url)];

describe("stub asset bundle", () => {
  for (const dir of dirs) {
    it(`${dir.pathname.split("/").slice(-4, -1).join("/")} equals the generator output`, () => {
      for (const [name, data] of Object.entries(stubFiles())) {
        const want = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
        expect(readFileSync(new URL(name, dir)).equals(want), name).toBe(true);
      }
    });
  }

  it("has preview params for every built-in that reads assets", () => {
    expect(Object.keys(STUB_PARAMS).sort()).toEqual(["art3d", "frame-chrome", "haze", "icon3d", "slide-layer"]);
  });
});
