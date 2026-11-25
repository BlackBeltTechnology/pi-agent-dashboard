// @vitest-environment jsdom
/**
 * L1 (test-plan #B33, task 11.32): the dashboard has NO window.postMessage / opener channel for sign-in returns (design D3 /
 * D12b, #B25) — the browser return is the user's own tab on pi-dashboard.dev and the dashboard learns the outcome over its
 * own flow polling. So `message` events are never processed, whatever their origin: the exact `https://pi-dashboard.dev`
 * included. A stricter reading of the scenario ("only the exact origin is processed") would introduce the very channel the
 * design rules out. See change: add-google-connect.
 */
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLOW_URL, flowRoutes, mockApi, renderSettings, STATE_URL, state } from "./harness.js";

beforeEach(() => {
  vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ORIGINS = ["https://pi-dashboard.dev", "null", "", "https://pi-dashboard.dev:444"] as const;
const PAYLOADS: unknown[] = [
  { type: "google-oauth-return", flowId: "f1", code: "4/0AbC", state: "S" },
  { flowId: "f1", status: "complete" },
  "https://pi-dashboard.dev/return?code=4/0AbC&state=S",
];

describe("#B33 return `message` events (no channel exists by design D12b/#B25)", () => {
  it.each(ORIGINS)("origin %j: while the dialog waits, no payload changes the dialog, the account list or triggers a request", async (origin) => {
    const api = mockApi({ [`GET ${STATE_URL}`]: () => state(), "POST /api/plugins/google/accounts": () => ({ ok: true, flowId: "f1", path: "local", client: "builtin" }), ...flowRoutes() });
    renderSettings();
    fireEvent.click(await screen.findByTestId("google-connect"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("google-continue"));
    await screen.findByTestId("google-waiting", {}, { timeout: 4000 });

    const outside = () => api.fn.mock.calls.filter(([url, init]) => !(url === FLOW_URL && (init?.method ?? "GET") === "GET")).length;
    const before = { text: screen.getByRole("dialog").textContent, requests: outside(), opened: vi.mocked(window.open).mock.calls.length };
    for (const data of PAYLOADS) {
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { origin, data }));
      });
    }
    await act(() => new Promise<void>((r) => setTimeout(r, 50)));

    expect(screen.getByTestId("google-waiting")).toBeTruthy();
    expect(screen.queryByTestId("google-connected-email")).toBeNull();
    expect(screen.getByRole("dialog").textContent).toBe(before.text);
    expect(outside(), "no fetch other than the flow's own status poll").toBe(before.requests);
    expect(vi.mocked(window.open).mock.calls).toHaveLength(before.opened);
  });
});
