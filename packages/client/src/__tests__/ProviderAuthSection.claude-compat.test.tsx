/**
 * Anthropic sign-in → Claude subscription compat prompt, the anthropic row
 * switch, and the optimistic-then-revert save.
 * See change: retire-anthropic-messages-bridge (test-plan #E12 #E13 #E15 #X1 #X2).
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthSection } from "../components/settings/ProviderAuthSection.js";
import { claudeCompatStore } from "../lib/claude-compat/claude-compat-store.js";
import { pluginAvailability } from "../lib/plugins/plugin-availability.js";

const ANTHROPIC = { id: "anthropic", name: "Anthropic", flowType: "auth_code" };
const SECOND = { id: "second-oauth", name: "Second Prov", flowType: "auth_code" };
const COMPAT_URL = "/api/preferences/claude-subscription-compat";

interface Ctl {
  configured: Set<string>;
  completing: string[];
  /** GET result: a value, or "fail" for an unreadable switch. */
  compatRead: boolean | "fail";
  /** PATCH result: "ok", HTTP 500, or a rejected fetch. */
  compatWrite: "ok" | "500" | "network";
  patches: unknown[];
  installPosts: number;
}
let ctl: Ctl;

const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as any;

function row(p: { id: string; name: string; flowType: string }) {
  const on = ctl.configured.has(p.id);
  return { ...p, authenticated: on, configured: on };
}

async function route(url: string, init?: any) {
  if (url.includes(COMPAT_URL)) {
    if (init?.method === "PATCH") {
      ctl.patches.push(JSON.parse(init.body));
      if (ctl.compatWrite === "network") throw new TypeError("Failed to fetch");
      if (ctl.compatWrite === "500") return { ok: false, status: 500, json: async () => ({ error: "boom" }) } as any;
      const value = JSON.parse(init.body).value;
      ctl.compatRead = value;
      return ok({ claudeSubscriptionCompat: value });
    }
    if (ctl.compatRead === "fail") throw new TypeError("Failed to fetch");
    return ok({ claudeSubscriptionCompat: ctl.compatRead });
  }
  if (url.includes("/api/provider-auth/status")) return ok([row(ANTHROPIC), row(SECOND)]);
  if (url.includes("/api/provider-auth/catalogue-ready")) return ok({ ready: true });
  if (url.includes("/api/provider-auth/start")) return ok({ flowId: "flow-1", status: "pending", authUrl: "https://example.test/oauth" });
  if (url.includes("/api/provider-auth/flow/")) {
    for (const id of ctl.completing) ctl.configured.add(id);
    return ok({ flowId: "flow-1", status: "complete" });
  }
  if (url.includes("/api/packages/installed")) return ok({ success: true, data: [] });
  if (url.includes("/api/packages/install")) {
    ctl.installPosts++;
    return ok({ success: true, data: { operationId: "op" } });
  }
  if (url.includes("/api/providers")) return ok({ success: true, providers: {}, health: {} });
  if (url.includes("/api/health")) return ok({ plugins: [] });
  return ok({});
}

beforeEach(() => {
  ctl = { configured: new Set(), completing: [], compatRead: false, compatWrite: "ok", patches: [], installPosts: 0 };
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("fetch", vi.fn(route));
  claudeCompatStore.__resetForTests();
  pluginAvailability.reset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  claudeCompatStore.__resetForTests();
  pluginAvailability.reset();
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

const prompt = () => screen.queryByTestId("claude-compat-prompt");

describe("sign-in prompt (E12)", () => {
  it.each([
    ["off", false, true],
    ["on", true, false],
    ["read fails", "fail", true],
  ] as const)("switch %s → prompt shown: %s; never installs a package", async (_l, read, shown) => {
    ctl.compatRead = read;
    render(<ProviderAuthSection />);
    await signIn("Anthropic", "anthropic");
    if (shown) await waitFor(() => expect(prompt()).toBeTruthy());
    else {
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(prompt()).toBeNull();
    }
    expect(ctl.installPosts).toBe(0);
    expect(screen.queryByTestId("dialog-sign-in")).toBeNull(); // sign-in not blocked
  });

  it("another provider's sign-in never prompts", async () => {
    render(<ProviderAuthSection />);
    await signIn("Second Prov", "second-oauth");
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(prompt()).toBeNull();
  });
});

describe("sign-in prompt choices (E13)", () => {
  it("Turn on sends PATCH true and closes", async () => {
    render(<ProviderAuthSection />);
    await signIn("Anthropic", "anthropic");
    fireEvent.click(await screen.findByTestId("claude-compat-prompt-turn-on"));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(ctl.patches).toEqual([{ value: true }]);
  });

  it("Not now sends nothing, closes, and the row stays authenticated", async () => {
    render(<ProviderAuthSection />);
    await signIn("Anthropic", "anthropic");
    fireEvent.click(await screen.findByTestId("claude-compat-prompt-not-now"));
    await waitFor(() => expect(prompt()).toBeNull());
    expect(ctl.patches).toEqual([]);
    expect(document.querySelector('[data-row-id="anthropic"]')).toBeTruthy();
  });
});

describe("anthropic row switch (E15)", () => {
  // The rewrite no longer depends on the Flows plugin, so no "needs Flows"
  // notice in either state. See change: seed-claude-compat-on-upgrade.
  it.each([
    [true, false],
    [true, true],
    [false, false],
    [false, true],
  ])("switch on=%s × flows unavailable=%s", async (on, flowsOff) => {
    ctl.configured.add("anthropic");
    ctl.compatRead = on;
    if (flowsOff) pluginAvailability.apply([{ id: "flows", enabled: false }]);
    render(<ProviderAuthSection />);
    const sw = await screen.findByTestId("claude-compat-switch");
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe(String(on)));
    expect(sw.getAttribute("role")).toBe("switch");
    expect(screen.queryByTestId("claude-compat-needs-flows")).toBeNull();
    const rowEl = document.querySelector('[data-row-id="anthropic"]') as HTMLElement;
    expect(within(rowEl).getByText("Sign Out")).toBeTruthy();
  });

  it("the switch is absent on other providers' rows", async () => {
    ctl.configured.add("second-oauth");
    render(<ProviderAuthSection />);
    await waitFor(() => expect(document.querySelector('[data-row-id="second-oauth"]')).toBeTruthy());
    expect(screen.queryByTestId("claude-compat-switch")).toBeNull();
  });
});

describe("failed save reverts (X1, X2)", () => {
  it("X1: PATCH 500 → shows on, reverts to off, one error toast, no second PATCH", async () => {
    ctl.configured.add("anthropic");
    ctl.compatWrite = "500";
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    (fetch as any).mockImplementation(async (url: string, init?: any) => {
      if (url.includes(COMPAT_URL) && init?.method === "PATCH") await gate;
      return route(url, init);
    });
    render(<ProviderAuthSection />);
    const sw = await screen.findByTestId("claude-compat-switch");
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true"); // optimistic
    await act(async () => { release(); });
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
    await waitFor(() => expect(screen.getAllByText(/not saved/i)).toHaveLength(1));
    expect(ctl.patches).toHaveLength(1);
  });

  it("X2 (prompt): network failure → prompt does not report success, switch reverts, error toast", async () => {
    ctl.compatWrite = "network";
    render(<ProviderAuthSection />);
    await signIn("Anthropic", "anthropic");
    fireEvent.click(await screen.findByTestId("claude-compat-prompt-turn-on"));
    await waitFor(() => expect(screen.getAllByText(/not saved/i).length).toBeGreaterThan(0));
    expect(claudeCompatStore.getSnapshot().value).toBe(false);
    expect(screen.queryByText(/compat is on/i)).toBeNull();
  });
});
