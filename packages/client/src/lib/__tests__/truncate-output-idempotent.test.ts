import { describe, it, expect } from "vitest";
import { truncateOutputForDisplay, TRUNCATION_MARKER_PREFIX } from "../event-reducer.js";

// Strategy B (reduce-session-replay-traffic): the server pre-truncates heavy
// tool results to the display form on replay. The client reducer applies
// truncateOutputForDisplay again, so it MUST be idempotent on the marker form —
// otherwise the "N earlier lines hidden" count gets corrupted (re-counted as 1).
describe("truncateOutputForDisplay idempotency on the marker form", () => {
  it("passes an already-truncated result through unchanged", () => {
    const tail = Array.from({ length: 200 }, (_, i) => `line-${i + 1}`).join("\n");
    const serverForm = `${TRUNCATION_MARKER_PREFIX}300 earlier lines hidden»\n${tail}`;
    // Re-applying must NOT change the marker count or drop another line.
    expect(truncateOutputForDisplay(serverForm)).toBe(serverForm);
  });

  it("still truncates a fresh > 200-line result", () => {
    const text = Array.from({ length: 500 }, (_, i) => `r${i + 1}`).join("\n");
    const out = truncateOutputForDisplay(text);
    expect(out.startsWith(`${TRUNCATION_MARKER_PREFIX}300 earlier lines hidden»`)).toBe(true);
    expect(out.split("\n").length).toBe(201);
  });
});
