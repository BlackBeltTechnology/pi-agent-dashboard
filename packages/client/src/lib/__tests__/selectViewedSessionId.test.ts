import { describe, it, expect } from "vitest";
import { selectViewedSessionId } from "../session/selectViewedSessionId.js";

/**
 * See change: session-card-unread-stripes.
 */
describe("selectViewedSessionId", () => {
  it("returns the id when the route matched", () => {
    expect(selectViewedSessionId(true, { id: "abc" })).toBe("abc");
  });

  it("returns null when the route did not match", () => {
    expect(selectViewedSessionId(false, { id: "abc" })).toBeNull();
  });

  it("returns null when match is undefined", () => {
    expect(selectViewedSessionId(undefined, { id: "abc" })).toBeNull();
  });

  it("returns null when params is null", () => {
    expect(selectViewedSessionId(true, null)).toBeNull();
  });

  it("returns null when params is undefined", () => {
    expect(selectViewedSessionId(true, undefined)).toBeNull();
  });

  it("returns null when params.id is missing", () => {
    expect(selectViewedSessionId(true, {})).toBeNull();
  });

  it("returns null when params.id is empty string", () => {
    expect(selectViewedSessionId(true, { id: "" })).toBeNull();
  });

  it("returns null when params.id is not a string", () => {
    // @ts-expect-error testing runtime shape
    expect(selectViewedSessionId(true, { id: 123 })).toBeNull();
  });
});
