/**
 * test-plan #E12 — the embedded-app shell transport refuses off-origin targets
 * without making a request, and carries the dashboard's auth exactly like the
 * shell's own socket (`useWebSocket` ticket predicate).
 * See change: add-plugin-app-host (D4).
 */
import { describe, expect, it, vi } from "vitest";
import { createEmbeddedAppShell, type EmbeddedAppShellDeps } from "../plugins/embedded-app-shell.js";

function deps(over: Partial<EmbeddedAppShellDeps> = {}) {
  const d = {
    fetch: vi.fn(async () => new Response("ok")),
    getApiBearer: vi.fn(() => null as string | null),
    isDevicePaired: vi.fn(() => false),
    mintWsTicket: vi.fn(async () => "TICKET"),
    appendWsTicket: (u: string, t: string) => `${u}${u.includes("?") ? "&" : "?"}ticket=${t}`,
    apiBase: () => "",
    wsBase: () => "ws://dash.local:8000",
    encodeFolder: (c: string) => c,
    decodeFolder: (e: string) => e,
    ...over,
  };
  return d;
}

describe("embedded app shell transport (#E12)", () => {
  it("off-origin fetch rejects and wsUrl resolves null, with no request made", async () => {
    const d = deps({ getApiBearer: vi.fn(() => "T") });
    const shell = createEmbeddedAppShell(d);
    await expect(shell.fetch("https://evil.example/x")).rejects.toBeInstanceOf(TypeError);
    await expect(shell.fetch("//evil.example/x")).rejects.toBeInstanceOf(TypeError);
    await expect(shell.wsUrl("//evil.example/ws")).resolves.toBeNull();
    expect(d.fetch).not.toHaveBeenCalled();
    expect(d.mintWsTicket).not.toHaveBeenCalled();
  });

  it("fetch carries Authorization: Bearer <token>", async () => {
    const d = deps({ getApiBearer: vi.fn(() => "T") });
    await createEmbeddedAppShell(d).fetch("/api/x");
    expect(d.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = d.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/x");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer T");
  });

  it("fetch without a bearer sends no Authorization header (cookie/loopback)", async () => {
    const d = deps();
    await createEmbeddedAppShell(d).fetch("/api/x");
    const [, init] = d.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
    expect(init.credentials).toBe("same-origin");
  });

  it.each([
    ["bearer", "T", false, true],
    ["paired", null, true, true],
    ["neither", null, false, false],
  ] as const)("wsUrl ticket for %s → %s", async (_label, bearer, paired, ticketed) => {
    const d = deps({ getApiBearer: vi.fn(() => bearer), isDevicePaired: vi.fn(() => paired) });
    const url = await createEmbeddedAppShell(d).wsUrl("/ws");
    expect(url).toBe(ticketed ? "ws://dash.local:8000/ws?ticket=TICKET" : "ws://dash.local:8000/ws");
    expect(d.mintWsTicket).toHaveBeenCalledTimes(ticketed ? 1 : 0);
  });
});
