/**
 * LiveServerViewer — version-skew matrix, mint stall, corrupt mint answers, validator rejection.
 * See change: serve-live-previews-on-capability-origin (test-plan #F48 #X47 #X48 #X49, group 10).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import LiveServerViewer from "../LiveServerViewer.js";
import { DASH_ORIGIN, installTierFake, legacyPath, legacyReply, MIN, originReply, type Reply, type TierFake, TWELVE_HOURS } from "./live-tier-fake.js";

let fake: TierFake;
const flush = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const iframe = () => screen.getByTestId("live-iframe");
const staticViewer = () => <LiveServerViewer path="static:/p/m/a/index.html" cwd="/p" />;
const portViewer = () => <LiveServerViewer path="live:http://localhost:5173/" />;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  fake = installTierFake();
});
afterEach(() => {
  cleanup();
  fake.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("T.F48 / #F48 — version skew matrix", () => {
  const legacySandbox = ["allow-forms", "allow-scripts"];
  const skewed: Array<[string, (n: number) => Reply]> = [
    ["old server (no `tier`, no `origin`)", (n) => legacyReply("stat1234", n, Date.now() + TWELVE_HOURS)],
    ["server `enabled:false` (explicit legacy tier)", (n) => legacyReply("stat1234", n, Date.now() + TWELVE_HOURS, { tier: "legacy" })],
    ["T5-host server answering an older client's accept:[origin] (legacy path)", (n) => legacyReply("stat1234", n, Date.now() + TWELVE_HOURS, { policy: { egress: "restricted", scripts: true } })],
  ];

  it.each(skewed)("%s: framed on the legacy path with today's sandbox and the root-absolute hint", async (_name, reply) => {
    fake.onMint = reply;
    fake.egress.rootAbsolute = true;
    render(staticViewer());
    await flush(1_000);
    expect(fake.mints()[0]?.body?.accept).toEqual(["origin", "preview"]); // the new client always negotiates
    expect(iframe().getAttribute("src")).toBe(`${legacyPath("stat1234", 1)}index.html`);
    expect((iframe().getAttribute("sandbox") ?? "").split(/\s+/).sort()).toEqual(legacySandbox);
    expect(screen.getByTestId("live-hint-root-absolute").textContent).toContain("root-absolute"); // today's hint
    expect(screen.queryByTestId("live-error")).toBeNull();
  });

  it.each([
    ["future tier 6", { tier: 6, origin: "http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000", path: "/" }],
    ["tier 5 carrying an origin", { tier: 5, origin: "http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000", path: `/preview/${"A".repeat(22)}/` }],
    ["tier 1 with the legacy path", { tier: 1, origin: "http://k7q4zm2x5c6h3v4d5fjqwyabn7.localhost:8000", path: legacyPath("abc12345", 1) }],
  ])("%s: an error is shown, nothing is framed, never blank", async (_name, extra) => {
    fake.onMint = () => ({ body: { success: true, expiresAt: Date.now() + TWELVE_HOURS, tokenId: "t", ...extra } });
    render(portViewer());
    await flush(1_000);
    expect(screen.queryByTestId("live-iframe")).toBeNull();
    expect(screen.queryByTestId("live-loading")).toBeNull(); // not a blank/loading limbo
    // The validator's wording is "preview response rejected" (test-plan prose says "unexpected response").
    expect(screen.getByTestId("live-error").textContent).toContain("preview response rejected");
  });

  it("every outcome in the matrix renders either a frame or an error, never neither", async () => {
    for (const reply of [legacyReply("abc12345", 1, Date.now() + TWELVE_HOURS), { body: { success: true, tier: 6, path: "/", expiresAt: 1 } }] satisfies Reply[]) {
      fake.onMint = () => reply;
      const { unmount } = render(portViewer());
      await flush(1_000);
      expect(screen.queryByTestId("live-iframe") !== null || screen.queryByTestId("live-error") !== null).toBe(true);
      unmount();
    }
  });
});

describe("T.X47 / #X47 — mint stall", () => {
  it("shows the loading state while the mint is pending and never frames before a valid response", async () => {
    fake.onMint = () => ({ never: true });
    render(portViewer());
    for (const ms of [0, 1_000, MIN, 10 * MIN]) {
      await flush(ms);
      expect(screen.getByTestId("live-loading")).toBeTruthy();
      expect(screen.queryByTestId("live-iframe")).toBeNull();
      expect(screen.queryByTestId("live-error")).toBeNull();
    }
    expect(fake.mints()).toHaveLength(1); // no client-side timeout / retry of the stalled request (Q42)
  });
});

describe("T.X48 / #X48 — mint 200 that is not a valid answer", () => {
  it.each([
    ["HTML 200 (captive proxy, res.json() throws)", { text: true } as Reply],
    ["200 with {}", { body: {} } as Reply],
  ])("%s: error line, no iframe, nothing thrown out of the hook", async (_name, reply) => {
    fake.onMint = () => reply;
    render(portViewer());
    await flush(1_000);
    expect(screen.queryByTestId("live-iframe")).toBeNull();
    expect(screen.getByTestId("live-error").textContent).toMatch(/capability mint returned an unexpected response|capability mint failed \(200\)/);
  });
});

describe("T.X49 / #X49 — validator rejection is terminal", () => {
  it("a dash-origin tier-1 answer shows 'preview response rejected' + Retry, no re-mint for 2 min, Retry mints once", async () => {
    fake.onMint = () => originReply(DASH_ORIGIN(), Date.now() + TWELVE_HOURS);
    render(portViewer());
    await flush(1_000);
    expect(screen.queryByTestId("live-iframe")).toBeNull();
    expect(screen.getByTestId("live-error").textContent).toContain("preview response rejected");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(fake.mints()).toHaveLength(1);

    await flush(2 * MIN);
    expect(fake.mints()).toHaveLength(1); // terminal: 0 further mint requests

    fireEvent.click(screen.getByTestId("live-retry"));
    await flush(1_000);
    expect(fake.mints()).toHaveLength(2); // Retry mints exactly once
    expect(screen.getByTestId("live-error").textContent).toContain("preview response rejected");
    expect(screen.queryByTestId("live-iframe")).toBeNull();
    await flush(2 * MIN);
    expect(fake.mints()).toHaveLength(2);
  });
});
