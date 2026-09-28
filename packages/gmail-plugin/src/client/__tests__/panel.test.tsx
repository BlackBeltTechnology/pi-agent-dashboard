// @vitest-environment jsdom
/**
 * L1 accounts-panel tests (task 4.2): rows, badges, honest level help, level
 * change, revoke outcome, flow error → wizard step. See change: add-gmail-plugin.
 */
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailSettings } from "../GmailSettings.js";

const renderPanel = () =>
  render(withUiPrimitiveProvider({ "ui:oauth-flow": () => <div data-testid="flow-view" /> }, <GmailSettings />));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATE = {
  client: { configured: true, clientId: "x.apps.googleusercontent.com" },
  accounts: [
    { sub: "s1", email: "a@x.com", alias: "work", tier: "send", status: "ok", addedAt: 1 },
    { sub: "s2", email: "b@y.com", tier: "readonly", status: "reauth_required", testingHint: true, addedAt: 2 },
  ],
};

function mockFetch(routes: Record<string, (init?: RequestInit) => unknown>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const handler = routes[key];
    if (!handler) return new Response(JSON.stringify({ error: "nope" }), { status: 404 });
    return new Response(JSON.stringify(handler(init)), { status: 200 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("accounts panel", () => {
  it("lists accounts with status badges, testing hint and the honest scope-limit help", async () => {
    mockFetch({ "GET /api/plugins/gmail/state": () => STATE });
    renderPanel();
    const rows = await screen.findAllByTestId("gmail-account-row");
    expect(rows.map((r) => r.dataset.email)).toEqual(["a@x.com", "b@y.com"]);
    expect(within(rows[0] as HTMLElement).getByTestId("gmail-account-status").dataset.status).toBe("ok");
    expect(within(rows[1] as HTMLElement).getByTestId("gmail-account-status").textContent).toBe("re-auth needed");
    expect(rows[1]?.textContent).toContain("testing: 7-day");
    expect(screen.getByTestId("gmail-level-help").textContent).toMatch(/not by Google/);
  });

  it("lowering a level posts the new tier and refreshes without a flow", async () => {
    const fetchMock = mockFetch({
      "GET /api/plugins/gmail/state": () => STATE,
      "POST /api/plugins/gmail/accounts/s1/level": () => ({ applied: true }),
    });
    renderPanel();
    const rows = await screen.findAllByTestId("gmail-account-row");
    fireEvent.change(within(rows[0] as HTMLElement).getByTestId("gmail-account-level"), { target: { value: "draft" } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/plugins/gmail/accounts/s1/level",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ tier: "draft" }) }),
      ),
    );
  });

  it("revoke with Google unreachable says to revoke manually", async () => {
    mockFetch({
      "GET /api/plugins/gmail/state": () => STATE,
      "DELETE /api/plugins/gmail/accounts/s1": () => ({ removed: true, remoteRevoked: false }),
    });
    renderPanel();
    const rows = await screen.findAllByTestId("gmail-account-row");
    fireEvent.click(within(rows[0] as HTMLElement).getByTestId("gmail-account-revoke"));
    expect((await screen.findByTestId("gmail-revoke-result")).textContent).toMatch(/myaccount\.google\.com\/permissions/);
  });

  it("a start failure maps to its wizard step", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        url.endsWith("/state")
          ? new Response(JSON.stringify(STATE), { status: 200 })
          : init?.method === "POST"
            ? new Response(JSON.stringify({ error: "invalid_client" }), { status: 502 })
            : new Response("{}", { status: 404 }),
      ),
    );
    renderPanel();
    fireEvent.click(await screen.findByTestId("gmail-add-account"));
    const err = await screen.findByTestId("gmail-flow-error");
    expect(err.dataset.step).toBe("5");
  });
});
