/**
 * `requestAccessTarget` — the one rule for where "Request access" leads, shared
 * by the network-denied banner and the Vault callout row.
 * See change: add-request-access-remedy (test-plan E17, design D7).
 */
import { describe, expect, it } from "vitest";
import { requestAccessTarget } from "../request-access-target.js";

const ORIGIN = "http://192.168.16.31:8000";

describe("E17 requestAccessTarget", () => {
  it.each([
    ["empty base", "", ORIGIN, { href: "/pair?request", newContext: false }],
    ["base equal to the page origin", ORIGIN, ORIGIN, { href: "/pair?request", newContext: false }],
    ["another server", "http://192.168.16.204:8000", ORIGIN, { href: "http://192.168.16.204:8000/pair?request", newContext: true }],
    // The banner never normalised the base; neither does the helper (parity, not a fix).
    ["trailing-slash base", "http://x:8000/", "http://x:8000", { href: "http://x:8000//pair?request", newContext: true }],
  ] as const)("%s", (_l, base, origin, expected) => {
    expect(requestAccessTarget(base, origin)).toEqual(expected);
  });
});
