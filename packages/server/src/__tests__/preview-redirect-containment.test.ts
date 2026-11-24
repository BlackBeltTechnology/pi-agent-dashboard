/**
 * D3(c) header containment on tiers 1-4: an upstream `Refresh` / `Location` aimed at a dashboard origin is dropped / rewritten onto
 * the preview origin; everything else (own origin, relative, third party, malformed) is left alone. The browser-level proof is
 * `tests/e2e/live-preview/nav-guard.spec.ts` (test-plan #F40).
 * See change: serve-live-previews-on-capability-origin (D3(c)).
 */
import { describe, expect, it } from "vitest";
import { containDashboardRedirects } from "../live-server/live-server-proxy.js";

const PREVIEW = "http://abcdefghijklmnopqrstuvwxyz.localhost:8000";
const isDash = (u: URL) => u.origin === "http://localhost:8000" || u.origin === "http://127.0.0.1:8000";
const run = (headers: Record<string, unknown>) => {
  containDashboardRedirects(headers, PREVIEW, isDash);
  return headers;
};

describe("containDashboardRedirects (D3(c))", () => {
  it.each([
    ["0; url=http://localhost:8000/x"],
    ["5;URL='http://127.0.0.1:8000/'"],
    ['0 ; url = "http://localhost:8000/a?b=1"'],
  ])("drops a Refresh aimed at the dashboard: %s", (refresh) => {
    expect(run({ refresh }).refresh).toBeUndefined();
  });

  it.each([["0; url=/relative"], ["0; url=http://example.org/x"], ["3"], ["0; url=http://abcdefghijklmnopqrstuvwxyz.localhost:8000/self"], ["0; url=http://[bad"]])("keeps a harmless Refresh: %s", (refresh) => {
    expect(run({ refresh }).refresh).toBe(refresh);
  });

  it("rewrites a Location aimed at the dashboard onto the preview origin (path, query, hash kept)", () => {
    expect(run({ location: "http://localhost:8000/x?a=1#h" }).location).toBe(`${PREVIEW}/x?a=1#h`);
    expect(run({ location: "http://127.0.0.1:8000/" }).location).toBe(`${PREVIEW}/`);
  });

  it.each([["/login"], ["./x"], ["https://example.org/x"], ["http://localhost:9999/x"], [`${PREVIEW}/y`], ["javascript:alert(1)"]])("leaves Location %s alone", (location) => {
    expect(run({ location }).location).toBe(location);
  });

  it("ignores headers that are not strings", () => {
    expect(run({ refresh: ["0; url=http://localhost:8000/"], location: 7 })).toEqual({ refresh: ["0; url=http://localhost:8000/"], location: 7 });
  });
});
