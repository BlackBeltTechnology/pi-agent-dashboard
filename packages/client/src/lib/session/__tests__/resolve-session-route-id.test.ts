/** Test-plan #E8 — `resolveSessionRouteId` (design D4). */
import { describe, expect, it } from "vitest";
import { resolveSessionRouteId } from "../resolve-session-route-id.js";

const A = "01a16086-aaaa-4aaa-8aaa-000000000001";
const B = "01a16086-bbbb-4bbb-8bbb-000000000002";
const DEAD_LONG = "deadbeef-0000-4000-8000-000000000003";
const DEAD = "deadbeef";
const CAFE = "cafe1234-5678-4abc-8def-000000000004";
const ids = [A, B, DEAD_LONG, DEAD, CAFE];

describe("resolveSessionRouteId", () => {
  it("E8(a): the raw exact id wins over the prefix of a longer id", () => {
    expect(resolveSessionRouteId("deadbeef", ids)).toEqual({ kind: "match", id: DEAD });
  });
  it("E8(b): a full uppercase id canonicalizes to the held id", () => {
    expect(resolveSessionRouteId(DEAD_LONG.toUpperCase(), ids)).toEqual({ kind: "match", id: DEAD_LONG });
  });
  it("E8(c,d): a unique >= 8 char prefix resolves, case-insensitively, to the live-cased id", () => {
    expect(resolveSessionRouteId("cafe1234", ids)).toEqual({ kind: "match", id: CAFE });
    expect(resolveSessionRouteId("CAFE1234", ids)).toEqual({ kind: "match", id: CAFE });
  });
  it("E8(e): an ambiguous prefix lists every candidate", () => {
    const r = resolveSessionRouteId("01a16086", ids);
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect([...r.candidates].sort()).toEqual([A, B].sort());
  });
  it("E8(f,g): under 8 chars or unknown → none", () => {
    expect(resolveSessionRouteId("cafe123", ids)).toEqual({ kind: "none" });
    expect(resolveSessionRouteId("nope0000", ids)).toEqual({ kind: "none" });
  });
});
