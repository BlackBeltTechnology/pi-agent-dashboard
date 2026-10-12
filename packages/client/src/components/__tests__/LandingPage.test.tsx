import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ANTHROPIC_PEER_SOURCE } from "../../lib/package/anthropic-peer.js";
import { packageQueue } from "../../lib/package/package-queue.js";
import { peerAutoInstallStore } from "../../lib/package/peer-auto-install-store.js";
import { LandingPage } from "../shell/LandingPage.js";

function TestRouter({ children, path = "/" }: { children: React.ReactNode; path?: string }) {
  const { hook } = memoryLocation({ path, static: true });
  return <Router hook={hook}>{children}</Router>;
}

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  packageQueue.__resetForTests();
  peerAutoInstallStore.__resetForTests();
});

function renderPage(props: Partial<React.ComponentProps<typeof LandingPage>> = {}) {
  const navigate = vi.fn();
  const onOpenPinDialog = vi.fn();
  const onSpawnSession = vi.fn();
  const defaults: React.ComponentProps<typeof LandingPage> = {
    providersReady: false,
    pinnedCount: 0,
    sessionsCount: 0,
    firstPinnedCwd: null,
    onOpenPinDialog,
    onSpawnSession,
    navigate,
  };
  const merged = { ...defaults, ...props };
  render(
    <TestRouter>
      <LandingPage {...merged} />
    </TestRouter>,
  );
  return { navigate: merged.navigate, onOpenPinDialog: merged.onOpenPinDialog, onSpawnSession: merged.onSpawnSession };
}

describe("LandingPage onboarding", () => {
  describe("Step 1: credentials", () => {
    it("pending state shows CTA that navigates to /settings/providers", () => {
      const { navigate } = renderPage({ providersReady: false });
      const btn = screen.getByTestId("onboarding-step-1-cta");
      expect((btn as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(btn);
      expect(navigate).toHaveBeenCalledWith("/settings/providers");
    });

    it("done state collapses to checkmark row", () => {
      renderPage({ providersReady: true });
      expect(screen.getByTestId("onboarding-step-1-done")).toBeTruthy();
      expect(screen.queryByTestId("onboarding-step-1-cta")).toBeNull();
    });
  });

  describe("Step 2: add folder", () => {
    it("locked when providersReady=false: lock text, no controls", () => {
      renderPage({ providersReady: false, pinnedCount: 0 });
      expect(screen.queryByTestId("onboarding-step-2-cta")).toBeNull();
      expect(screen.queryByTestId("onboarding-step-2-create")).toBeNull();
      expect(screen.getByTestId("onboarding-step-2-locked").textContent).toMatch(/model provider/i);
    });

    it("pending when providersReady && pinnedCount===0; CTA calls onOpenPinDialog", () => {
      const { onOpenPinDialog } = renderPage({ providersReady: true, pinnedCount: 0 });
      const btn = screen.getByTestId("onboarding-step-2-cta") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      fireEvent.click(btn);
      expect(onOpenPinDialog).toHaveBeenCalledTimes(1);
    });

    it("done state when pinnedCount>0", () => {
      renderPage({ providersReady: true, pinnedCount: 2 });
      expect(screen.getByTestId("onboarding-step-2-done")).toBeTruthy();
      expect(screen.queryByTestId("onboarding-step-2-cta")).toBeNull();
    });
  });

  describe("Step 3: start session", () => {
    it("locked when no folder pinned: lock text, no CTA", () => {
      renderPage({ providersReady: true, pinnedCount: 0, firstPinnedCwd: null });
      expect(screen.queryByTestId("onboarding-step-3-cta")).toBeNull();
      expect(screen.getByTestId("onboarding-step-3-locked").textContent).toMatch(/folder/i);
    });

    it("pending when pinnedCount>0 && sessionsCount===0; CTA calls onSpawnSession(firstPinnedCwd)", () => {
      const { onSpawnSession } = renderPage({
        providersReady: true,
        pinnedCount: 1,
        sessionsCount: 0,
        firstPinnedCwd: "/home/user/repo",
      });
      const btn = screen.getByTestId("onboarding-step-3-cta") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
      fireEvent.click(btn);
      expect(onSpawnSession).toHaveBeenCalledWith("/home/user/repo");
    });

    it("done state when sessionsCount>0", () => {
      renderPage({ providersReady: true, pinnedCount: 1, firstPinnedCwd: "/x", sessionsCount: 3 });
      expect(screen.getByTestId("onboarding-step-3-done")).toBeTruthy();
      expect(screen.queryByTestId("onboarding-step-3-cta")).toBeNull();
    });
  });

  it("renders all three done rows and no CTAs when fully configured", () => {
    renderPage({
      providersReady: true,
      pinnedCount: 3,
      sessionsCount: 2,
      firstPinnedCwd: "/x",
    });
    expect(screen.getByTestId("onboarding-step-1-done")).toBeTruthy();
    expect(screen.getByTestId("onboarding-step-2-done")).toBeTruthy();
    expect(screen.getByTestId("onboarding-step-3-done")).toBeTruthy();
    expect(screen.queryByTestId("onboarding-step-1-cta")).toBeNull();
    expect(screen.queryByTestId("onboarding-step-2-cta")).toBeNull();
    expect(screen.queryByTestId("onboarding-step-3-cta")).toBeNull();
  });

  it("renders pi glyph header", () => {
    renderPage();
    expect(screen.getByText("π")).toBeTruthy();
  });
});


// ── streamline-first-run ─────────────────────────────────────────────────────

const PRIMARY = "bg-[var(--accent-solid)]";
const primaryButtons = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("button")).filter((b) => b.className.includes(PRIMARY));

describe("stepper structure (F8)", () => {
  const COMBOS: Array<[boolean, boolean, boolean]> = [];
  for (const creds of [false, true]) for (const pinned of [false, true]) for (const sessions of [false, true]) COMBOS.push([creds, pinned, sessions]);

  it.each(COMBOS)("creds=%s pinned=%s sessions=%s", (creds, pinned, sessions) => {
    const { hook } = memoryLocation({ path: "/", static: true });
    const { container } = render(
      <Router hook={hook}>
        <LandingPage
          providersReady={creds}
          pinnedCount={pinned ? 1 : 0}
          sessionsCount={sessions ? 1 : 0}
          firstPinnedCwd={pinned ? "/p/x" : null}
          onOpenPinDialog={vi.fn()}
          onSpawnSession={vi.fn()}
          navigate={vi.fn()}
          onCreateProject={vi.fn()}
        />
      </Router>,
    );
    expect(container.querySelectorAll("ol")).toHaveLength(1);
    const s1 = creds ? "done" : "pending";
    const s2 = !creds ? "locked" : pinned ? "done" : "pending";
    const s3 = !pinned ? "locked" : sessions ? "done" : "pending";
    const states = [s1, s2, s3];
    const done = states.filter((x) => x === "done").length;
    expect(screen.getByTestId("onboarding-progress").textContent).toContain(`${done} of 3`);

    const firstPending = states.indexOf("pending");
    const items = Array.from(container.querySelectorAll("ol > li"));
    expect(items).toHaveLength(3);
    // At most one primary button, and only when a step is pending.
    expect(primaryButtons(container)).toHaveLength(firstPending === -1 ? 0 : 1);
    // Only the first pending step is expanded; every other row has no controls.
    items.forEach((li, i) => {
      const expanded = i === firstPending;
      expect(li.getAttribute("data-expanded") === "true", `step ${i + 1} expanded`).toBe(expanded);
      if (!expanded) expect(li.querySelectorAll("button, input"), `step ${i + 1} controls`).toHaveLength(0);
    });
    // A folder pinned before credentials: step 3 names step 1.
    if (!creds && pinned && !sessions) {
      expect(items[2].textContent).toMatch(/step 1/i);
    }
  });

  it("all done: three done rows, no CTA", () => {
    renderPage({ providersReady: true, pinnedCount: 1, sessionsCount: 1, firstPinnedCwd: "/x" });
    expect(screen.getByTestId("onboarding-progress").textContent).toContain("3 of 3");
    expect(document.querySelectorAll("ol > li button")).toHaveLength(0);
  });
});

describe("Step ② create (F9–F12)", () => {
  const ready = { providersReady: true, pinnedCount: 0 };
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  };

  it("F9: Create posts the prefilled name; the secondary link opens the folder browser", async () => {
    const onCreateProject = vi.fn().mockResolvedValue({ ok: true, path: "/home/u/Projects/my-first-project", existed: false });
    const { onOpenPinDialog } = renderPage({ ...ready, onCreateProject });
    expect((screen.getByTestId("onboarding-step-2-name") as HTMLInputElement).value).toBe("my-first-project");
    fireEvent.click(screen.getByTestId("onboarding-step-2-create"));
    await waitFor(() => expect(onCreateProject).toHaveBeenCalledTimes(1));
    expect(onCreateProject).toHaveBeenCalledWith("my-first-project");
    fireEvent.click(screen.getByTestId("onboarding-step-2-cta"));
    expect(onOpenPinDialog).toHaveBeenCalledTimes(1);
  });

  it("F10: in flight disables the form and a second click issues no second request", async () => {
    const d = deferred<{ ok: true; path: string; existed: boolean }>();
    const onCreateProject = vi.fn().mockReturnValue(d.promise);
    renderPage({ ...ready, onCreateProject });
    const create = screen.getByTestId("onboarding-step-2-create") as HTMLButtonElement;
    fireEvent.click(create);
    fireEvent.click(create);
    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect((screen.getByTestId("onboarding-step-2-name") as HTMLInputElement).disabled).toBe(true);
    expect(create.disabled).toBe(true);
    expect((screen.getByTestId("onboarding-step-2-cta") as HTMLButtonElement).disabled).toBe(true);
    expect(create.getAttribute("aria-busy")).toBe("true");
    expect(create.textContent).toMatch(/Creating…/);
    await act(async () => { d.resolve({ ok: true, path: "/p", existed: false }); });
  });

  const REASON_COPY: Array<[string | undefined, RegExp]> = [
    ["invalid_name", /single folder name/i],
    ["reserved_name", /reserved/i],
    ["too_long", /too long/i],
    ["not_a_directory", /already exists/i],
    ["root_not_a_directory", /Projects folder/i],
    ["outside_root", /outside/i],
    ["home_missing", /home folder/i],
    ["fs_error", /permissions/i],
    ["xyz", /couldn't create/i],
    [undefined, /couldn't create/i], // a Fastify 404 body carries no reason
  ];
  it.each(REASON_COPY)("F11: reason %s renders its guidance at the field, keeps the input, pins nothing", async (reason, copy) => {
    const onCreateProject = vi.fn().mockResolvedValue({ ok: false, reason });
    renderPage({ ...ready, onCreateProject });
    const input = screen.getByTestId("onboarding-step-2-name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "my/project" } });
    fireEvent.click(screen.getByTestId("onboarding-step-2-create"));
    const err = await screen.findByTestId("onboarding-step-2-error");
    expect(err.textContent).toMatch(copy);
    // DOM order: label, error, input.
    const label = document.querySelector('label[for="onboarding-step-2-name"]') as HTMLElement;
    expect(label.compareDocumentPosition(err) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(err.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.value).toBe("my/project");
    expect(input.disabled).toBe(false);
    expect((screen.getByTestId("onboarding-step-2-cta") as HTMLButtonElement).disabled).toBe(false);
  });

  it("F12: the existed note lives only as long as the page instance", async () => {
    const onCreateProject = vi.fn().mockResolvedValue({ ok: true, path: "/p/demo", existed: true });
    const { hook } = memoryLocation({ path: "/", static: true });
    const props = { onOpenPinDialog: vi.fn(), onSpawnSession: vi.fn(), navigate: vi.fn(), onCreateProject, providersReady: true, firstPinnedCwd: null };
    const view = render(<Router hook={hook}><LandingPage {...props} pinnedCount={0} /></Router>);
    fireEvent.click(screen.getByTestId("onboarding-step-2-create"));
    await waitFor(() => expect(onCreateProject).toHaveBeenCalled());
    // App pins the folder → pinnedCount rises on the same instance.
    view.rerender(<Router hook={hook}><LandingPage {...props} pinnedCount={1} firstPinnedCwd="/p/demo" /></Router>);
    expect(await screen.findByTestId("onboarding-step-2-existed")).toBeTruthy();
    view.unmount();
    render(<Router hook={hook}><LandingPage {...props} pinnedCount={1} firstPinnedCwd="/p/demo" /></Router>);
    expect(screen.queryByTestId("onboarding-step-2-existed")).toBeNull();
  });
});

describe("Step ① peer status (F13, F14, X8, P1)", () => {
  const PEER_KEY = "@pi/anthropic-messages";
  interface Net {
    probe?: { ok: boolean; reason?: string };
    entry: Record<string, unknown> | null;
    calls: { health: number; recommended: number; installPosts: number };
  }
  let net: Net;
  function stubNet() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: any) => {
        const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as any;
        if (url.includes("/api/packages/install")) {
          net.calls.installPosts++;
          return ok({ success: true, data: { operationId: `op-${net.calls.installPosts}` } });
        }
        if (url.includes("/api/packages/recommended")) {
          net.calls.recommended++;
          return ok({ success: true, data: { recommended: net.entry ? [{ id: "pi-anthropic-messages", ...net.entry }] : [] } });
        }
        if (url.includes("/api/health")) {
          net.calls.health++;
          return ok({ plugins: net.probe ? [{ id: "flows-anthropic-bridge", lastProbe: { peers: { [PEER_KEY]: net.probe } } }] : [] });
        }
        return ok({});
      }),
    );
  }
  beforeEach(() => {
    net = { entry: { activeInPi: false }, calls: { health: 0, recommended: 0, installPosts: 0 } };
    stubNet();
    packageQueue.__resetForTests();
    peerAutoInstallStore.__resetForTests();
  });

  const peerProps = { providersReady: true, pinnedCount: 0, anthropicAuthenticated: true as boolean | null, onCreateProject: vi.fn() };
  const status = () => screen.getByTestId("onboarding-step-1-peer-status");
  const complete = (opId: string, success: boolean, error?: string) =>
    window.dispatchEvent(new CustomEvent("pi-package-event", { detail: { type: "package_operation_complete", operationId: opId, action: "install", source: ANTHROPIC_PEER_SOURCE, success, error } }));

  it("F13 rule 1: import failure → failed-to-load warning, no action", async () => {
    net.probe = { ok: false, reason: "import failed: x" };
    renderPage(peerProps);
    await waitFor(() => expect(status().textContent).toMatch(/failed to load/i));
    expect(within(status()).queryByRole("button")).toBeNull();
  });

  it("F13 rule 2: resolving probe → no peer status content, even when the entry is not active", async () => {
    net.probe = { ok: true };
    renderPage(peerProps);
    await waitFor(() => expect(net.calls.health).toBeGreaterThan(0));
    await waitFor(() => expect(net.calls.recommended).toBeGreaterThan(0));
    expect(status().textContent).toBe("");
  });

  it("F13 rules 3–5: store deciding/running → in-progress; failed → warning + Retry; installed → nothing", async () => {
    renderPage(peerProps);
    await waitFor(() => expect(within(status()).getByTestId("onboarding-step-1-peer-install")).toBeTruthy()); // rule 6 first
    await act(async () => { await peerAutoInstallStore.ensureInstall("sign-in"); });
    await waitFor(() => expect(status().textContent).toMatch(/Installing/));
    act(() => complete("op-1", false, "npm ERR! code E404"));
    await waitFor(() => expect(within(status()).getByTestId("onboarding-step-1-peer-retry")).toBeTruthy());
    expect(status().textContent).toMatch(/install didn't finish/i);
    expect(status().textContent).not.toContain("E404");
    expect(within(status()).getByTestId("onboarding-step-1-peer-retry").className).not.toContain(PRIMARY);
    await act(async () => { fireEvent.click(within(status()).getByTestId("onboarding-step-1-peer-retry")); });
    await waitFor(() => expect(status().textContent).toMatch(/Installing/));
    act(() => complete("op-2", true));
    await waitFor(() => expect(status().textContent).toBe(""));
  });

  it("F13 rule 6: authenticated + not active → warning with a secondary Install", async () => {
    renderPage(peerProps);
    const btn = await screen.findByTestId("onboarding-step-1-peer-install");
    expect(status().textContent).toMatch(/need.*pi-anthropic-messages/i);
    expect(btn.className).not.toContain(PRIMARY);
  });

  it("F13 rule 7: already active → nothing", async () => {
    net.entry = { activeInPi: true };
    renderPage(peerProps);
    await waitFor(() => expect(net.calls.recommended).toBeGreaterThan(0));
    expect(status().textContent).toBe("");
  });

  it("F14: manual Install vetoed by a fresh import failure; a clean probe enqueues once", async () => {
    renderPage(peerProps);
    const btn = await screen.findByTestId("onboarding-step-1-peer-install");
    net.probe = { ok: false, reason: "import failed: x" };
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(status().textContent).toMatch(/failed to load/i));
    expect(net.calls.installPosts).toBe(0);
  });

  it("F14: manual Install with a clean probe enqueues one global install and shows progress", async () => {
    renderPage(peerProps);
    const btn = await screen.findByTestId("onboarding-step-1-peer-install");
    await act(async () => { fireEvent.click(btn); });
    await waitFor(() => expect(net.calls.installPosts).toBe(1));
    await waitFor(() => expect(status().textContent).toMatch(/Installing/));
  });

  it("X8: Retry install → in progress, then no peer status after success", async () => {
    renderPage(peerProps);
    await screen.findByTestId("onboarding-step-1-peer-install");
    await act(async () => { await peerAutoInstallStore.ensureInstall("sign-in"); });
    act(() => complete("op-1", false, "boom"));
    const retry = await screen.findByTestId("onboarding-step-1-peer-retry");
    await act(async () => { fireEvent.click(retry); });
    await waitFor(() => expect(status().textContent).toMatch(/Installing/));
    act(() => complete("op-2", true));
    await waitFor(() => expect(status().textContent).toBe(""));
  });

  it.each([
    ["step 1 pending", { providersReady: false, anthropicAuthenticated: true }, false],
    ["step 1 done, anthropic false", { providersReady: true, anthropicAuthenticated: false }, false],
    ["step 1 done, anthropic unknown", { providersReady: true, anthropicAuthenticated: null }, false],
    ["step 1 done, anthropic true", { providersReady: true, anthropicAuthenticated: true }, true],
  ])("P1: %s → Landing requests peer state: %s", async (_label, props, requests) => {
    renderPage({ pinnedCount: 0, onCreateProject: vi.fn(), ...props });
    // Let every effect + fetch microtask chain settle, without a timer barrier.
    await act(async () => {
      for (let i = 0; i < 50; i++) await Promise.resolve();
    });
    if (requests) {
      await waitFor(() => expect(net.calls.health).toBeGreaterThan(0));
      await waitFor(() => expect(net.calls.recommended).toBeGreaterThan(0));
    } else {
      expect(net.calls.health + net.calls.recommended).toBe(0);
    }
  });
});
