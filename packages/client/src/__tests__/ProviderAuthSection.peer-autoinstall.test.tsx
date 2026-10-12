/**
 * Anthropic row: trigger scope, never-blocking sign-in, and the auto-install
 * surface (precedence vs. the missing-peer hint, failure rendering, Retry).
 * See change: streamline-first-run (test-plan E25, E26, F5, F6, F7, X7).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthSection } from "../components/settings/ProviderAuthSection.js";
import { ANTHROPIC_PEER_SOURCE } from "../lib/package/anthropic-peer.js";
import { packageQueue } from "../lib/package/package-queue.js";
import { peerAutoInstallStore } from "../lib/package/peer-auto-install-store.js";

const PEER_KEY = "@pi/anthropic-messages";
const ANTHROPIC = { id: "anthropic", name: "Anthropic", flowType: "auth_code" };
const SECOND = { id: "second-oauth", name: "Second Prov", flowType: "auth_code" };

interface Ctl {
  /** Providers currently configured (authenticated). */
  configured: Set<string>;
  peer?: { ok: boolean; reason?: string };
  recommendedHangs: boolean;
  installPosts: number;
  /** Provider ids a completing flow poll marks configured. */
  completing: string[];
}
let ctl: Ctl;

function row(p: { id: string; name: string; flowType: string }) {
  const on = ctl.configured.has(p.id);
  return { ...p, authenticated: on, configured: on };
}

const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as any;

function statusBody(): unknown[] {
  const rows: unknown[] = [row(ANTHROPIC), row(SECOND)];
  // The API-key row only exists once configured (the dialog picker lists unconfigured ones).
  if (ctl.configured.has("anthropic-api")) {
    rows.push({ id: "anthropic-api", name: "Anthropic API", flowType: "api_key", authenticated: true, configured: true, maskedKey: "sk-…xyz", source: "stored" });
  }
  return rows;
}

function healthBody() {
  return {
    plugins: ctl.peer ? [{ id: "flows-anthropic-bridge", lastProbe: { peers: { [PEER_KEY]: ctl.peer } } }] : [],
  };
}

async function route(url: string, init?: any) {
  if (url.includes("/api/provider-auth/status")) return ok(statusBody());
  if (url.includes("/api/provider-auth/catalogue-ready")) return ok({ ready: true });
  if (url.includes("/api/provider-auth/start")) return ok({ flowId: "flow-1", status: "pending", authUrl: "https://example.test/oauth" });
  if (url.includes("/api/provider-auth/flow/")) {
    // Completing a poll configures whichever providers the test marks via `completing`.
    for (const id of ctl.completing) ctl.configured.add(id);
    return ok({ flowId: "flow-1", status: "complete" });
  }
  if (url.includes("/api/provider-auth/") && init?.method === "PUT") return ok({ ok: true });
  if (url.includes("/api/providers")) return ok({ success: true, providers: {}, health: {} });
  if (url.includes("/api/packages/install")) {
    ctl.installPosts++;
    return ok({ success: true, data: { operationId: `op-${ctl.installPosts}` } });
  }
  if (url.includes("/api/packages/recommended")) {
    if (ctl.recommendedHangs) return await new Promise(() => {});
    return ok({ success: true, data: { recommended: [{ id: "pi-anthropic-messages", activeInPi: false }] } });
  }
  if (url.includes("/api/health")) return ok(healthBody());
  return ok({});
}

function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(route));
}

beforeEach(() => {
  ctl = { configured: new Set(), recommendedHangs: false, installPosts: 0, completing: [] };
  vi.useFakeTimers({ shouldAdvanceTime: true });
  packageQueue.__resetForTests();
  peerAutoInstallStore.__resetForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  packageQueue.__resetForTests();
  peerAutoInstallStore.__resetForTests();
});

async function signIn(name: string, providerId: string) {
  ctl.completing = [providerId];
  fireEvent.click(await screen.findByTestId("add-provider-button"));
  fireEvent.click(await screen.findByText(name));
  fireEvent.click(await screen.findByTestId("dialog-sign-in"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
}

describe("trigger scope (E25)", () => {
  it("anthropic subscription completion decides exactly once", async () => {
    const spy = vi.spyOn(peerAutoInstallStore, "ensureInstall").mockResolvedValue();
    stubFetch();
    render(<ProviderAuthSection />);
    await signIn("Anthropic", "anthropic");
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith("sign-in");
  });

  it("other providers, API-key saves and an already-connected mount never decide", async () => {
    const spy = vi.spyOn(peerAutoInstallStore, "ensureInstall").mockResolvedValue();
    ctl.configured.add("anthropic").add("anthropic-api");
    stubFetch();
    render(<ProviderAuthSection />);
    await screen.findByText("Anthropic API");
    expect(spy).not.toHaveBeenCalled(); // mount with anthropic connected

    await signIn("Second Prov", "second-oauth"); // another provider's completion
    await waitFor(() => expect(document.querySelector('[data-row-id="second-oauth"]')).toBeTruthy());
    expect(spy).not.toHaveBeenCalled();

    // API-key save through the row Edit.
    const apiRow = document.querySelector('[data-row-id="anthropic-api"]') as HTMLElement;
    fireEvent.click(within(apiRow).getByText("Edit"));
    fireEvent.change(within(apiRow).getByPlaceholderText(/API key/i), { target: { value: "sk-new" } });
    fireEvent.click(within(apiRow).getByText("Save"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("sign-in is never blocked (E26)", () => {
  it("deciding state is set in the same tick, the dialog closed and the event dispatched", async () => {
    ctl.recommendedHangs = true;
    stubFetch();
    const events = vi.fn();
    window.addEventListener("provider-auth-event", events);
    render(<ProviderAuthSection />);
    await signIn("Anthropic", "anthropic");
    await waitFor(() => expect(peerAutoInstallStore.getSnapshot().outcome).toBe("deciding"));
    expect(events).toHaveBeenCalled();
    expect(screen.queryByTestId("dialog-sign-in")).toBeNull();
    window.removeEventListener("provider-auth-event", events);
  });
});

describe("auto-install surface", () => {
  function mountConnected() {
    ctl.configured.add("anthropic");
    stubFetch();
    return render(<ProviderAuthSection />);
  }
  const surface = () => screen.queryByTestId("anthropic-peer-autoinstall");
  const hint = () => screen.queryByTestId("anthropic-peer-hint");

  async function setStore(outcome: "running" | "installed" | "failed", message = "npm ERR! code E404") {
    // Drive the real store through its public API.
    ctl.peer = undefined;
    await act(async () => {
      await peerAutoInstallStore.ensureInstall("sign-in");
    });
    expect(peerAutoInstallStore.getSnapshot().outcome).toBe("running");
    if (outcome === "installed") act(() => complete("op-1", true));
    if (outcome === "failed") act(() => complete("op-1", false, message));
  }
  function complete(opId: string, success: boolean, error?: string) {
    window.dispatchEvent(
      new CustomEvent("pi-package-event", {
        detail: { type: "package_operation_complete", operationId: opId, action: "install", source: ANTHROPIC_PEER_SOURCE, success, error },
      }),
    );
  }

  it("F5: a resolving probe clears installed and failed", async () => {
    for (const outcome of ["installed", "failed"] as const) {
      cleanup();
      packageQueue.__resetForTests();
      peerAutoInstallStore.__resetForTests();
      ctl.installPosts = 0;
      ctl.peer = undefined;
      mountConnected();
      await setStore(outcome);
      await waitFor(() => expect(surface()).toBeTruthy());
      ctl.peer = { ok: true };
      fireEvent(window, new Event("focus"));
      await waitFor(() => expect(surface()).toBeNull());
      expect(screen.queryByTestId("anthropic-peer-autoinstall-retry")).toBeNull();
    }
  });

  const PROBES = { none: undefined, missing: { ok: false, reason: "MODULE_NOT_FOUND" }, importFailure: { ok: false, reason: "import failed: x" } } as const;
  const STORES = [null, "running", "installed", "failed"] as const;
  for (const [probeName, probe] of Object.entries(PROBES)) {
    for (const store of STORES) {
      it(`F6: probe=${probeName} × store=${store ?? "null"} → exactly one surface`, async () => {
        mountConnected();
        if (store) await setStore(store === "running" ? "running" : store);
        ctl.peer = probe as Ctl["peer"];
        fireEvent(window, new Event("focus"));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
        const wantHint = probeName === "importFailure" || (probeName === "missing" && store === null);
        const wantAuto = store !== null && probeName !== "importFailure";
        await waitFor(() => {
          expect(!!hint()).toBe(wantHint);
          expect(!!surface()).toBe(wantAuto);
        });
        // At most one install button across both surfaces.
        const installButtons = [
          ...screen.queryAllByText("Install peer"),
          ...screen.queryAllByTestId("anthropic-peer-autoinstall-retry"),
        ];
        expect(installButtons.length).toBeLessThanOrEqual(1);
      });
    }
  }

  it("F7: failed renders the plain sentence first, raw text only behind the log toggle, Sign Out enabled", async () => {
    mountConnected();
    await setStore("failed", "npm ERR! code E404");
    const msg = await screen.findByTestId("anthropic-peer-autoinstall");
    expect(msg.textContent).toMatch(/install didn't finish/i);
    expect(msg.textContent).not.toContain("E404"); // collapsed log block
    const wrapper = msg.closest('[role="status"]');
    expect(wrapper?.getAttribute("aria-live")).toBe("polite");
    const retry = screen.getByTestId("anthropic-peer-autoinstall-retry");
    expect(retry.className).toContain("bg-[var(--bg-tertiary)]");
    expect(retry.className).not.toContain("accent-solid");
    expect((screen.getByText("Sign Out") as HTMLButtonElement).disabled).toBe(false);
    // Expanding the block reveals the raw text.
    fireEvent.click(within(msg).getByTestId("log-block-toggle"));
    await waitFor(() => expect(msg.textContent).toContain("E404"));
  });

  it("X7: the row Retry re-runs the decision and returns to in-progress, then installed", async () => {
    mountConnected();
    await setStore("failed");
    ctl.installPosts = 1;
    fireEvent.click(await screen.findByTestId("anthropic-peer-autoinstall-retry"));
    await waitFor(() => expect(peerAutoInstallStore.getSnapshot().outcome).toBe("running"));
    expect(screen.getByTestId("anthropic-peer-autoinstall").textContent).toMatch(/Installing/);
    act(() => complete("op-2", true));
    await waitFor(() => expect(screen.getByTestId("anthropic-peer-autoinstall").textContent).toMatch(/Peer installed/));
  });
});
