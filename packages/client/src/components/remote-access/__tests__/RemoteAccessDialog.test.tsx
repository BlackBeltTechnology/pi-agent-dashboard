/**
 * Remote access dialog: landing, step rendering, exposure copy, refusals.
 * Test-plan #F3 #F4 #F8 #F10 #E12 #E17 #X1 #X2 #X3 #X8.
 * See change: add-remote-access-wizard.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairingApprovalStore } from "../../../lib/pairing/pairing-approval-store.js";
import { reachabilityStore } from "../../../lib/remote-access/reachability-store.js";
import { RUN_KEY } from "../../../lib/remote-access/run-store.js";
import type { RunState } from "../../../lib/remote-access/steps.js";
import { baseConfig, mockApi, READY, reach, renderDialog } from "./harness.js";

const navigateFn = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/", navigateFn] }));
vi.mock("../../Gateway/GatewayPairQR.js", () => ({
  GatewayPairQR: () => <div data-testid="stub-pair-qr" />,
  QrCanvas: ({ text }: { text: string }) => <canvas data-testid="gateway-qr-canvas" data-qr-text={text} />,
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

const run = (task: RunState["task"], extra: Partial<RunState> = {}): RunState => ({ task, done: [], ...extra });
const connectedZrok = { status: "active", url: "https://robson-home.shares.zrok.io", serverOs: "darwin", connectedProviders: ["zrok"], providers: [{ provider: "zrok", primary: true, state: "connected" }] };
const request = (id: string) => ({ pendingId: id, createdAt: 0, expiresAt: 9e12, attemptsLeft: 3, userAgent: "Mozilla/5.0 (iPhone) Safari" });

describe("landing", () => {
  it("shows the three roads and the four tasks", async () => {
    mockApi();
    renderDialog();
    await waitFor(() => expect(screen.getByTestId("remote-access-road-lan-state").textContent).toMatch(/Off/));
    expect(screen.getByTestId("remote-access-road-local")).toBeDefined();
    expect(screen.getByTestId("remote-access-road-internet").textContent).toMatch(/Off/);
    for (const id of ["share", "device", "lan", "connect"]) expect(screen.getByTestId(`remote-access-task-${id}`)).toBeDefined();
  });

  it("F8: Review on the landing callout raises the approval dialog for that request, un-dismissed", async () => {
    mockApi();
    pairingApprovalStore.setPending([request("p1")]);
    pairingApprovalStore.dismiss("p1");
    renderDialog();
    fireEvent.click(await screen.findByTestId("remote-access-review"));
    expect(pairingApprovalStore.getState().preferred).toBe("p1");
    expect(pairingApprovalStore.getState().dismissed.has("p1")).toBe(false);
  });

  it("F10: All network settings closes the dialog and navigates; Disconnect posts then reads Off", async () => {
    const { calls, state } = mockApi({ status: connectedZrok });
    const onClose = vi.fn();
    renderDialog({ onClose });
    await waitFor(() => expect(screen.getByTestId("remote-access-road-internet").textContent).toMatch(/On/));
    fireEvent.click(screen.getByTestId("remote-access-disconnect"));
    state.status = { status: "inactive", serverOs: "darwin", connectedProviders: [], providers: [] };
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/api/tunnel-disconnect"))).toBe(true));
    await waitFor(() => expect(screen.getByTestId("remote-access-road-internet").textContent).toMatch(/Off/));
    fireEvent.click(screen.getByTestId("remote-access-all-settings"));
    expect(onClose).toHaveBeenCalled();
    expect(navigateFn).toHaveBeenCalledWith("/settings/gateway");
  });

  it("starting a task opens its wizard with 'step K of N' in the title", async () => {
    mockApi();
    renderDialog();
    fireEvent.click(await screen.findByTestId("remote-access-task-lan"));
    expect(await screen.findByTestId("remote-access-wizard")).toBeDefined();
    expect(screen.getByText(/step 1 of 3/)).toBeDefined();
  });
});

describe("step rendering", () => {
  const zrokReady = () =>
    mockApi({
      config: baseConfig({ tunnel: { provider: "zrok", mode: "public", zrok: { persistent: true, reservedName: "robson-home" } } }),
      readiness: [READY("zrok", "disconnected")],
    });

  it("F4: four satisfied steps fold; expanding then re-opening one shows its value", async () => {
    zrokReady();
    renderDialog({ run: run("share") });
    const fold = await screen.findByTestId("remote-access-fold");
    expect(fold.textContent).toMatch(/4 steps already set/);
    expect(screen.getByTestId("remote-access-step-body-connect")).toBeDefined();
    fireEvent.click(fold.querySelector("button") as HTMLElement);
    fireEvent.click(await screen.findByTestId("remote-access-step-open-address"));
    const body = await screen.findByTestId("remote-access-step-body-address");
    expect((within(body).getByTestId("gateway-reserved-input") as HTMLInputElement).value).toBe("robson-home");
  });

  it("F3: the LAN consequence precedes the primary action in DOM order and names open networks", async () => {
    mockApi({ config: baseConfig({ trustedNetworks: ["192.168.16.0/24"] }) });
    renderDialog({ run: run("lan") });
    const consequence = await screen.findByTestId("remote-access-bind-consequence");
    for (const re of [/every network/, /plain http/, /unencrypted/, /restarts/, /192\.168\.16\.0\/24/]) expect(consequence.textContent).toMatch(re);
    const primary = screen.getByTestId("remote-access-listen");
    expect(consequence.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("E12: Choose provider writes the pick unless the primary is connected", async () => {
    // (none) → PUT
    let { calls } = mockApi({ config: baseConfig({ tunnel: {} }), readiness: [READY("tailscale", "disconnected"), READY("zrok", "disconnected")] });
    renderDialog({ run: run("share") });
    fireEvent.click(await screen.findByTestId("gateway-provider-tailscale"));
    fireEvent.click(screen.getByTestId("gateway-save"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && JSON.stringify(c.body).includes("tailscale"))).toBe(true));
    cleanup();
    vi.restoreAllMocks();

    // zrok primary, not connected → PUT
    ({ calls } = mockApi({ readiness: [READY("tailscale", "disconnected"), READY("zrok", "disconnected")] }));
    renderDialog({ run: run("share", { open: "provider" }) });
    fireEvent.click(await screen.findByTestId("gateway-provider-tailscale"));
    fireEvent.click(screen.getByTestId("gateway-save"));
    await waitFor(() => expect(calls.some((c) => c.method === "PUT" && JSON.stringify(c.body).includes("tailscale"))).toBe(true));
    cleanup();
    vi.restoreAllMocks();

    // zrok primary AND connected → no PUT, explanation + Settings link
    ({ calls } = mockApi({ status: connectedZrok, readiness: [READY("tailscale", "disconnected"), READY("zrok", "connected")] }));
    renderDialog({ run: run("share", { open: "provider" }) });
    fireEvent.click(await screen.findByTestId("gateway-provider-tailscale"));
    fireEvent.click(screen.getByTestId("gateway-save"));
    expect(await screen.findByTestId("remote-access-provider-blocked")).toBeDefined();
    expect(screen.getByTestId("remote-access-provider-settings-link")).toBeDefined();
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
    expect(screen.queryByTestId("gateway-make-primary-zrok")).toBeNull();
    expect(screen.queryByTestId("gateway-make-primary-tailscale")).toBeNull();
  });

  it("E17: Open it on the device follows the endpoint's transport", async () => {
    const https = { kind: "public", url: "https://robson-home.shares.zrok.io", tls: true };
    mockApi({ status: connectedZrok, endpoints: [https] });
    renderDialog({ run: run("device") });
    expect(await screen.findByTestId("stub-pair-qr")).toBeDefined();
    cleanup();
    vi.restoreAllMocks();

    const lan = { kind: "lan", url: "http://192.168.16.220:8000", tls: false };
    mockApi({ config: baseConfig({ pairing: { acceptLanRequests: true }, reachability: reach("0.0.0.0") }), endpoints: [lan] });
    renderDialog({ run: run("device") });
    const qr = await screen.findByTestId("gateway-qr-canvas");
    expect(qr.getAttribute("data-qr-text")).toBe("http://192.168.16.220:8000");
    expect(screen.getByTestId("remote-access-qr-lan").textContent).toMatch(/Request access/);
    expect(screen.queryByTestId("stub-pair-qr")).toBeNull();
    cleanup();
    vi.restoreAllMocks();

    const mesh = { kind: "mesh", url: "http://10.147.17.5:8000", tls: false };
    mockApi({ status: { status: "unavailable", serverOs: "darwin", connectedProviders: ["zerotier"], providers: [] }, endpoints: [mesh] });
    renderDialog({ run: run("device") });
    expect((await screen.findByTestId("remote-access-qr-needs-https")).textContent).toMatch(/https address or the same Wi-Fi/);
    expect(screen.queryByTestId("gateway-qr-canvas")).toBeNull();
  });

  it("F8: Review in the Approve step raises the approval dialog for that request", async () => {
    mockApi({ status: connectedZrok, endpoints: [{ kind: "public", url: "https://robson-home.shares.zrok.io", tls: true }] });
    pairingApprovalStore.setPending([request("p9")]);
    pairingApprovalStore.dismiss("p9");
    renderDialog({ run: run("device", { done: ["qr"] }) });
    fireEvent.click(await screen.findByTestId("pairing-waiting-review"));
    expect(pairingApprovalStore.getState().preferred).toBe("p9");
  });

  it("X8: a provider that failed to connect keeps Go online current with the reason", async () => {
    mockApi({
      config: baseConfig({ tunnel: { provider: "zrok", mode: "public", zrok: { persistent: false } } }),
      readiness: [READY("zrok", "disconnected")],
      status: { status: "inactive", serverOs: "darwin", connectedProviders: [], providers: [{ provider: "zrok", primary: true, state: "failed", error: "zrok: name taken" }], gateway: { connected: 0, expected: 1 } },
    });
    renderDialog({ run: run("share") });
    const body = await screen.findByTestId("remote-access-step-body-connect");
    expect(await within(body).findByText(/name taken/)).toBeDefined();
    expect(screen.getByTestId("remote-access-step-connect").getAttribute("data-state")).toBe("current");
  });
});

describe("Listen on network", () => {
  it("X1: a refused write says so, never restarts, leaves the step current and stores nothing", async () => {
    const { calls } = mockApi({ routes: { "PUT /api/config": [403, { success: false, error: "forbidden" }] } });
    renderDialog({ run: run("lan") });
    fireEvent.click(await screen.findByTestId("remote-access-listen"));
    expect((await screen.findByTestId("gateway-dialog-error")).textContent).toMatch(/not allowed to make the change/);
    expect(calls.some((c) => c.url.includes("/api/restart"))).toBe(false);
    expect(screen.getByTestId("remote-access-step-bind").getAttribute("data-state")).toBe("current");
    expect(sessionStorage.getItem(RUN_KEY)).toBeNull();
  });

  it("X2: a pinned bind names its source and offers no action", async () => {
    const { calls } = mockApi({ config: baseConfig({ reachability: reach("127.0.0.1", "127.0.0.1", "env") }) });
    renderDialog({ run: run("lan") });
    const pinned = await screen.findByTestId("remote-access-bind-pinned");
    expect(pinned.textContent).toMatch(/PI_DASHBOARD_HOST/);
    expect(pinned.textContent).toMatch(/127\.0\.0\.1/);
    expect(screen.queryByTestId("remote-access-listen")).toBeNull();
    expect(screen.queryByTestId("remote-access-restart")).toBeNull();
    expect(calls.some((c) => c.method === "PUT" || c.url.includes("/api/restart"))).toBe(false);
  });

  it("X3: a refused restart reads 'restart pending' with Restart, and no resume stays stored", async () => {
    const { calls } = mockApi({ routes: { "POST /api/restart": [500, { success: false, error: "boom" }] } });
    renderDialog({ run: run("lan") });
    fireEvent.click(await screen.findByTestId("remote-access-listen"));
    expect(await screen.findByTestId("remote-access-restart-pending")).toBeDefined();
    expect(screen.getByTestId("remote-access-restart")).toBeDefined();
    expect(sessionStorage.getItem(RUN_KEY)).toBeNull();
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ bindHost: "0.0.0.0" });
  });

  it("a successful restart stores the run (bind marked done) for the resume", async () => {
    mockApi();
    renderDialog({ run: run("lan") });
    fireEvent.click(await screen.findByTestId("remote-access-listen"));
    await screen.findByTestId("remote-access-restarting");
    const stored = JSON.parse(sessionStorage.getItem(RUN_KEY) ?? "{}");
    expect(stored.task).toBe("lan");
    expect(stored.done).toContain("bind");
  });

  it("F2-like: a server that already binds all interfaces collapses Listen on network", async () => {
    mockApi({ config: baseConfig({ reachability: reach("0.0.0.0", "0.0.0.0", "env") }) });
    renderDialog({ run: run("lan") });
    const row = await screen.findByTestId("remote-access-step-open-bind");
    expect(row.textContent).toMatch(/all networks \(0\.0\.0\.0\)/);
    expect(screen.getByTestId("remote-access-step-accept").getAttribute("data-state")).toBe("current");
    act(() => undefined);
  });
});

describe("scenario steps", () => {
  it("Temporary address saves tunnel.zrok.persistent=false and Go online becomes current", async () => {
    const { calls, state } = mockApi({ readiness: [READY("zrok", "disconnected")] });
    renderDialog({ run: run("share") });
    fireEvent.click(await screen.findByTestId("remote-access-temporary-address"));
    await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ tunnel: { zrok: { persistent: false } } }));
    // The server now reports the choice; the next read converges.
    state.config = baseConfig({ tunnel: { provider: "zrok", mode: "public", zrok: { persistent: false } } });
    await waitFor(() => expect(screen.getByTestId("remote-access-step-connect").getAttribute("data-state")).toBe("current"));
  });

  it("Who may enter names the open networks, links to Security, and 'continue anyway' is for this run only", async () => {
    mockApi({
      config: baseConfig({ trustedNetworks: ["192.168.16.0/24"], tunnel: { provider: "zrok", mode: "public", zrok: { persistent: true, reservedName: "robson-home" } } }),
      readiness: [READY("zrok", "connected")],
      status: connectedZrok,
    });
    renderDialog({ run: run("share") });
    const warning = await screen.findByTestId("remote-access-door-warning");
    expect(warning.textContent).toMatch(/1 network/);
    expect(warning.textContent).toMatch(/192\.168\.16\.0\/24/);
    fireEvent.click(screen.getByTestId("remote-access-who-may-enter-security-link"));
    expect(navigateFn).toHaveBeenCalledWith("/settings/security");
    fireEvent.click(screen.getByTestId("remote-access-door-continue"));
    await waitFor(() => expect(screen.queryByTestId("remote-access-step-body-door")).toBeNull());
  });

  it("the landing warns about networks admitted without authentication", async () => {
    mockApi({ config: baseConfig({ trustedNetworks: ["192.168.16.0/24", "10.0.0.0/8"] }) });
    renderDialog();
    expect((await screen.findByTestId("remote-access-open-warning")).textContent).toMatch(/2 network/);
  });

  it("Where is the device: with no road it asks, and the chosen branch inserts its steps", async () => {
    mockApi();
    renderDialog({ run: run("device") });
    fireEvent.click(await screen.findByTestId("remote-access-branch-wifi"));
    await waitFor(() => expect(screen.getByTestId("remote-access-step-bind")).toBeDefined());
    expect(screen.getByTestId("remote-access-step-accept")).toBeDefined();
    expect(screen.queryByTestId("remote-access-step-provider")).toBeNull();
    expect(screen.queryByTestId("remote-access-step-door")).toBeNull();
  });

  it("Approve: when the request leaves the pending list, one new paired device completes the step, naming it", async () => {
    let paired: unknown[] = [];
    mockApi({
      status: connectedZrok,
      endpoints: [{ kind: "public", url: "https://robson-home.shares.zrok.io", tls: true }],
      routes: { "GET /api/paired-devices": () => [200, { success: true, data: paired }] },
    });
    renderDialog({ run: run("device") });
    await screen.findByTestId("stub-pair-qr");
    act(() => pairingApprovalStore.setPending([request("p1")]));
    await waitFor(() => expect(screen.getByTestId("remote-access-step-approve").getAttribute("data-state")).toBe("current"));
    paired = [{ id: "d2", label: "iPhone · Safari" }];
    act(() => pairingApprovalStore.setPending([]));
    expect((await screen.findByTestId("remote-access-approve-paired")).textContent).toBe("iPhone · Safari is paired.");
  });

  it("Approve: a request that leaves with no new device reads denied or expired and offers to start over", async () => {
    mockApi({ status: connectedZrok, endpoints: [{ kind: "public", url: "https://robson-home.shares.zrok.io", tls: true }] });
    renderDialog({ run: run("device") });
    await screen.findByTestId("stub-pair-qr");
    act(() => pairingApprovalStore.setPending([request("p1")]));
    await waitFor(() => expect(screen.getByTestId("remote-access-step-approve").getAttribute("data-state")).toBe("current"));
    act(() => pairingApprovalStore.setPending([]));
    expect((await screen.findByTestId("remote-access-approve-denied")).textContent).toMatch(/Denied or expired/);
    fireEvent.click(screen.getByTestId("remote-access-approve-restart"));
    await waitFor(() => expect(screen.getByTestId("remote-access-step-qr").getAttribute("data-state")).toBe("current"));
  });

  it("a satisfied step completed during the run folds as 'done', not 'already set'", async () => {
    // Install is unsatisfied now; the readiness read then reports it installed.
    const api = mockApi({ readiness: [READY("zrok", "not-installed")] });
    renderDialog({ run: run("share") });
    await screen.findByTestId("remote-access-step-body-install");
    api.calls.length = 0;
    vi.mocked(globalThis.fetch).mockImplementation(((url: RequestInfo | URL) => {
      const u = url.toString();
      const body = u.includes("/api/tunnel-readiness")
        ? { success: true, data: { providers: [READY("zrok", "disconnected")] } }
        : u.includes("/api/config")
          ? { success: true, data: baseConfig() }
          : u.includes("/api/tunnel-status")
            ? { status: "inactive", serverOs: "darwin", connectedProviders: [] }
            : { success: true, data: { endpoints: [] } };
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);
    }) as typeof fetch);
    fireEvent.click(screen.getByTestId("remote-access-recheck"));
    await waitFor(() => expect(screen.getByTestId("remote-access-fold").textContent).toMatch(/steps done/));
  });
});
