import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { claudeCompatStore } from "../../lib/claude-compat/claude-compat-store.js";
import { packageQueue } from "../../lib/package/package-queue.js";
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
  claudeCompatStore.__resetForTests();
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

// Step ① compat status. See change: retire-anthropic-messages-bridge (test-plan #E16, #X2).
describe("Step ① Claude subscription compat status (E16, X2)", () => {
  const COMPAT_URL = "/api/preferences/claude-subscription-compat";
  interface Net { compat: boolean; write: "ok" | "network"; patches: unknown[]; reads: number }
  let net: Net;
  beforeEach(() => {
    net = { compat: false, write: "ok", patches: [], reads: 0 };
    claudeCompatStore.__resetForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: any) => {
        const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as any;
        if (url.includes(COMPAT_URL)) {
          if (init?.method === "PATCH") {
            net.patches.push(JSON.parse(init.body));
            if (net.write === "network") throw new TypeError("Failed to fetch");
            net.compat = JSON.parse(init.body).value;
            return ok({ claudeSubscriptionCompat: net.compat });
          }
          net.reads++;
          return ok({ claudeSubscriptionCompat: net.compat });
        }
        return ok({});
      }),
    );
  });
  afterEach(() => claudeCompatStore.__resetForTests());

  const status = () => screen.queryByTestId("onboarding-step-1-compat-notice");

  it.each([
    ["authenticated, off", true, false, true],
    ["authenticated, on", true, true, false],
    ["not authenticated, off", false, false, false],
    ["not authenticated, on", false, true, false],
  ])("E16: %s → notice shown: %s", async (_l, authed, on, shown) => {
    net.compat = on;
    renderPage({ providersReady: true, pinnedCount: 0, anthropicAuthenticated: authed, onCreateProject: vi.fn() });
    await act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); });
    if (shown) {
      await waitFor(() => expect(status()).toBeTruthy());
      const btn = screen.getByTestId("onboarding-step-1-compat-turn-on");
      expect(btn.className).toContain("bg-[var(--bg-tertiary)]");
      expect(btn.className).not.toContain("accent-solid");
      const live = screen.getByTestId("onboarding-step-1-compat-status");
      expect(live.getAttribute("aria-live")).toBe("polite");
    } else {
      expect(status()).toBeNull();
    }
    // Step ② controls stay usable either way.
    expect((screen.getByTestId("onboarding-step-2-create") as HTMLButtonElement).disabled).toBe(false);
    if (!authed) expect(net.reads).toBe(0);
  });

  it("Turn on from Landing sets the switch, hides the notice, installs nothing", async () => {
    renderPage({ providersReady: true, pinnedCount: 0, anthropicAuthenticated: true, onCreateProject: vi.fn() });
    fireEvent.click(await screen.findByTestId("onboarding-step-1-compat-turn-on"));
    await waitFor(() => expect(status()).toBeNull());
    expect(net.patches).toEqual([{ value: true }]);
  });

  it("X2 (Landing): network failure reverts to the notice with an error toast", async () => {
    net.write = "network";
    renderPage({ providersReady: true, pinnedCount: 0, anthropicAuthenticated: true, onCreateProject: vi.fn() });
    fireEvent.click(await screen.findByTestId("onboarding-step-1-compat-turn-on"));
    await waitFor(() => expect(screen.getAllByText(/not saved/i).length).toBeGreaterThan(0));
    await waitFor(() => expect(status()).toBeTruthy());
  });
});

// Skip-for-now (test-plan #F4–#F12). See change: fix-provider-catalogue-first-run (D6).
describe("LandingPage: Step 1 can be skipped", () => {
  const KEY = "pi-dashboard.onboarding.providersSkipped";
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("F4: skipping unlocks Step 2 as the primary action", () => {
    renderPage({ providersReady: false });
    fireEvent.click(screen.getByTestId("onboarding-step-1-skip"));
    expect(screen.getByTestId("onboarding-step-1-skipped")).toBeTruthy();
    expect(screen.getByTestId("onboarding-step-1-resume")).toBeTruthy();
    expect(screen.getByTestId("onboarding-step-2-create")).toBeTruthy();
    expect(screen.getByTestId("onboarding-progress").textContent).toMatch(/0 of 3 done/);
    expect(localStorage.getItem(KEY)).toBe("true");
  });

  it("F5: a skipped step still lets a session be started", () => {
    const { onSpawnSession } = renderPage({ providersReady: false, pinnedCount: 1, firstPinnedCwd: "/p" });
    fireEvent.click(screen.getByTestId("onboarding-step-1-skip"));
    fireEvent.click(screen.getByTestId("onboarding-step-3-cta"));
    expect(onSpawnSession).toHaveBeenCalledTimes(1);
    expect((onSpawnSession as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/p");
  });

  it("F6: the skip survives a reload", () => {
    localStorage.setItem(KEY, "true");
    renderPage({ providersReady: false });
    expect(screen.getByTestId("onboarding-step-1-skipped")).toBeTruthy();
    expect(screen.queryByTestId("onboarding-step-1-skip")).toBeNull();
  });

  it("F7: done wins over a previous skip; no skip/resume control once done", () => {
    localStorage.setItem(KEY, "true");
    renderPage({ providersReady: true });
    expect(screen.getByTestId("onboarding-step-1-done")).toBeTruthy();
    expect(screen.queryByTestId("onboarding-step-1-skip")).toBeNull();
    expect(screen.queryByTestId("onboarding-step-1-resume")).toBeNull();
  });

  it("F8: Set up now navigates to the providers settings", () => {
    localStorage.setItem(KEY, "true");
    const { navigate } = renderPage({ providersReady: false });
    fireEvent.click(screen.getByTestId("onboarding-step-1-resume"));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/settings/providers");
  });

  it("F9: at most one primary control; exactly one iff a step is pending", () => {
    const providers = [false, true] as const;
    for (const skipped of [false, true]) {
      for (const providersReady of providers) {
        for (const pinnedCount of [0, 1]) {
          for (const sessionsCount of [0, 1]) {
            cleanup();
            localStorage.clear();
            if (skipped) localStorage.setItem(KEY, "true");
            renderPage({
              providersReady,
              pinnedCount,
              sessionsCount,
              firstPinnedCwd: pinnedCount ? "/p" : null,
            });
            const primaries = Array.from(document.querySelectorAll("button")).filter((b) =>
              b.className.includes("bg-[var(--accent-solid)]"),
            );
            const step1Satisfied = providersReady || skipped;
            const step2Done = pinnedCount > 0;
            const step3Done = sessionsCount > 0;
            const pending =
              !step1Satisfied || (step1Satisfied && !step2Done) || (step2Done && !step3Done);
            const label = JSON.stringify({ skipped, providersReady, pinnedCount, sessionsCount });
            expect(primaries.length, label).toBeLessThanOrEqual(1);
            expect(primaries.length === 1, label).toBe(pending);
          }
        }
      }
    }
  });

  it("F10: storage unavailable keeps the skip while mounted", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    renderPage({ providersReady: false });
    fireEvent.click(screen.getByTestId("onboarding-step-1-skip"));
    expect(screen.getByTestId("onboarding-step-1-skipped")).toBeTruthy();
  });

  it("F11: the new controls and state are accessible", () => {
    renderPage({ providersReady: false });
    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(screen.getByRole("button", { name: /set up now/i })).toBeTruthy();
    const row = screen.getByTestId("onboarding-step-1");
    expect(row.querySelector("span")).toBeTruthy();
    expect(within(screen.getByTestId("onboarding-step-1-skipped")).getByText(/skipped/i)).toBeTruthy();
  });

  it("F12: the skipped row explains the consequence", () => {
    localStorage.setItem(KEY, "true");
    renderPage({ providersReady: false });
    const text = screen.getByTestId("onboarding-step-1-skipped").textContent ?? "";
    expect(text).toMatch(/skipped/i);
    expect(text).toMatch(/need a provider to run prompts/i);
    expect(text).toMatch(/lists every provider it knows/i);
  });
});

