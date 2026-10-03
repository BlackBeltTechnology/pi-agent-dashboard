/**
 * Post-sign-in Radius MCP offer (test-plan #F3 #F4 and the L1 half of #F2/#F6).
 * The section owns the offer; sign-in itself stays on the generic panes.
 *
 * See change: add-radius-provider-login (D4).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderAuthSection } from "../components/settings/ProviderAuthSection.js";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

interface Script {
  provider: string;
  /** GET /radius/mcp */
  get?: { status: number; body: unknown };
  /** POST /radius/mcp */
  post?: { status: number; body: unknown };
  calls: { get: number; post: number };
}

function stub(script: Script) {
  let completed = false;
  const id = script.provider;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: any) => {
      const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as any;
      if (url.includes("/api/provider-auth/radius/mcp")) {
        if (init?.method === "POST") {
          script.calls.post++;
          return json(script.post?.status ?? 200, script.post?.body ?? {});
        }
        script.calls.get++;
        return json(script.get?.status ?? 200, script.get?.body ?? {});
      }
      if (url.includes("/api/provider-auth/status")) {
        return json(200, [{ id, name: id === "radius" ? "Radius" : "Anthropic", flowType: "auth_code", authenticated: completed, configured: completed, subscription: false }]);
      }
      if (url.includes("/api/providers")) return json(200, { success: true, providers: {}, health: {} });
      if (url.includes("/api/provider-auth/catalogue-ready")) return json(200, { ready: true });
      if (url.includes("/api/provider-auth/start")) {
        completed = true;
        return json(200, { flowId: "f1", provider: id, status: "pending", pending: { kind: "device_code", userCode: "X", verificationUri: "https://x.test" } });
      }
      if (url.includes("/api/provider-auth/flow/")) return json(200, { flowId: "f1", provider: id, status: "complete" });
      return json(200, {});
    }),
  );
}

async function signInAndComplete(name: string) {
  const c = render(<ProviderAuthSection />);
  fireEvent.click(await c.findByTestId("add-provider-button"));
  const dlg = await screen.findByRole("dialog");
  fireEvent.click(Array.from(dlg.querySelectorAll('[role="option"]')).find((o) => o.textContent?.includes(name)) as Element);
  fireEvent.click(await screen.findByTestId("dialog-sign-in"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  return c;
}

const OFFER = { configured: false, name: "radius", path: "/home/u/.pi/agent/mcp.json" };

describe("Radius MCP offer — accept (F2 L1 half, F6 L1 half)", () => {
  it("shows after a Radius sign-in naming path + entry; accept sends exactly one POST and reports the count", async () => {
    const script: Script = { provider: "radius", get: { status: 200, body: OFFER }, post: { status: 200, body: { configured: true, written: true, name: "radius", reloaded: 2 } }, calls: { get: 0, post: 0 } };
    stub(script);
    await signInAndComplete("Radius");
    const offer = await screen.findByTestId("radius-mcp-offer");
    expect(offer.textContent).toContain("/home/u/.pi/agent/mcp.json");
    expect(offer.textContent).toContain("radius");
    // Both controls are buttons with accessible names (keyboard-reachable natively).
    const accept = screen.getByRole("button", { name: "Configure Radius MCP" });
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
    fireEvent.click(accept);
    await waitFor(() => expect(screen.queryByTestId("radius-mcp-offer")).toBeNull());
    expect(script.calls.post).toBe(1);
    expect(document.body.textContent).toContain("2 session(s) reloaded");
  });
});

describe("Radius MCP offer — suppression (F3)", () => {
  it("(a) decline: no POST, offer gone", async () => {
    const script: Script = { provider: "radius", get: { status: 200, body: OFFER }, calls: { get: 0, post: 0 } };
    stub(script);
    await signInAndComplete("Radius");
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByTestId("radius-mcp-offer")).toBeNull());
    expect(script.calls.post).toBe(0);
  });

  it("(b) already configured → no offer", async () => {
    const script: Script = { provider: "radius", get: { status: 200, body: { ...OFFER, configured: true } }, calls: { get: 0, post: 0 } };
    stub(script);
    await signInAndComplete("Radius");
    await waitFor(() => expect(script.calls.get).toBe(1));
    expect(screen.queryByTestId("radius-mcp-offer")).toBeNull();
  });

  it("(c) GET 503 → no offer, no error on the finished sign-in", async () => {
    const script: Script = { provider: "radius", get: { status: 503, body: { code: "provider_auth.radius_mcp_runtime_unavailable", error: "x" } }, calls: { get: 0, post: 0 } };
    stub(script);
    await signInAndComplete("Radius");
    await waitFor(() => expect(script.calls.get).toBe(1));
    expect(screen.queryByTestId("radius-mcp-offer")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("(d) another provider completing never requests /radius/mcp", async () => {
    const script: Script = { provider: "anthropic", get: { status: 200, body: OFFER }, calls: { get: 0, post: 0 } };
    stub(script);
    await signInAndComplete("Anthropic");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(script.calls.get).toBe(0);
    expect(screen.queryByTestId("radius-mcp-offer")).toBeNull();
  });
});

describe("Radius MCP offer — stale state (B1)", () => {
  /** Two providers, both completable; GET /radius/mcp is held until released. */
  function stubTwo(get: () => Promise<any>): Set<string> {
    const done = new Set<string>();
    const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: any) => {
        if (url.includes("/api/provider-auth/radius/mcp") && init?.method !== "POST") return get();
        if (init?.method === "DELETE" && /\/api\/provider-auth\/[^/]+$/.test(url)) {
          done.delete(url.split("/").pop() as string);
          return json(200, { ok: true });
        }
        if (url.includes("/api/provider-auth/status")) {
          return json(200, ["radius", "anthropic"].map((id) => ({ id, name: id === "radius" ? "Radius" : "Anthropic", flowType: "auth_code", authenticated: done.has(id), configured: done.has(id), subscription: false })));
        }
        if (url.includes("/api/providers")) return json(200, { success: true, providers: {}, health: {} });
        if (url.includes("/api/provider-auth/catalogue-ready")) return json(200, { ready: true });
        if (url.includes("/api/provider-auth/start")) {
          const provider = JSON.parse(init.body).provider as string;
          done.add(provider);
          return json(200, { flowId: `f-${provider}`, provider, status: "pending", pending: { kind: "device_code", userCode: "X", verificationUri: "https://x.test" } });
        }
        if (url.includes("/api/provider-auth/flow/")) {
          const flowId = url.split("/flow/")[1];
          return json(200, { flowId, provider: flowId.slice(2), status: "complete" });
        }
        return json(200, {});
      }),
    );
    return done;
  }

  async function signIn(c: ReturnType<typeof render>, name: string) {
    fireEvent.click(await c.findByTestId("add-provider-button"));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(Array.from(dlg.querySelectorAll('[role="option"]')).find((o) => o.textContent?.includes(name)) as Element);
    fireEvent.click(await screen.findByTestId("dialog-sign-in"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  }

  it("completing another provider clears an earlier offer", async () => {
    stubTwo(async () => ({ ok: true, status: 200, json: async () => OFFER }) as any);
    const c = render(<ProviderAuthSection />);
    await signIn(c, "Radius");
    await screen.findByTestId("radius-mcp-offer");
    await signIn(c, "Anthropic");
    await waitFor(() => expect(screen.queryByTestId("radius-mcp-offer")).toBeNull());
  });

  it("a second Radius completion clears the displayed offer while its own read is pending", async () => {
    let calls = 0;
    let release: (v: unknown) => void = () => {};
    const done = stubTwo(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ ok: true, status: 200, json: async () => OFFER } as any);
      return new Promise((resolve) => { release = resolve; });
    });
    const c = render(<ProviderAuthSection />);
    await signIn(c, "Radius");
    await screen.findByTestId("radius-mcp-offer");
    // Signed out, then signed in again: the old offer must not stay clickable.
    fireEvent.click(await c.findByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(done.has("radius")).toBe(false));
    await signIn(c, "Radius");
    expect(calls).toBe(2);
    expect(screen.queryByTestId("radius-mcp-offer")).toBeNull();
    await act(async () => {
      release({ ok: true, status: 200, json: async () => ({ ...OFFER, configured: true }) });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByTestId("radius-mcp-offer")).toBeNull();
  });

  it("dismissal during an in-flight read: the late GET does not restore the offer", async () => {
    let release: (v: unknown) => void = () => {};
    stubTwo(() => new Promise((resolve) => { release = resolve; }));
    const c = render(<ProviderAuthSection />);
    await signIn(c, "Radius");
    // Pending read: no offer yet. A completion of another provider invalidates it.
    expect(screen.queryByTestId("radius-mcp-offer")).toBeNull();
    await signIn(c, "Anthropic");
    await act(async () => {
      release({ ok: true, status: 200, json: async () => OFFER });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByTestId("radius-mcp-offer")).toBeNull();
  });

  it("a Radius GET resolving after a later completion does not resurrect the offer", async () => {
    let release: (v: unknown) => void = () => {};
    stubTwo(() => new Promise((resolve) => { release = resolve; }));
    const c = render(<ProviderAuthSection />);
    await signIn(c, "Radius");
    await signIn(c, "Anthropic");
    await act(async () => {
      release({ ok: true, status: 200, json: async () => OFFER });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByTestId("radius-mcp-offer")).toBeNull();
  });
});

describe("Radius MCP offer — refusal rendering (F4)", () => {
  it("translated message for a known code, no success text", async () => {
    const script: Script = {
      provider: "radius",
      get: { status: 200, body: OFFER },
      post: { status: 409, body: { code: "provider_auth.radius_mcp_write_refused", vars: { reason: "unparseable" }, error: "raw" } },
      calls: { get: 0, post: 0 },
    };
    stub(script);
    await signInAndComplete("Radius");
    fireEvent.click(await screen.findByRole("button", { name: "Configure Radius MCP" }));
    const alert = await screen.findByTestId("radius-mcp-error");
    expect(alert.textContent).toContain("mcp.json could not be updated (unparseable)");
    expect(document.body.textContent).not.toContain("reloaded");
    // The offer stays so the user can retry or decline.
    expect(screen.getByTestId("radius-mcp-offer")).toBeTruthy();
  });

  it("an unknown code falls back to the server's error text", async () => {
    const script: Script = {
      provider: "radius",
      get: { status: 200, body: OFFER },
      post: { status: 500, body: { code: "x.y", error: "boom" } },
      calls: { get: 0, post: 0 },
    };
    stub(script);
    await signInAndComplete("Radius");
    fireEvent.click(await screen.findByRole("button", { name: "Configure Radius MCP" }));
    expect((await screen.findByTestId("radius-mcp-error")).textContent).toBe("boom");
  });
});

describe("i18n keys in every locale (E20)", () => {
  const lib = join(__dirname, "../lib");
  const files = [
    ["en", join(lib, "i18n-en-source.json")],
    ["zh-CN", join(lib, "i18n/i18n.tsx")],
    ["hu", join(lib, "i18n/i18n-hu.ts")],
  ] as const;
  const keys = [
    "err.provider_auth.radius_mcp_runtime_unavailable",
    "err.provider_auth.radius_mcp_no_credential",
    "err.provider_auth.radius_mcp_overridden",
    "err.provider_auth.radius_mcp_write_refused",
    "providers.radiusMcpOfferTitle",
    "providers.radiusMcpOfferBody",
    "providers.radiusMcpAccept",
    "providers.radiusMcpDecline",
    "providers.radiusMcpDone",
  ];
  for (const [label, file] of files) {
    it(label, () => {
      const src = readFileSync(file, "utf8");
      for (const key of keys) expect(src, key).toContain(`"${key}":`);
    });
  }
});
