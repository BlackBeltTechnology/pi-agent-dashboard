import { describe, expect, it } from "vitest";
import { composerLiveness, isComposerWorking } from "../composer-liveness.js";

type Reducer = "idle" | "streaming" | "ended";
const REDUCER: Reducer[] = ["idle", "streaming", "ended"];

// See change: fix-composer-liveness-on-reload (design.md D3 ladder, D7 predicate).
describe("composerLiveness", () => {
  it("returns the reducer status unchanged when no server record exists (E1)", () => {
    for (const r of REDUCER) expect(composerLiveness(r, undefined)).toBe(r);
  });

  it("server ended is terminal regardless of a latched reducer (E2)", () => {
    for (const r of REDUCER) expect(composerLiveness(r, "ended")).toBe("ended");
  });

  it("server streaming wins, incl. a missed new run after reducer ended (E3)", () => {
    for (const r of REDUCER) expect(composerLiveness(r, "streaming")).toBe("streaming");
  });

  it("server idle overrides a latched streaming reducer and collapses ended (E4)", () => {
    for (const r of REDUCER) expect(composerLiveness(r, "idle")).toBe("idle");
  });

  it("server active is NOT liveness: maps to idle, never active (E5)", () => {
    for (const r of REDUCER) expect(composerLiveness(r, "active")).toBe("idle");
  });
});

describe("isComposerWorking", () => {
  const cases = [
    ["streaming", false, true],
    ["streaming", true, true],
    ["idle", true, true],
    ["idle", false, false],
    ["active", true, true],
    ["active", false, false],
    ["ended", true, false],
    ["ended", false, false],
  ] as const;
  for (const [status, retrying, expected] of cases) {
    it(`${status} × retrying=${retrying} → ${expected} (E6)`, () => {
      expect(isComposerWorking(status, retrying)).toBe(expected);
    });
  }
});
