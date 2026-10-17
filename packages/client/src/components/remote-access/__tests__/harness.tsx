/**
 * Shared harness for the Remote access dialog tests: a URL-routing fetch mock
 * with a call log, and a snapshot-source builder. Test-only.
 */
import { render } from "@testing-library/react";
import { vi } from "vitest";
import type { RunState } from "../../../lib/remote-access/steps.js";
import { RemoteAccessDialog } from "../RemoteAccessDialog.js";

export interface Sources {
  config?: Record<string, unknown>;
  status?: Record<string, unknown>;
  readiness?: Array<Record<string, unknown>>;
  endpoints?: Array<Record<string, unknown>>;
  /** Override a route: `"PUT /api/config"` → [status, body]. */
  routes?: Record<string, [number, unknown] | (() => [number, unknown])>;
}

interface Call {
  method: string;
  url: string;
  body?: unknown;
}

export const jsonRes = (body: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this;
    },
  }) as unknown as Response;

export const reach = (resolved: string, pending = resolved, source = "config") => ({
  resolvedBindHost: resolved,
  pendingBindHost: pending,
  unreachable: [],
  bindHostSource: source,
});

export function baseConfig(over: Record<string, unknown> = {}) {
  return {
    tunnel: { provider: "zrok", mode: "public", zrok: { persistent: true } },
    pairing: { acceptLanRequests: false },
    trustedNetworks: [],
    auth: { bypassHosts: [] },
    reachability: reach("127.0.0.1"),
    ...over,
  };
}

export function mockApi(src: Sources = {}) {
  const calls: Call[] = [];
  const state = {
    config: src.config ?? baseConfig(),
    status: src.status ?? { status: "inactive", serverOs: "darwin", connectedProviders: [], providers: [] },
  };
  vi.spyOn(globalThis, "fetch").mockImplementation((async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = url.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      body = init?.body;
    }
    calls.push({ method, url: u, body });
    const path = u.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const override = src.routes?.[`${method} ${path}`];
    if (override) {
      const [status, b] = typeof override === "function" ? override() : override;
      return jsonRes(b, status);
    }
    if (path === "/api/config") return jsonRes(method === "PUT" ? { success: true } : { success: true, data: state.config });
    if (path === "/api/tunnel-status-detail") return jsonRes(state.status);
    if (path === "/api/tunnel-status") return jsonRes(state.status);
    if (path === "/api/tunnel-readiness") return jsonRes({ success: true, data: { providers: src.readiness ?? [{ provider: "zrok", state: "disconnected", endpoints: [] }] } });
    if (path === "/api/tunnel/endpoints") return jsonRes({ success: true, data: { endpoints: src.endpoints ?? [] } });
    if (path === "/api/paired-devices") return jsonRes({ success: true, data: [] });
    if (path === "/api/known-servers") return jsonRes({ success: true, data: [], canManage: true });
    if (path === "/api/discover-servers") return jsonRes({ success: true, data: [] });
    return jsonRes({ success: true, data: {} });
  }) as typeof fetch);
  return { calls, state };
}

export function renderDialog(opts: { run?: RunState | null; onClose?: () => void } = {}) {
  const onClose = opts.onClose ?? vi.fn();
  const utils = render(<RemoteAccessDialog onClose={onClose} initialRun={opts.run ?? null} />);
  return { ...utils, onClose };
}

export const READY = (provider: string, state: string, endpoints: unknown[] = []) => ({ provider, state, endpoints });
