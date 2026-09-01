/**
 * Component tests for the Anthropic bridge-peer hint on the OAuth row.
 *
 * Covers test-plan scenarios E1–E9, F1–F9 and X1–X7 of change
 * warn-missing-anthropic-messages-peer. The hint is derived STRICTLY from
 * `/api/health.plugins[flows-anthropic-bridge].lastProbe.peers["@pi/anthropic-messages"].ok === false`;
 * every other shape is fail-open.
 */

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthSection } from "../components/settings/ProviderAuthSection.js";
import { packageQueue } from "../lib/package/package-queue.js";

const PEER_KEY = "@pi/anthropic-messages";
const PEER_SOURCE = "npm:@blackbelt-technology/pi-anthropic-messages";

const ANTHROPIC_CONNECTED = { id: "anthropic", name: "Anthropic", flowType: "auth_code", authenticated: true };

/** `/api/health` payload with a bridge row carrying the given AM peer probe. */
function health(am: any, extra?: Record<string, any>) {
  return {
    plugins: [
      { id: "some-other-plugin" },
      { id: "flows-anthropic-bridge", lastProbe: { status: "waiting_peers", peers: { [PEER_KEY]: am, "pi-flows": { ok: true } }, at: 1 }, ...extra },
    ],
  };
}

interface Ctl {
  healthBody: any;
  healthMode: "ok" | "reject" | "500" | "pending";
  healthCalls: number;
  installPosts: Array<any>;
}
let ctl: Ctl;

function stubFetch(statuses: any[] = [ANTHROPIC_CONNECTED]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      if (url.includes("/api/provider-auth/handlers")) return { ok: true, json: async () => ({ ids: ["anthropic", "openai-codex", "github-copilot"] }) } as any;
      if (url.includes("/api/provider-auth/status")) return { ok: true, json: async () => statuses } as any;
      if (url.includes("/api/packages/install")) {
        ctl.installPosts.push(JSON.parse(init.body));
        return { ok: true, json: async () => ({ success: true, data: { operationId: `op-${ctl.installPosts.length}` } }) } as any;
      }
      if (url.includes("/api/health")) {
        ctl.healthCalls++;
        if (ctl.healthMode === "reject") throw new Error("network down");
        if (ctl.healthMode === "500") return { ok: false, status: 500, json: async () => ({}) } as any;
        if (ctl.healthMode === "pending") return await new Promise(() => {});
        return { ok: true, json: async () => ctl.healthBody } as any;
      }
      return { ok: true, json: async () => ({}) } as any;
    }),
  );
}

function hint(c: { queryByTestId: (id: string) => HTMLElement | null }) {
  return c.queryByTestId("anthropic-peer-hint");
}

beforeEach(() => {
  ctl = { healthBody: health({ ok: false }), healthMode: "ok", healthCalls: 0, installPosts: [] };
  packageQueue.__resetForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  packageQueue.__resetForTests();
});

// ── Edge-case scenarios ──────────────────────────────────────────────────────

describe("anthropic peer hint — detection", () => {
  it("E1 renders the hint with an install control when the peer probe reports ok:false", async () => {
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(hint(c)).toBeTruthy());
    expect(hint(c)!.textContent).toContain("@blackbelt-technology/pi-anthropic-messages");
    expect(c.getByText("Install peer")).toBeTruthy();
  });

  it("E2 renders no hint when the peer resolves", async () => {
    ctl.healthBody = health({ ok: true });
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.getAllByText("Sign Out").length).toBe(1));
    await waitFor(() => expect(ctl.healthCalls).toBeGreaterThan(0));
    expect(hint(c)).toBeNull();
  });

  it("E3 renders no hint on a signed-out anthropic row", async () => {
    stubFetch([{ ...ANTHROPIC_CONNECTED, authenticated: false }]);
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.getAllByText("Sign In").length).toBe(1));
    await waitFor(() => expect(ctl.healthCalls).toBeGreaterThan(0));
    expect(hint(c)).toBeNull();
  });

  it("E4 renders no hint on other authenticated OAuth providers", async () => {
    stubFetch([
      { id: "openai-codex", name: "OpenAI Codex", flowType: "auth_code", authenticated: true },
      { id: "github-copilot", name: "GitHub Copilot", flowType: "device_code", authenticated: true },
    ]);
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.getAllByText("Sign Out").length).toBe(2));
    await waitFor(() => expect(ctl.healthCalls).toBeGreaterThan(0));
    expect(hint(c)).toBeNull();
  });

  it("E5 renders no hint on the anthropic-api key row", async () => {
    stubFetch([{ id: "anthropic-api", name: "Anthropic API", flowType: "api_key", authenticated: true, maskedKey: "sk-…xyz" }]);
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.getAllByText("Configured").length).toBe(1));
    await waitFor(() => expect(ctl.healthCalls).toBeGreaterThan(0));
    expect(hint(c)).toBeNull();
  });

  it("E6 ignores lastProbe.status — waiting_peers with a healthy AM peer renders no hint", async () => {
    ctl.healthBody = {
      plugins: [{ id: "flows-anthropic-bridge", lastProbe: { status: "waiting_peers", peers: { [PEER_KEY]: { ok: true }, "pi-flows": { ok: false } }, at: 1 } }],
    };
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.getAllByText("Sign Out").length).toBe(1));
    await waitFor(() => expect(ctl.healthCalls).toBeGreaterThan(0));
    expect(hint(c)).toBeNull();
  });

  it("E7 reads the legacy peers key only — a scoped-key probe renders no hint", async () => {
    ctl.healthBody = {
      plugins: [{ id: "flows-anthropic-bridge", lastProbe: { status: "waiting_peers", peers: { "@blackbelt-technology/pi-anthropic-messages": { ok: false } }, at: 1 } }],
    };
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.getAllByText("Sign Out").length).toBe(1));
    await waitFor(() => expect(ctl.healthCalls).toBeGreaterThan(0));
    expect(hint(c)).toBeNull();
  });

  it("E8 withholds the install control on an import failure and reports the reason", async () => {
    ctl.healthBody = health({ ok: false, reason: "import failed: Unexpected token" });
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(hint(c)).toBeTruthy());
    expect(hint(c)!.textContent).toContain("import failed: Unexpected token");
    expect(c.queryByText("Install peer")).toBeNull();
  });

  for (const [label, am] of [
    ["MODULE_NOT_FOUND", { ok: false, reason: "MODULE_NOT_FOUND" }],
    ["no reason", { ok: false }],
    ["near-miss prefix", { ok: false, reason: "imported failed: x" }],
  ] as const) {
    it(`E9 keeps the install control for a non-import reason (${label})`, async () => {
      ctl.healthBody = health(am);
      stubFetch();
      const c = render(<ProviderAuthSection />);
      await waitFor(() => expect(hint(c)).toBeTruthy());
      expect(c.getByText("Install peer")).toBeTruthy();
    });
  }
});

// ── Frontend-quirk scenarios ─────────────────────────────────────────────────

describe("anthropic peer hint — reactivity", () => {
  it("F1 clears on a fresh probe without remounting the section", async () => {
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(hint(c)).toBeTruthy());
    const row = c.getAllByText("Sign Out")[0].closest("div.flex-col");
    ctl.healthBody = health({ ok: true });
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(hint(c)).toBeNull());
    // Same row instance — the section was not remounted.
    expect(c.getAllByText("Sign Out")[0].closest("div.flex-col")).toBe(row);
  });

  it("F2 re-reads on window focus", async () => {
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(hint(c)).toBeTruthy());
    const before = ctl.healthCalls;
    ctl.healthBody = health({ ok: true });
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(ctl.healthCalls).toBeGreaterThan(before));
    await waitFor(() => expect(hint(c)).toBeNull());
  });

  it("F3 re-reads on a successful package-operation completion", async () => {
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(hint(c)).toBeTruthy());
    ctl.healthBody = health({ ok: true });
    fireEvent(window, new CustomEvent("pi-package-event", { detail: { type: "package_operation_complete", success: true, source: "npm:whatever", action: "install" } }));
    await waitFor(() => expect(hint(c)).toBeNull());
  });

  it("F4 picks up the first probe on an open tab via the poll", async () => {
    // Fake timers must be installed BEFORE render, or the hook's interval is
    // created against real timers and advanceTimersByTime never reaches it.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    ctl.healthBody = { plugins: [{ id: "flows-anthropic-bridge" }] };
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.getAllByText("Sign Out").length).toBe(1));
    await waitFor(() => expect(ctl.healthCalls).toBeGreaterThan(0));
    expect(hint(c)).toBeNull();

    ctl.healthBody = health({ ok: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(hint(c)).toBeTruthy());
  });

  it("F5 stops polling when the section unmounts", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(hint(c)).toBeTruthy());
    // Sanity: the poll is live before unmount, so the post-unmount zero is
    // real and not a fake-timer artefact.
    const before = ctl.healthCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(ctl.healthCalls).toBeGreaterThan(before);

    c.unmount();
    const after = ctl.healthCalls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(ctl.healthCalls).toBe(after);
  });

  it("F6 latches the installed state past the queue's success auto-clear window", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(hint(c)).toBeTruthy());

    fireEvent.click(c.getByText("Install peer"));
    await waitFor(() => expect(ctl.installPosts.length).toBe(1));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("pi-package-event", { detail: { type: "package_operation_complete", operationId: "op-1", source: PEER_SOURCE, action: "install", success: true } }));
    });
    await waitFor(() => expect(hint(c)!.textContent).toContain("applies on the next pi session start"));

    // Past SUCCESS_AUTOCLEAR_MS the queue drops its success state; the latch must hold.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(packageQueue.getStateForSource(PEER_SOURCE)).toBe("idle");
    expect(hint(c)!.textContent).toContain("applies on the next pi session start");
    expect(c.queryByText("Install peer")).toBeNull();
  });

  it("F7 releases the latch when the probe reports the peer resolving", async () => {
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(hint(c)).toBeTruthy());
    fireEvent.click(c.getByText("Install peer"));
    await waitFor(() => expect(ctl.installPosts.length).toBe(1));
    ctl.healthBody = health({ ok: true });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("pi-package-event", { detail: { type: "package_operation_complete", operationId: "op-1", source: PEER_SOURCE, action: "install", success: true } }));
    });
    await waitFor(() => expect(hint(c)).toBeNull());
  });

  it("F8 blocks a duplicate enqueue while the install is in flight", async () => {
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(hint(c)).toBeTruthy());
    const btn = c.getByText("Install peer").closest("button")!;
    fireEvent.click(btn);
    await waitFor(() => expect(ctl.installPosts.length).toBe(1));
    fireEvent.click(btn);
    await waitFor(() => expect(c.getByText("Installing…")).toBeTruthy());
    expect(ctl.installPosts.length).toBe(1);
    expect(c.getByText("Installing…").closest("button")!.disabled).toBe(true);
  });

  it("F9 is non-blocking — Sign Out, the Connected marker and the expiry stay intact", async () => {
    const expires = Date.now() + 3 * 86_400_000;
    stubFetch([{ ...ANTHROPIC_CONNECTED, expires }]);
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(hint(c)).toBeTruthy());
    expect(c.getByText("Sign Out").closest("button")!.disabled).toBe(false);
    expect(c.getByText("Connected")).toBeTruthy();
    expect(c.getByText("expires in 2d")).toBeTruthy();
    expect(c.container.querySelector('[role="dialog"]')).toBeNull();
  });
});

// ── Error-handling scenarios ─────────────────────────────────────────────────

describe("anthropic peer hint — fail-open", () => {
  it("X1 renders no hint when the health request rejects", async () => {
    ctl.healthMode = "reject";
    stubFetch();
    const rejections: unknown[] = [];
    const onRejection = (e: any) => { rejections.push(e); };
    window.addEventListener("unhandledrejection", onRejection);
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.getAllByText("Sign Out").length).toBe(1));
    await waitFor(() => expect(ctl.healthCalls).toBeGreaterThan(0));
    expect(hint(c)).toBeNull();
    expect(rejections).toEqual([]);
    window.removeEventListener("unhandledrejection", onRejection);
  });

  it("X2 renders no hint on a non-OK health status", async () => {
    ctl.healthMode = "500";
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.getAllByText("Sign Out").length).toBe(1));
    await waitFor(() => expect(ctl.healthCalls).toBeGreaterThan(0));
    expect(hint(c)).toBeNull();
  });

  it("X3 renders no hint while the health read is still in flight", async () => {
    ctl.healthMode = "pending";
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(c.getAllByText("Sign Out").length).toBe(1));
    expect(hint(c)).toBeNull();
  });

  for (const [label, body] of [
    ["no bridge row", { plugins: [{ id: "flows-plugin" }] }],
    ["no lastProbe", { plugins: [{ id: "flows-anthropic-bridge" }] }],
    ["plugins absent", {}],
    ["plugins not an array", { plugins: { id: "flows-anthropic-bridge" } }],
    ["peers absent", { plugins: [{ id: "flows-anthropic-bridge", lastProbe: { status: "active", at: 1 } }] }],
    ["peers not an object", { plugins: [{ id: "flows-anthropic-bridge", lastProbe: { peers: "nope" } }] }],
    ["peer entry not an object", { plugins: [{ id: "flows-anthropic-bridge", lastProbe: { peers: { [PEER_KEY]: false } } }] }],
  ] as const) {
    it(`X4–X6 fail-open on a malformed payload (${label})`, async () => {
      ctl.healthBody = body;
      stubFetch();
      const c = render(<ProviderAuthSection />);
      await waitFor(() => expect(c.getAllByText("Sign Out").length).toBe(1));
      await waitFor(() => expect(ctl.healthCalls).toBeGreaterThan(0));
      expect(hint(c)).toBeNull();
    });
  }

  it("X7 surfaces an install failure and returns the control to an actionable state", async () => {
    stubFetch();
    const c = render(<ProviderAuthSection />);
    await waitFor(() => expect(hint(c)).toBeTruthy());
    fireEvent.click(c.getByText("Install peer"));
    await waitFor(() => expect(ctl.installPosts.length).toBe(1));
    await act(async () => {
      window.dispatchEvent(new CustomEvent("pi-package-event", { detail: { type: "package_operation_complete", operationId: "op-1", source: PEER_SOURCE, action: "install", success: false, error: "npm ERR! 403 Forbidden" } }));
    });
    await waitFor(() => expect(hint(c)!.textContent).toContain("npm ERR! 403 Forbidden"));
    expect(c.getByText("Install peer").closest("button")!.disabled).toBe(false);
  });
});
