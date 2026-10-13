/**
 * Shared fixtures for the Vault settings tests: a `fetch` stub whose replies carry the JSON
 * content-type `vault-api.ts` now requires, plus an overview builder.
 * See change: retro-ux-credential-vault (task 3.10).
 */
import { vi } from "vitest";
import type { VaultOverview } from "../../../../lib/vault/vault-api.js";

export interface Call {
  url: string;
  method: string;
  body?: unknown;
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const ok = (data: unknown): Response => jsonResponse({ success: true, data });
export const fail = (status: number, error: string, message?: string): Response => jsonResponse({ success: false, error, message }, status);
/** The SPA shell answering an `/api` route this server does not have. */
export const html = (status = 200): Response => new Response("<!DOCTYPE html><html></html>", { status, headers: { "content-type": "text/html" } });

export const makeOverview = (patch: Partial<VaultOverview> = {}): VaultOverview => ({
  status: { state: "ok" },
  accounts: [],
  bindings: [],
  grants: [],
  confirmations: [],
  pluginApprovals: [],
  plugins: [],
  ...patch,
});

type Handler = (call: Call) => Response | Promise<Response> | undefined;

/**
 * Stubs `fetch`. `handler` answers first; anything it leaves undefined gets a default reply
 * (current overview, no import candidates, no projects, `{}`). Returns the recorded calls.
 */
export function stubVaultFetch(opts: { overview?: () => unknown; handler?: Handler } = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: { method?: string; body?: string }) => {
      const call: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const custom = opts.handler?.(call);
      if (custom) return Promise.resolve(custom);
      if (call.url === "/api/vault" && call.method === "GET") return Promise.resolve(ok(opts.overview?.() ?? makeOverview()));
      if (call.url === "/api/vault/import/candidates") return Promise.resolve(ok([]));
      if (call.url === "/api/vault/projects") return Promise.resolve(ok({ open: [], recent: [] }));
      return Promise.resolve(ok({}));
    }),
  );
  return calls;
}

export const callsTo = (calls: Call[], method: string, url: string): Call[] => calls.filter((c) => c.method === method && c.url === url);
