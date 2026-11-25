/**
 * Open ↗ for a REMOTE operator (dashboard at `http://dash.example.com:8000`, tier-5 base path): even a user-added port
 * has no direct `localhost:<port>` target, so Open mints and opens the frame's own `/preview/<pid>/` URL.
 * See change: serve-live-previews-on-capability-origin (test-plan #E175, remote cell).
 */
// @vitest-environment-options {"url":"http://dash.example.com:8000"}
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewProvenance } from "../../../lib/access-grants/preview-provenance.js";
import { resetExposureStore } from "../../../lib/live-preview/exposure-store.js";
import { type FakeServers, installFakeLiveServer } from "./live-fake-api.js";

const DASH = "http://dash.example.com:8000";
const state = vi.hoisted(() => ({ apiBase: "" }));
vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => state.apiBase }));

import LiveServerViewer from "../LiveServerViewer.js";

const PID = "R".repeat(22);
const TWELVE_HOURS = 12 * 60 * 60_000;

let fake: FakeServers;
let mintCount: number;
let opened: { location: { href: string }; opener: unknown; close: ReturnType<typeof vi.fn> };

const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  resetExposureStore();
  state.apiBase = DASH;
  mintCount = 0;
  fake = installFakeLiveServer();
  const inner = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).endsWith("/capability")) return inner(input, init);
    mintCount += 1;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const payload = {
      ok: true,
      success: true,
      tier: 5,
      path: `/preview/${PID}/`,
      expiresAt: Date.now() + TWELVE_HOURS,
      tokenId: `tid${mintCount}`,
      policy: { egress: body.egress === "open" ? "open" : "restricted", scripts: body.scripts === true },
    };
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as unknown as typeof fetch;
  opened = { location: { href: "" }, opener: {}, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(opened as unknown as Window);
});
afterEach(() => {
  cleanup();
  fake.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("T.E175 / #E175 Open ↗ (remote operator, tier 5)", () => {
  it("fixture sanity: the page is a remote (non-local) dashboard", () => {
    expect(window.location.origin).toBe(DASH);
  });

  it("(remote, agent preset, T5) opens a fresh mint equal to dash + /preview/<pid>/ + deep", async () => {
    render(
      <PreviewProvenance autoOpened>
        <LiveServerViewer path="live:http://localhost:5173/report.html?x=1" />
      </PreviewProvenance>,
    );
    await flush();
    const frameSrc = (screen.getByTestId("live-iframe") as HTMLIFrameElement).getAttribute("src");
    expect(frameSrc).toBe(`${DASH}/preview/${PID}/report.html?x=1`);
    expect(screen.getByTestId("live-base-path").textContent).toBe(`/preview/${PID}/`);
    fireEvent.click(screen.getByTestId("live-open"));
    await flush();
    expect(mintCount).toBe(2);
    expect(opened.location.href).toBe(`${DASH}/preview/${PID}/report.html?x=1`);
    expect(opened.location.href).toBe(frameSrc);
  });

  it("(remote, user-added port, T5) has no direct localhost link: Open mints and opens the frame URL", async () => {
    render(<LiveServerViewer />);
    fireEvent.click(screen.getByTestId("live-confirm"));
    await flush();
    const open = screen.getByTestId("live-open");
    // A remote operator's `localhost:<port>` is NOT the dev machine: no direct anchor.
    expect(open.tagName).toBe("BUTTON");
    expect(open.getAttribute("href")).toBeNull();
    fireEvent.click(open);
    await flush();
    expect(mintCount).toBe(2);
    expect(opened.location.href).toBe(`${DASH}/preview/${PID}/`);
  });
});
