/**
 * Fixtures for the Services page tests: a status/list builder and a `fetch`
 * stub whose replies carry the JSON content-type `services-api.ts` requires.
 * See change: add-services-settings-ui.
 */
import type { ServiceList, ServiceStatus } from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { vi } from "vitest";
import type { UseServices } from "../../../../hooks/useServices.js";

export interface Call {
  url: string;
  method: string;
  body?: unknown;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const ok = (data: unknown): Response => json({ success: true, data });
export const fail = (status: number, error: string, message?: string, extra: Record<string, unknown> = {}): Response =>
  json({ success: false, error, message, ...extra }, status);

export const makeService = (patch: Partial<ServiceStatus> = {}): ServiceStatus => ({
  id: "docling",
  mode: "managed",
  drivers: ["oci:docker"],
  state: "stopped",
  pinned: false,
  leases: 0,
  leaseHolders: [],
  secrets: {},
  ...patch,
});

export const makeList = (services: ServiceStatus[], patch: Partial<ServiceList> = {}): ServiceList => ({
  instanceId: "iid-1",
  canOperate: true,
  services,
  ...patch,
});

type Handler = (call: Call) => Response | Promise<Response> | undefined;

/** Stubs `fetch`; `handler` answers first, then a default (`list`, offers `[]`, runtimes `[]`, else `{}`). */
export function stubServicesFetch(opts: { list?: () => ServiceList; handler?: Handler } = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: { method?: string; body?: string }) => {
      const call: Call = { url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : undefined };
      calls.push(call);
      const custom = opts.handler?.(call);
      if (custom) return Promise.resolve(custom);
      if (call.url === "/api/services" && call.method === "GET") return Promise.resolve(ok((opts.list ?? (() => makeList([])))()));
      if (call.url === "/api/services/offers") return Promise.resolve(ok({ offers: [], errors: [] }));
      if (call.url === "/api/services/runtimes") return Promise.resolve(ok([]));
      return Promise.resolve(ok({}));
    }),
  );
  return calls;
}

export const callsTo = (calls: Call[], method: string, url: string): Call[] => calls.filter((c) => c.method === method && c.url === url);

/** A hand-built `UseServices` for rendering a page without the live hook. */
export function fakeServices(list: ServiceList | null, extra: Partial<UseServices> = {}): UseServices {
  return {
    list,
    loading: list === null,
    error: null,
    refetch: vi.fn(async () => {}),
    canOperate: list?.canOperate === true,
    ...extra,
  };
}
