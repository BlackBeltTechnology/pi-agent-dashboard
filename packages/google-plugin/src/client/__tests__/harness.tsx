/**
 * Shared L1 harness for the Google accounts client: state builders, a scriptable `fetch`, and a render that
 * registers the REAL host `ui:dialog` (focus trap / Escape / focus return) plus fake `ui:oauth-flow` (a paste
 * input wired to `onSendInput`) and `ui:confirm-dialog`. See change: add-google-connect.
 */
import { withUiPrimitiveProvider } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { UiConfirmDialogProps } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { act, render } from "@testing-library/react";
import { vi } from "vitest";
import { GoogleSettings } from "../GoogleSettings.js";
import type { AccountSummary, ClientSummary, GoogleState } from "../types.js";

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

export const STATE_URL = "/api/plugins/google/state";
export const FLOW_URL = "/api/provider-auth/flow/f1";
export const PRIVACY_URL = "https://pi-dashboard.dev/privacy.html";

export const acct = (over: Partial<AccountSummary> & { email: string }): AccountSummary => ({
  sub: `sub-${over.email.split("@")[0]}`,
  client: "builtin",
  status: "ok",
  products: { gmail: { level: "readonly" } },
  addedAt: 1,
  ...over,
});

export const client = (over: Partial<ClientSummary> & { id: string; label: string }): ClientSummary => ({
  ref: `own:${over.id}`,
  type: "installed",
  clientId: `${over.id}.apps.googleusercontent.com`,
  domains: [],
  accounts: 0,
  ...over,
});

export const state = (over: Partial<GoogleState> = {}): GoogleState => ({
  browser: "local",
  builtin: { available: true, ref: "builtin", clientId: "BI-123.apps.googleusercontent.com" },
  clients: [],
  accounts: [],
  autoSetup: { available: false, local: true, reason: "service_missing" },
  disclosure: { version: 1, accepted: true },
  ...over,
});

type Handler = (init?: RequestInit, url?: string) => unknown | Response | Promise<unknown | Response>;
export interface Api {
  fn: ReturnType<typeof vi.fn>;
  /** Calls matching `METHOD path` (path without query), with parsed JSON bodies. */
  calls: (key: string) => unknown[];
  routes: Record<string, Handler>;
}

/** Scriptable fetch: `routes["METHOD /path"]` returns a body (200) or a `Response`. Unknown → 404 `nope`. */
export function mockApi(routes: Record<string, Handler>): Api {
  const log: Array<{ key: string; body: unknown }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    log.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const h = api.routes[key];
    if (!h) return json({ error: "nope" }, 404);
    const out = await h(init, url);
    return out instanceof Response ? out : json(out);
  });
  vi.stubGlobal("fetch", fn);
  const api: Api = { fn, routes, calls: (key) => log.filter((l) => l.key === key).map((l) => l.body) };
  return api;
}

export const pendingStatus = { flowId: "f1", provider: "google", status: "pending", authUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x" };

/** Routes for a started flow: status replies are consumed in order, the last repeats. */
export function flowRoutes(replies: unknown[] = [pendingStatus]): Record<string, Handler> {
  let i = 0;
  return {
    [`GET ${FLOW_URL}`]: () => replies[Math.min(i++, replies.length - 1)],
    [`DELETE ${FLOW_URL}`]: () => ({}),
    [`POST ${FLOW_URL}/input`]: () => ({}),
  };
}

function oauthFlowFake({ flow, onSendInput }: { flow: { status?: { flowId: string } }; onSendInput: (id: string, v: string) => Promise<void> }) {
  const id = flow.status?.flowId ?? "f1";
  return (
    <div data-testid="flow-view">
      <input aria-label="paste" data-testid="flow-paste" />
      <button
        type="button"
        data-testid="flow-paste-submit"
        onClick={() => {
          const v = (document.querySelector('[data-testid="flow-paste"]') as HTMLInputElement).value;
          void onSendInput(id, v).catch(() => {});
        }}
      >
        send
      </button>
    </div>
  );
}

export function renderSettings(el: React.ReactElement = <GoogleSettings />) {
  return render(
    withUiPrimitiveProvider(
      {
        "ui:dialog": Dialog as never,
        "ui:oauth-flow": oauthFlowFake as never,
        "ui:confirm-dialog": (({ message, confirmLabel, onConfirm, onCancel }: UiConfirmDialogProps) => (
          <div data-testid="confirm-dialog">
            <p>{message}</p>
            <button type="button" data-testid="confirm-ok" onClick={onConfirm}>
              {confirmLabel}
            </button>
            <button type="button" data-testid="confirm-cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )) as never,
      },
      el,
    ),
  );
}
