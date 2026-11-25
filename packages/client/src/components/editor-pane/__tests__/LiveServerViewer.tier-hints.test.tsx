/**
 * LiveServerViewer — root-absolute hint gating per tier/target and the tier-5 base strip's copy button.
 * See change: serve-live-previews-on-capability-origin (test-plan #F51 #F52, D7 / task 10.4).
 *
 * jsdom note: `navigator.clipboard` and `document.execCommand` are stubbed; whether a real browser grants clipboard
 * access on a plain-http LAN host (insecure context) can only be confirmed in a real browser.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import LiveServerViewer from "../LiveServerViewer.js";
import { installTierFake, legacyReply, ORIGIN_A, originReply, PID, type Reply, TIER5_PATH, type TierFake, TWELVE_HOURS } from "./live-tier-fake.js";

let fake: TierFake;
const flush = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  fake = installTierFake();
});
afterEach(() => {
  cleanup();
  fake.restore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Tier = 1 | 2 | 3 | 4 | 5 | "legacy";
type Target = "port" | "port-under-base" | "static";

const replyFor = (tier: Tier, target: Target, id: string): Reply => {
  const exp = Date.now() + TWELVE_HOURS;
  if (tier === "legacy") return legacyReply(id, 1, exp);
  if (tier === 5) return { body: { success: true, tier: 5, path: TIER5_PATH, expiresAt: exp, tokenId: "tid5" } };
  const base = target === "port-under-base" ? { base: TIER5_PATH } : {};
  if (tier === 3) return originReply(ORIGIN_A, exp, { tier: 3, path: `/?k=${"K".repeat(22)}`, ...base });
  return originReply(ORIGIN_A, exp, { tier, ...base });
};
const viewerFor = (target: Target) =>
  target === "static" ? <LiveServerViewer path="static:/p/m/a/index.html" cwd="/p" /> : <LiveServerViewer path="live:http://localhost:5173/" />;

interface Case {
  tier: Tier;
  target: Target;
  rootAbsolute: boolean;
}
const cases: Case[] = [];
for (const rootAbsolute of [true, false]) {
  for (const tier of [1, 2, 3, 4] as const) {
    for (const target of ["port", "port-under-base", "static"] as const) cases.push({ tier, target, rootAbsolute });
  }
  for (const target of ["port", "static"] as const) cases.push({ tier: "legacy", target, rootAbsolute });
  cases.push({ tier: 5, target: "port", rootAbsolute }); // a static target never gets tier 5 (D1): the server answers legacy
}

describe("T.F51 / #F51 — hint gating (tier × target × root-absolute references)", () => {
  it.each(cases)("tier $tier · $target · root-absolute refs $rootAbsolute", async ({ tier, target, rootAbsolute }) => {
    const id = target === "static" ? "stat1234" : "abc12345";
    fake.onMint = () => replyFor(tier, target, id);
    fake.egress.rootAbsolute = rootAbsolute;
    render(viewerFor(target));
    await flush(1_000);
    expect(screen.getByTestId("live-iframe")).toBeTruthy();

    // The root-absolute explanation: only on tier 5 / legacy, and (today) only for a static document's own scan.
    const expectRootHint = target === "static" && tier === "legacy" && rootAbsolute;
    expect(screen.queryByTestId("live-hint-root-absolute") !== null).toBe(expectRootHint);
    if (expectRootHint) {
      // The static-target hint keeps its current text.
      expect(screen.getByTestId("live-hint-root-absolute").textContent).toBe(
        "This page uses root-absolute paths (/app.js) that cannot resolve here. Run a dev server bound to localhost and open its localhost URL in the canvas.",
      );
    }
    // A tier-5 port target always shows the base strip, whatever the page references; nothing else ever does.
    const expectBase = target === "port" && tier === 5;
    expect(screen.queryByTestId("live-hint-base-path") !== null).toBe(expectBase);
    if (expectBase) expect(screen.getByTestId("live-base-path").textContent).toBe(TIER5_PATH);
    if (tier !== 5 && tier !== "legacy") {
      // Tiers 1-4 serve at the origin root: neither hint, in any form.
      expect(screen.queryByTestId("live-hint-root-absolute")).toBeNull();
      expect(screen.queryByTestId("live-hint-base-path")).toBeNull();
    }
  });
});

describe("T.F52 / #F52 — base-strip copy button", () => {
  const execCommand = vi.fn(() => true);
  const open = async () => {
    fake.onMint = () => replyFor(5, "port", "abc12345");
    render(viewerFor("port"));
    await flush(1_000);
  };
  const copyButton = () => screen.getByRole("button", { name: /copy/i });
  const status = () => screen.getByTestId("live-base-copy-status");

  beforeEach(() => {
    execCommand.mockClear();
    (document as unknown as { execCommand: unknown }).execCommand = execCommand;
  });
  afterEach(() => {
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it("(a) clipboard resolves: receives exactly /preview/<pid>/ and success is announced via aria-live", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await open();
    expect(copyButton().getAttribute("aria-label") ?? copyButton().textContent).toBeTruthy(); // accessible name
    expect(status().getAttribute("aria-live")).toBe("polite");
    fireEvent.click(copyButton());
    await flush();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(`/preview/${PID}/`);
    expect(status().textContent).toBe("Copied");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("(d) clipboard unavailable but the copyText selection fallback succeeds: success is announced", async () => {
    execCommand.mockReturnValue(true);
    vi.stubGlobal("navigator", {});
    await open();
    fireEvent.click(copyButton());
    await flush();
    expect(status().textContent).toBe("Copied");
  });

  it("(b) clipboard rejects and the shared copyText selection fallback fails: no uncaught exception, failure announced, path stays selectable", async () => {
    execCommand.mockReturnValue(false);
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) } });
    await open();
    fireEvent.click(copyButton());
    await flush();
    expect(status().getAttribute("aria-live")).toBe("polite");
    expect(status().textContent).toBe("Copy failed — select the path");
    expect(screen.getByTestId("live-base-path").textContent).toBe(`/preview/${PID}/`);
    expect(screen.getByTestId("live-base-path").className).toContain("select-all");
    expect(execCommand).toHaveBeenCalledWith("copy"); // the shared `copyText` fallback ran (repo secure-context rule), and failed
  });

  it("(c) navigator.clipboard undefined (plain-http LAN host) and the copyText fallback fails: same announced failure", async () => {
    execCommand.mockReturnValue(false);
    vi.stubGlobal("navigator", {});
    await open();
    fireEvent.click(copyButton());
    await flush();
    expect(status().getAttribute("aria-live")).toBe("polite");
    expect(status().textContent).toBe("Copy failed — select the path");
    expect(screen.getByTestId("live-base-path").textContent).toBe(`/preview/${PID}/`);
    expect(execCommand).toHaveBeenCalledWith("copy"); // the shared `copyText` fallback ran (repo secure-context rule), and failed
  });
});
