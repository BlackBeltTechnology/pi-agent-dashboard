/**
 * Resume after the Listen-on-network restart. Test-plan #X4, #E18.
 * See change: add-remote-access-wizard (design D4).
 */
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairingApprovalStore } from "../../../lib/pairing/pairing-approval-store.js";
import { reachabilityStore } from "../../../lib/remote-access/reachability-store.js";
import { RUN_KEY } from "../../../lib/remote-access/run-store.js";
import { TunnelButton } from "../../connectivity/TunnelButton.js";
import { baseConfig, mockApi, reach } from "./harness.js";

vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));

beforeEach(() => {
  reachabilityStore.reset();
  pairingApprovalStore.setPending([]);
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const store = (ageMs: number) => sessionStorage.setItem(RUN_KEY, JSON.stringify({ task: "lan", done: ["bind"], at: Date.now() - ageMs }));

describe("resume", () => {
  it("X4: after the server returns listening on 0.0.0.0 the dialog is on the same task, Listen done, Let devices ask current", async () => {
    mockApi({ config: baseConfig({ reachability: reach("0.0.0.0") }) });
    store(3_000);
    render(<TunnelButton />);
    await waitFor(() => expect(screen.getByTestId("remote-access-step-bind").getAttribute("data-state")).toBe("done"));
    expect(screen.getByTestId("remote-access-step-accept").getAttribute("data-state")).toBe("current");
    expect(sessionStorage.getItem(RUN_KEY)).toBeNull();
  });

  it("X4: a reconnect that changes the RESOLVED bind host triggers the resume (a save alone does not)", async () => {
    mockApi({ config: baseConfig({ reachability: reach("0.0.0.0") }) });
    reachabilityStore.set({ resolvedBindHost: "127.0.0.1", pendingBindHost: "127.0.0.1" });
    render(<TunnelButton />);
    expect(screen.queryByTestId("gateway-dialog")).toBeNull();
    store(2_000);
    act(() => reachabilityStore.set({ resolvedBindHost: "127.0.0.1", pendingBindHost: "0.0.0.0" }));
    expect(screen.queryByTestId("gateway-dialog")).toBeNull();
    expect(sessionStorage.getItem(RUN_KEY)).not.toBeNull();
    act(() => reachabilityStore.set({ resolvedBindHost: "0.0.0.0", pendingBindHost: "0.0.0.0" }));
    expect(await screen.findByTestId("gateway-dialog")).toBeDefined();
    expect(sessionStorage.getItem(RUN_KEY)).toBeNull();
  });

  it("E18: a run 119 s old reopens the dialog; one 121 s old does not; the key is removed either way", async () => {
    mockApi();
    store(119_000);
    render(<TunnelButton />);
    expect(await screen.findByTestId("gateway-dialog")).toBeDefined();
    expect(sessionStorage.getItem(RUN_KEY)).toBeNull();
    cleanup();

    store(121_000);
    render(<TunnelButton />);
    await waitFor(() => expect(sessionStorage.getItem(RUN_KEY)).toBeNull());
    expect(screen.queryByTestId("gateway-dialog")).toBeNull();
  });
});
