/**
 * Connect to another machine — the four steps. Test-plan #E14 #E15 #E16 #X5 #X6 #X9.
 * See change: add-remote-access-wizard.
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairingApprovalStore } from "../../../lib/pairing/pairing-approval-store.js";
import { reachabilityStore } from "../../../lib/remote-access/reachability-store.js";
import type { RunState } from "../../../lib/remote-access/steps.js";
import { jsonRes, mockApi, renderDialog } from "./harness.js";

vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
const challengeIdentity = vi.fn();
const knockServer = vi.fn();
vi.mock("../../../lib/pairing/pair-protocol.js", () => ({ challengeIdentity: (...a: unknown[]) => challengeIdentity(...a) }));
vi.mock("../../../lib/pairing/knock.js", () => ({ knockServer: (...a: unknown[]) => knockServer(...a) }));

beforeEach(() => {
  reachabilityStore.reset();
  pairingApprovalStore.setPending([]);
  sessionStorage.clear();
  challengeIdentity.mockReset();
  knockServer.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as unknown as { piDashboard?: unknown }).piDashboard;
});

const task = (extra: Partial<RunState> = {}): RunState => ({ task: "connect", done: [], ...extra });
const known = (over: Record<string, unknown> = {}) => ({ host: "macbook.local", port: 8000, label: "MacBook", addedAt: "2026-01-01", ...over });

function withServers(knownList: unknown[], discovered: unknown[] = [], extra: Record<string, [number, unknown]> = {}) {
  return mockApi({
    routes: {
      "GET /api/known-servers": [200, { success: true, data: knownList, canManage: true }],
      "POST /api/discover-servers": [200, { success: true, data: discovered }],
      "POST /api/known-servers/probe": [200, { success: true, data: { status: "reachable" } }],
      ...extra,
    },
  });
}

describe("Which machine", () => {
  it("E14: a typed address matching a known server is used and not re-posted", async () => {
    const { calls } = withServers([known()]);
    renderDialog({ run: task() });
    fireEvent.change(await screen.findByTestId("remote-access-machine-input"), { target: { value: "MacBook.local:8000" } });
    await waitFor(() => expect(screen.getAllByTestId("remote-access-machine-known").length).toBe(1));
    fireEvent.click(screen.getByTestId("remote-access-machine-continue"));
    await waitFor(() => expect(screen.getByTestId("remote-access-step-machine").getAttribute("data-state")).toBe("done"));
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/known-servers"))).toBe(false);
  });

  it("E14: an unknown address is added (POST) before probing", async () => {
    const { calls } = withServers([], [], { "POST /api/known-servers": [200, { success: true, data: {} }] });
    renderDialog({ run: task() });
    fireEvent.change(await screen.findByTestId("remote-access-machine-input"), { target: { value: "192.168.16.204:8000" } });
    fireEvent.click(screen.getByTestId("remote-access-machine-continue"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/known-servers"))).toBe(true));
    await waitFor(() => expect(calls.some((c) => c.url.includes("/api/known-servers/probe"))).toBe(true));
  });

  it("E15: a discovered server that is not known reads 'found on this network' and is not probed", async () => {
    const { calls } = withServers([], [{ host: "nuc.local", port: 8000, piPort: 9999, version: "1", pid: 1, isLocal: false }]);
    renderDialog({ run: task() });
    const row = await screen.findByTestId("remote-access-machine-discovered");
    expect(row.textContent).toMatch(/found on this network/);
    expect(calls.some((c) => c.url.includes("/api/known-servers/probe"))).toBe(false);
  });

  it("X9: an identity change stops the task, names it, and sends no probe", async () => {
    const { calls } = withServers([], [], { "POST /api/known-servers": [409, { success: false, error: "identity_changed" }] });
    renderDialog({ run: task() });
    fireEvent.change(await screen.findByTestId("remote-access-machine-input"), { target: { value: "10.0.0.9:8000" } });
    fireEvent.click(screen.getByTestId("remote-access-machine-continue"));
    expect((await screen.findByTestId("remote-access-machine-stopped")).textContent).toMatch(/identity changed/);
    expect(calls.some((c) => c.url.includes("/api/known-servers/probe"))).toBe(false);
  });
});

describe("Check it can be reached", () => {
  const fixture = (created: boolean) => {
    // Machine step done in this run; `created` decides whether the entry pre-existed.
    return withServers(created ? [] : [known()], [], {
      "POST /api/known-servers": [200, { success: true, data: {} }],
      "POST /api/known-servers/probe": [200, { success: true, data: { status: "timeout" } }],
    });
  };
  const toReach = async (created: boolean) => {
    fixture(created);
    renderDialog({ run: task() });
    fireEvent.change(await screen.findByTestId("remote-access-machine-input"), { target: { value: created ? "10.0.0.9:8000" : "macbook.local:8000" } });
    if (!created) await waitFor(() => expect(screen.getAllByTestId("remote-access-machine-known").length).toBe(1));
    fireEvent.click(screen.getByTestId("remote-access-machine-continue"));
    return screen.findByTestId("remote-access-reach-failed");
  };

  it("X5: a failed probe shows its reason, does not advance, and offers Remove only for an entry this run created", async () => {
    const failed = await toReach(true);
    expect(failed.textContent).toMatch(/timeout/);
    expect(screen.getByTestId("remote-access-step-reach").getAttribute("data-state")).toBe("current");
    expect(screen.getByTestId("remote-access-reach-remove")).toBeDefined();
    cleanup();
    vi.restoreAllMocks();
    const failed2 = await toReach(false);
    expect(failed2.textContent).toMatch(/timeout/);
    expect(screen.queryByTestId("remote-access-reach-remove")).toBeNull();
  });
});

describe("Ask that machine for access", () => {
  const atAsk = async (knownEntry: Record<string, unknown>) => {
    withServers([knownEntry]);
    renderDialog({ run: task() });
    fireEvent.change(await screen.findByTestId("remote-access-machine-input"), { target: { value: `${knownEntry.host}:${knownEntry.port}` } });
    await waitFor(() => expect(screen.getAllByTestId("remote-access-machine-known").length).toBe(1));
    fireEvent.click(screen.getByTestId("remote-access-machine-continue"));
  };

  it("X6: a browser opens the remote request page with no opener, says it is unverified, and offers a new tab at the end", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await atAsk(known({ host: "192.168.16.204" }));
    fireEvent.click(await screen.findByTestId("remote-access-ask-open"));
    expect(open).toHaveBeenCalledWith("http://192.168.16.204:8000/pair?request", "_blank", "noopener");
    expect((await screen.findByTestId("remote-access-ask-unverified")).textContent).toMatch(/cannot verify/);
    fireEvent.click(screen.getByTestId("remote-access-ask-approved"));
    fireEvent.click(await screen.findByTestId("remote-access-finish-open"));
    expect(open).toHaveBeenLastCalledWith("http://192.168.16.204:8000", "_blank", "noopener");
  });

  describe("desktop app", () => {
    const desktop = () => {
      (window as unknown as { piDashboard: unknown }).piDashboard = { openServerWindow: vi.fn().mockResolvedValue({ ok: true }) };
    };

    it("E16: knocks when the proven fingerprint equals the pin", async () => {
      desktop();
      challengeIdentity.mockResolvedValue({ fingerprint: "sha256:F", publicKey: "k", verified: true });
      knockServer.mockImplementation(async (_o, _fp, _n, hooks) => {
        hooks.onWaiting({ pendingId: "x", confirmCode: "12345678", expiresAt: 1 });
        return new Promise(() => {});
      });
      await atAsk(known({ fingerprint: "sha256:F" }));
      fireEvent.click(await screen.findByTestId("remote-access-ask-run"));
      await waitFor(() => expect(knockServer).toHaveBeenCalledWith("http://macbook.local:8000", "sha256:F", expect.any(String), expect.anything()));
      expect((await screen.findByTestId("remote-access-ask-waiting")).textContent).toMatch(/12345678/);
    });

    it("E16: never knocks when the proven fingerprint differs from the pin", async () => {
      desktop();
      challengeIdentity.mockResolvedValue({ fingerprint: "sha256:G", publicKey: "k", verified: true });
      await atAsk(known({ fingerprint: "sha256:F" }));
      fireEvent.click(await screen.findByTestId("remote-access-ask-run"));
      expect((await screen.findByTestId("remote-access-ask-error")).textContent).toMatch(/mismatch/i);
      expect(knockServer).not.toHaveBeenCalled();
    });

    it("E16: with no pin and no advert it shows the proven fingerprint and knocks only after confirmation", async () => {
      desktop();
      challengeIdentity.mockResolvedValue({ fingerprint: "sha256:H", publicKey: "k", verified: true });
      knockServer.mockResolvedValue({ status: "approved", token: "t", fingerprint: "sha256:H" });
      await atAsk(known());
      fireEvent.click(await screen.findByTestId("remote-access-ask-run"));
      expect((await screen.findByTestId("remote-access-ask-fingerprint")).textContent).toBe("sha256:H");
      expect(knockServer).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("remote-access-ask-confirm"));
      await waitFor(() => expect(knockServer).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByTestId("remote-access-step-finish").getAttribute("data-state")).toBe("current"));
    });
  });
});

void jsonRes;
