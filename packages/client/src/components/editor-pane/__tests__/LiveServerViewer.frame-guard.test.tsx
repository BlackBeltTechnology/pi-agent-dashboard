/**
 * LiveServerViewer — frame blanking: cookie-reset banner (D7/D10, task 10.6) and the navigation probe (D6(b)).
 * See change: serve-live-previews-on-capability-origin (test-plan #F64 #F36 #P24).
 *
 * jsdom note: iframes never load, so a `load` event is dispatched by hand and `contentWindow` is scripted.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { installCookieResetFetch, noteDuplicateCookieRefusal } from "../../../lib/live-preview/cookie-reset.js";
import LiveServerViewer from "../LiveServerViewer.js";
import { installTierFake, installVisibility, MIN, ORIGIN_A, originReply, type TierFake, TWELVE_HOURS } from "./live-tier-fake.js";

let fake: TierFake;
let vis: ReturnType<typeof installVisibility>;

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const iframe = () => screen.getByTestId("live-iframe") as HTMLIFrameElement;
const open = async () => {
  render(<LiveServerViewer path="live:http://localhost:5173/" />);
  await flush();
};
const reply = (tier: 1 | 2 | 3) => (n: number) =>
  originReply(ORIGIN_A, Date.now() + TWELVE_HOURS, { tier, tokenId: `tid${n}`, path: tier === 3 ? `/?k=${"k".repeat(43)}` : "/" });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  fake = installTierFake();
  vis = installVisibility();
});
afterEach(() => {
  cleanup();
  fake.restore();
  vis.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("T.F64 / #F64 — a preview reset the dashboard cookies", () => {
  it.each([2, 3] as const)("tier %s: frame blanked to about:blank + banner; nothing reopens or re-mints", async (tier) => {
    fake.onMint = reply(tier);
    await open();
    expect(iframe().getAttribute("src")).not.toBe("about:blank");
    expect(fake.mints()).toHaveLength(1);

    act(() => noteDuplicateCookieRefusal());
    expect(iframe().getAttribute("src")).toBe("about:blank");
    expect(screen.getByTestId("live-cookie-reset").textContent).toContain("A preview reset dashboard cookies; reopen it to continue.");

    await flush(60_000); // 60 s later: still blank, no mint request
    expect(iframe().getAttribute("src")).toBe("about:blank");
    expect(fake.mints()).toHaveLength(1);
  });

  it("tier 1 frame is untouched", async () => {
    fake.onMint = reply(1);
    await open();
    const before = iframe().getAttribute("src");
    act(() => noteDuplicateCookieRefusal());
    expect(iframe().getAttribute("src")).toBe(before);
    expect(screen.queryByTestId("live-cookie-reset")).toBeNull();
  });

  it("Reopen takes a fresh baseline and re-mints", async () => {
    fake.onMint = reply(2);
    await open();
    act(() => noteDuplicateCookieRefusal());
    fireEvent.click(screen.getByTestId("live-cookie-reset-reopen"));
    await flush();
    expect(screen.queryByTestId("live-cookie-reset")).toBeNull();
    expect(iframe().getAttribute("src")).not.toBe("about:blank");
    expect(fake.mints().length).toBeGreaterThanOrEqual(2);
  });

  it("the fetch observer turns a 400 duplicate_dashboard_cookie response into the signal and leaves the body readable", async () => {
    fake.restore();
    const real = window.fetch;
    window.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "duplicate_dashboard_cookie" }), { status: 400 })) as typeof fetch;
    delete (window as unknown as { __piCookieResetFetch?: boolean }).__piCookieResetFetch;
    installCookieResetFetch();
    try {
      const { getCookieResetEpoch } = await import("../../../lib/live-preview/cookie-reset.js");
      const before = getCookieResetEpoch();
      const res = await window.fetch("/api/sessions");
      await vi.advanceTimersByTimeAsync(0);
      expect(getCookieResetEpoch()).toBe(before + 1);
      expect(await res.json()).toEqual({ error: "duplicate_dashboard_cookie" });
    } finally {
      window.fetch = real;
      delete (window as unknown as { __piCookieResetFetch?: boolean }).__piCookieResetFetch;
    }
  });
});

/** Script the frame's `contentWindow`: counts probes; `readable` ⇒ same-origin with the dashboard. */
function scriptContentWindow(node: HTMLIFrameElement, readable: boolean) {
  const probes = { n: 0 };
  Object.defineProperty(node, "contentWindow", {
    configurable: true,
    get() {
      probes.n += 1;
      return {
        location: {
          get href() {
            if (!readable) throw new DOMException("cross-origin", "SecurityError");
            return "http://localhost:8000/";
          },
        },
      };
    },
  });
  return probes;
}

describe("T.F36 / #F36 — D6(b) probe after load", () => {
  it("carries data-pi-live-frame; a cross-origin frame (unreadable location) is left alone", async () => {
    fake.onMint = reply(1);
    await open();
    expect(iframe().hasAttribute("data-pi-live-frame")).toBe(true);
    const probes = scriptContentWindow(iframe(), false);
    fireEvent.load(iframe());
    expect(probes.n).toBe(1);
    expect(iframe().getAttribute("src")).not.toBe("about:blank");
    expect(screen.queryByTestId("live-navigated")).toBeNull();
  });

  it("a readable location blanks the frame, shows the notice, and Reload clears it with no auto re-mint", async () => {
    fake.onMint = reply(1);
    await open();
    scriptContentWindow(iframe(), true);
    fireEvent.load(iframe());
    expect(iframe().getAttribute("src")).toBe("about:blank");
    expect(screen.getByTestId("live-navigated").textContent).toContain("Preview navigated to the dashboard; blocked.");
    await flush(10 * MIN);
    expect(fake.mints()).toHaveLength(1);

    fireEvent.click(screen.getByTestId("live-navigated-reload"));
    await flush();
    expect(screen.queryByTestId("live-navigated")).toBeNull();
    expect(iframe().getAttribute("src")).not.toBe("about:blank");
  });
});

describe("T.P24 / #P24 — re-mint reuse keeps one load handler", () => {
  it("20 same-origin re-mints keep the node; each top-frame load is probed exactly once", async () => {
    fake.onMint = (n) => originReply(ORIGIN_A, Date.now() + 60 * MIN, { tokenId: `tid${n}` });
    await open();
    const node = iframe();
    const probes = scriptContentWindow(node, false);
    for (let i = 0; i < 20; i++) await flush(51 * MIN); // each step crosses expiry − 10 min → one re-mint
    expect(fake.mints().length).toBeGreaterThanOrEqual(20);
    expect(iframe()).toBe(node);
    expect(probes.n).toBe(0); // re-mints cause no load, so no probe
    fireEvent.load(node);
    fireEvent.load(node);
    expect(probes.n).toBe(2); // one probe per load event: a single handler, never accumulated
  });
});
