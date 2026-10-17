import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairingApprovalStore } from "../../lib/pairing/pairing-approval-store.js";
import { reachabilityStore } from "../../lib/remote-access/reachability-store.js";
import { RUN_KEY } from "../../lib/remote-access/run-store.js";
import { TunnelButton } from "../connectivity/TunnelButton.js";

const navigateFn = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/", navigateFn],
}));

// The dialog is lazy and fetches config/status on open; stub it so this unit
// test stays focused on the button.
vi.mock("../remote-access/RemoteAccessDialog.js", () => ({
  RemoteAccessDialog: ({ onClose, initialRun }: { onClose: () => void; initialRun?: { task: string } | null }) => (
    <div data-testid="gateway-dialog" data-initial-task={initialRun?.task ?? ""}>
      <button type="button" data-testid="gateway-dialog-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

beforeEach(() => {
  reachabilityStore.reset();
  pairingApprovalStore.setPending([]);
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  navigateFn.mockReset();
});

const pendingReq = (id: string) => ({ pendingId: id, createdAt: 0, expiresAt: 9e12, attemptsLeft: 3 });

function mockFetch(status: "active" | "inactive" | "unavailable", extra: Record<string, unknown> = {}) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ status, url: status === "active" ? "https://example.zrok.io" : undefined, serverOs: "darwin", ...extra }),
  } as Response);
}

describe("TunnelButton (Remote access)", () => {
  it("renders the button with the network glyph state in its accessible name", () => {
    render(<TunnelButton />);
    const btn = screen.getByTestId("tunnel-btn");
    expect(btn.getAttribute("aria-label")).toBe(btn.title);
    expect(btn.title).toMatch(/^Remote access: /);
  });

  it("F9: click opens the landing in every tunnel state and never navigates away", async () => {
    for (const status of ["unavailable", "inactive", "active"] as const) {
      mockFetch(status);
      render(<TunnelButton />);
      fireEvent.click(screen.getByTestId("tunnel-btn"));
      await waitFor(() => expect(screen.getByTestId("gateway-dialog")).toBeDefined());
      cleanup();
      vi.restoreAllMocks();
    }
    expect(navigateFn).not.toHaveBeenCalled();
  });

  it("F6: a reachability broadcast flips the title without any further request", async () => {
    const spy = mockFetch("inactive", { gateway: { connected: 0, expected: 1 } });
    render(<TunnelButton />);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    act(() => reachabilityStore.set({ resolvedBindHost: "127.0.0.1", pendingBindHost: "127.0.0.1" }));
    await waitFor(() => expect(screen.getByTestId("tunnel-btn").title).toBe("Remote access: this computer only"));
    const calls = spy.mock.calls.length;
    act(() => reachabilityStore.set({ resolvedBindHost: "0.0.0.0", pendingBindHost: "0.0.0.0" }));
    expect(screen.getByTestId("tunnel-btn").title).toBe("Remote access: listening on the network");
    expect(spy.mock.calls.length).toBe(calls);
  });

  it("F7: the badge counts waiting requests and the name says so", () => {
    render(<TunnelButton />);
    expect(screen.queryByTestId("tunnel-btn-badge")).toBeNull();
    act(() => pairingApprovalStore.setPending([pendingReq("a"), pendingReq("b")]));
    expect(screen.getByTestId("tunnel-btn-badge").textContent).toBe("2");
    expect(screen.getByTestId("tunnel-btn").getAttribute("aria-label")).toContain("2 devices waiting");
  });

  it("partial (zrok down, tailscale up) → partial tone", async () => {
    mockFetch("inactive", { gateway: { connected: 1, expected: 2 } });
    render(<TunnelButton />);
    await waitFor(() => expect(screen.getByTestId("tunnel-btn").getAttribute("data-tone")).toBe("partial"));
  });

  it("a gated status with a failed provider turns the button red", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async (url: RequestInfo | URL) => {
      const body = url.toString().includes("-detail")
        ? { status: "inactive", serverOs: "d", providers: [{ provider: "zrok", primary: true, state: "failed", error: "name taken" }], gateway: { connected: 0, expected: 1 } }
        : { status: "inactive", serverOs: "d", gateway: { connected: 0, expected: 1 } };
      return { ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response;
    }) as typeof fetch);
    render(<TunnelButton />);
    await waitFor(() => expect(screen.getByTestId("tunnel-btn").getAttribute("data-tone")).toBe("failed"));
  });

  it("X8: a stored run younger than two minutes reopens the dialog on that task, and the key is removed", async () => {
    mockFetch("inactive");
    sessionStorage.setItem(RUN_KEY, JSON.stringify({ task: "lan", done: ["bind"], at: Date.now() - 5_000 }));
    render(<TunnelButton />);
    const dlg = await screen.findByTestId("gateway-dialog");
    expect(dlg.getAttribute("data-initial-task")).toBe("lan");
    expect(sessionStorage.getItem(RUN_KEY)).toBeNull();
  });
});
