/**
 * `role: "custom"` rows carry the sender's `details` verbatim.
 *
 * WHY THIS EXISTS. `pi.sendMessage({ customType, content, details })` is how an
 * extension attaches STRUCTURED metadata to a custom row. The reducer already
 * carried `customType` through but DROPPED `details`, so the structure was
 * unobservable in the browser: a renderer could not key a structural attribute
 * off it, and browser assertions degraded to scraping human-readable prose —
 * language-fragile, and explicitly against the e2e suite's own doctrine.
 *
 * `state-replay.ts` already forwards `entry.details` on the replay path, so
 * without this the live and replay paths disagreed about the same message.
 *
 * The reducer stays DUMB about it: it neither reads nor validates the shape, it
 * only stops discarding it — exactly the contract `customType` has.
 */
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent } from "../event-reducer.js";

function customMessage(details: unknown, extra: Record<string, unknown> = {}) {
  return {
    eventType: "message_end",
    timestamp: 1000,
    data: {
      message: {
        role: "custom",
        customType: "ib-greeting",
        content: "Számla feldolgozás alatt",
        display: true,
        ...(details === undefined ? {} : { details }),
        ...extra,
      },
    },
  } as never;
}

describe("custom rows carry `details` verbatim", () => {
  it("forwards a structured details object onto the row", () => {
    const next = reduceEvent(createInitialState(), customMessage({ state: "partner_pending" }));
    const row = next.messages.at(-1)!;
    expect(row.role).toBe("custom");
    expect(row.customType).toBe("ib-greeting");
    expect(row.details).toEqual({ state: "partner_pending" });
  });

  it("carries the object through WITHOUT interpreting or reshaping it", () => {
    const details = { state: "done", nested: { a: [1, 2] }, count: 3 };
    const next = reduceEvent(createInitialState(), customMessage(details));
    // Deep-equal AND not a filtered subset: the reducer must not pick fields.
    expect(next.messages.at(-1)!.details).toEqual(details);
  });

  it("omits the field entirely when the sender sent none", () => {
    const next = reduceEvent(createInitialState(), customMessage(undefined));
    expect(next.messages.at(-1)!.details).toBeUndefined();
  });

  it("ignores a non-object details (no crash, no bogus row field)", () => {
    const next = reduceEvent(createInitialState(), customMessage("not-an-object"));
    const row = next.messages.at(-1)!;
    expect(row.details).toBeUndefined();
    expect(row.content).toContain("Számla");
  });

  it("still honours the display:false exclusion — details does not resurrect a hidden row", () => {
    const before = createInitialState();
    const next = reduceEvent(before, customMessage({ state: "x" }, { display: false }));
    expect(next.messages.length).toBe(before.messages.length);
  });
});
