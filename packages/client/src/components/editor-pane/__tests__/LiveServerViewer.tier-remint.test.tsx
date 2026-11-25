/**
 * LiveServerViewer — tiered capability lifecycle: re-mint reuse, idle expiry, retry near absolute expiry,
 * the T1→legacy rollback flip, mint/touch fault injection.
 * See change: serve-live-previews-on-capability-origin (test-plan #F44 #F45 #F46 #F47 #X46 #X50, group 10).
 *
 * jsdom note: an iframe's `src` is never loaded here, so "no reload" is asserted as DOM-node identity plus a
 * marker on the frame's own window; real navigation/paint ordering is only verifiable in a real browser.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import LiveServerViewer from "../LiveServerViewer.js";
import {
  DASH_ORIGIN,
  installTierFake,
  installVisibility,
  legacyPath,
  legacyReply,
  MIN,
  ORIGIN_A,
  ORIGIN_B,
  originReply,
  type Reply,
  type TierFake,
  TWELVE_HOURS,
} from "./live-tier-fake.js";

let fake: TierFake;
let vis: ReturnType<typeof installVisibility>;
let frames: string[];
let observer: MutationObserver;

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  snapshot();
};
const iframe = () => screen.getByTestId("live-iframe") as HTMLIFrameElement;
const src = () => iframe().getAttribute("src") ?? "";
const sandbox = () => iframe().getAttribute("sandbox") ?? "";
/** One `src|sandbox` snapshot per committed DOM change (MutationObserver fires after the commit, before paint). */
const snapshot = () => {
  const f = document.querySelector<HTMLIFrameElement>('[data-testid="live-iframe"]');
  if (f) frames.push(`${f.getAttribute("src")}|${f.getAttribute("sandbox")}`);
};
const open = async () => {
  render(<LiveServerViewer path="live:http://localhost:5173/" />);
  await flush();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  fake = installTierFake();
  vis = installVisibility();
  frames = [];
  observer = new MutationObserver(snapshot);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
});
afterEach(() => {
  observer.disconnect();
  cleanup();
  fake.restore();
  vis.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("T.F44 / #F44 — re-mint reuse keeps the frame", () => {
  it("a re-mint at expiry−10 min returning the same origin does not reload: same DOM node, same src, marker survives", async () => {
    const t0 = Date.now();
    fake.onMint = (n) => originReply(ORIGIN_A, t0 + 60 * MIN * n, { tokenId: `tid${n}` });
    await open();
    expect(fake.mints()).toHaveLength(1);
    const node = iframe();
    const srcBefore = src();
    expect(srcBefore.startsWith(ORIGIN_A)).toBe(true);
    (node.contentWindow as unknown as { __marker?: string }).__marker = "alive";

    await flush(49 * MIN + 59_000);
    expect(fake.mints()).toHaveLength(1);
    await flush(1_000); // expiry (60 min) − 10 min
    expect(fake.mints()).toHaveLength(2);
    expect(iframe()).toBe(node); // the same node: not remounted
    expect(src()).toBe(srcBefore); // attribute string unchanged
    expect((iframe().contentWindow as unknown as { __marker?: string }).__marker).toBe("alive");
    expect(new Set(frames).size).toBe(1); // no intermediate src/sandbox ever committed

    // Only the capability's expiresAt advanced (to t0 + 120 min): the next re-mint is due at 110 min, not 100.
    await flush(59 * MIN + 59_000);
    expect(fake.mints()).toHaveLength(2);
    await flush(1_000);
    expect(fake.mints()).toHaveLength(3);
    expect(iframe()).toBe(node);
    expect(src()).toBe(srcBefore);
  });
});

describe("T.F45 / #F45 — idle expiry after the tab was hidden", () => {
  it("once a touch is refused, exactly one re-mint runs and src converges to the new capability", async () => {
    fake.onMint = (n) => (n === 1 ? originReply(ORIGIN_A, Date.now() + TWELVE_HOURS) : originReply(ORIGIN_B, Date.now() + TWELVE_HOURS, { tokenId: "tidB" }));
    fake.onTouch = () => ({ status: 404, body: { ok: false } }); // the entry idle-expired server-side
    await open();
    expect(src().startsWith(ORIGIN_A)).toBe(true);

    vis.set("hidden");
    await flush(31 * MIN); // touch cadence while hidden is existing behaviour (A8): not asserted
    expect(fake.mints()).toHaveLength(1);
    vis.set("visible");
    await flush(5 * MIN + 1_000); // the first touch after the tab is visible again
    expect(fake.touches().length).toBeGreaterThanOrEqual(1);
    expect(fake.mints()).toHaveLength(2); // exactly one re-mint for the refusal
    expect(src().startsWith(ORIGIN_B)).toBe(true);
    await flush(2 * MIN);
    expect(fake.mints()).toHaveLength(2); // nothing further until the next touch tick
    expect(frames.every((f) => !f.startsWith(`${DASH_ORIGIN()}/`))).toBe(true);
  });
});

describe("T.F46 / #F46 — re-mint near absolute expiry", () => {
  it("stays on the old valid origin through a failed attempt, retries 30 s later, then points at the new label; never both origins", async () => {
    const t0 = Date.now();
    fake.onMint = (n) => {
      if (n === 1) return originReply(ORIGIN_A, t0 + TWELVE_HOURS);
      if (n === 2) return { throws: true };
      return originReply(ORIGIN_B, t0 + 2 * TWELVE_HOURS);
    };
    await open();
    expect(src().startsWith(ORIGIN_A)).toBe(true);

    await flush(11 * 60 * MIN + 50 * MIN - 1_000);
    expect(fake.mints()).toHaveLength(1);
    await flush(1_000); // 11:50:00 → attempt 1 fails
    expect(fake.mints()).toHaveLength(2);
    expect(src().startsWith(ORIGIN_A)).toBe(true); // the old origin is still valid until the new mint succeeds
    await flush(29_000);
    expect(fake.mints()).toHaveLength(2);
    expect(src().startsWith(ORIGIN_A)).toBe(true);
    await flush(1_000); // +30 s → attempt 2 succeeds
    expect(fake.mints()).toHaveLength(3);
    expect(src().startsWith(ORIGIN_B)).toBe(true);
    expect(document.querySelectorAll('[data-testid="live-iframe"]')).toHaveLength(1);
    // Old and new origins never rendered together; the frame moved A → B exactly once.
    const hosts = frames.map((f) => (f.startsWith(ORIGIN_A) ? "A" : f.startsWith(ORIGIN_B) ? "B" : "?"));
    expect(hosts).not.toContain("?");
    expect(hosts.join("").replace(/(.)\1+/g, "$1")).toBe("AB");
  });

  it("keeps a retry pending every 30 s for as long as the old token is still valid", async () => {
    const t0 = Date.now();
    fake.onMint = (n) => (n === 1 ? originReply(ORIGIN_A, t0 + TWELVE_HOURS) : { status: 503, body: { success: false, error: "busy" } });
    await open();
    await flush(11 * 60 * MIN + 50 * MIN);
    for (let i = 2; i <= 6; i++) {
      expect(fake.mints()).toHaveLength(i);
      expect(src().startsWith(ORIGIN_A)).toBe(true);
      await flush(30_000);
    }
  });
});

describe("T.F47 / #F47 — rollback flip T1 → legacy on a refused touch", () => {
  it("re-mint returns legacy; src and sandbox change together, never a legacy/dash-origin src with allow-same-origin", async () => {
    const t0 = Date.now();
    fake.onMint = (n) => (n === 1 ? originReply(ORIGIN_A, t0 + TWELVE_HOURS) : legacyReply("abc12345", n, t0 + TWELVE_HOURS));
    await open();
    expect(src().startsWith(ORIGIN_A)).toBe(true);
    expect(sandbox().split(/\s+/)).toContain("allow-same-origin"); // tiers 1-4 frame their own origin
    fake.onTouch = () => ({ status: 404, body: { ok: false } }); // the server flipped `enabled:false`

    await flush(5 * MIN + 1_000);
    expect(fake.mints()).toHaveLength(2);
    expect(src()).toBe(legacyPath("abc12345", 2));
    expect(sandbox().split(/\s+/)).not.toContain("allow-same-origin");
    expect(sandbox().split(/\s+/).sort()).toEqual(["allow-forms", "allow-scripts"]); // today's legacy sandbox

    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      const [s, sb] = f.split("|");
      const sameOrigin = (sb ?? "").split(/\s+/).includes("allow-same-origin");
      if (s?.startsWith("/live/") || s?.startsWith(`${DASH_ORIGIN()}/`)) expect(sameOrigin).toBe(false);
      if (s?.startsWith(ORIGIN_A)) expect(sameOrigin).toBe(true);
    }
  });
});

describe("T.X46 / #X46 — mint failure on re-mint", () => {
  it("stays on the valid origin, retries every 30 s with at most one mint in flight, and re-points on recovery", async () => {
    const t0 = Date.now();
    fake.onMint = (n) => {
      if (n === 1) return originReply(ORIGIN_A, t0 + TWELVE_HOURS);
      if (n < 5) return { throws: true, delayMs: 5_000 }; // network down: the failure takes a while to surface
      return originReply(ORIGIN_B, t0 + 2 * TWELVE_HOURS);
    };
    await open();
    const node = iframe();
    await flush(11 * 60 * MIN + 50 * MIN); // attempt 2 starts, still pending
    expect(fake.mints()).toHaveLength(2);
    await flush(5_000); // attempt 2 fails
    expect(iframe()).toBe(node);
    expect(src().startsWith(ORIGIN_A)).toBe(true);
    await flush(29_000);
    expect(fake.mints()).toHaveLength(2);
    await flush(1_000); // retry (attempt 3) 30 s after the failure
    expect(fake.mints()).toHaveLength(3);
    await flush(5_000 + 30_000); // attempt 3 fails, attempt 4 starts 30 s later
    expect(fake.mints()).toHaveLength(4);
    expect(src().startsWith(ORIGIN_A)).toBe(true);
    await flush(5_000 + 30_000); // attempt 4 fails, attempt 5 succeeds
    expect(fake.mints()).toHaveLength(5);
    expect(src().startsWith(ORIGIN_B)).toBe(true);
    expect(fake.maxMintsInFlight()).toBe(1);
    await flush(5 * MIN);
    expect(fake.mints()).toHaveLength(5); // no further attempts once recovered
  });
});

describe("T.X50 / #X50 — touch failure variants", () => {
  const failures: Array<[string, Reply]> = [
    ["404", { status: 404, body: { ok: false } }],
    ["403", { status: 403, body: { ok: false } }],
    ["500", { status: 500, body: { ok: false } }],
    ["network error", { throws: true }],
  ];

  it.each(failures)("touch %s: consecutive failures never overlap re-mints (in-flight ≤ 1)", async (_name, bad) => {
    const t0 = Date.now();
    fake.onMint = (n) => ({ ...legacyReply("abc12345", n, t0 + TWELVE_HOURS), delayMs: 1_000 });
    fake.onTouch = () => bad;
    await open();
    expect(fake.mints()).toHaveLength(1);
    for (let i = 0; i < 25; i++) await flush(MIN); // two touch ticks fail, each followed by a (1 s) re-mint
    expect(fake.touches().length).toBeGreaterThanOrEqual(2);
    expect(fake.maxMintsInFlight()).toBe(1);
    expect(screen.getByTestId("live-iframe")).toBeTruthy(); // the frame is never blanked by a touch failure
  });

  it.each(failures.slice(0, 2))("touch %s: one policy re-read and exactly one re-mint per refusal", async (_name, bad) => {
    const t0 = Date.now();
    fake.onMint = (n) => legacyReply("abc12345", n, t0 + TWELVE_HOURS);
    fake.onTouch = () => bad;
    await open();
    const reads = fake.policyReads().length;
    expect(reads).toBe(1);
    await flush(5 * MIN + 1_000);
    expect(fake.touches()).toHaveLength(1);
    expect(fake.policyReads()).toHaveLength(reads + 1);
    expect(fake.mints()).toHaveLength(2);
    await flush(3 * MIN);
    expect(fake.mints()).toHaveLength(2);
    expect(src()).toBe(legacyPath("abc12345", 2));
  });

  it("a re-mint still pending when the next touch fails is not duplicated (in-flight ≤ 1)", async () => {
    const t0 = Date.now();
    fake.onMint = (n) => (n === 2 ? { never: true } : legacyReply("abc12345", n, t0 + TWELVE_HOURS));
    fake.onTouch = () => ({ status: 404, body: { ok: false } });
    await open();
    await flush(5 * MIN + 1_000); // touch 1 refused → re-mint 2 starts and never answers
    await flush(5 * MIN); // touch 2 refused while re-mint 2 is still in flight
    expect(fake.mintsInFlight()).toBeLessThanOrEqual(1);
    expect(fake.maxMintsInFlight()).toBe(1);
  });
});
