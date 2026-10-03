/**
 * `beginFlow()` — the start robustness shared by `POST /api/provider-auth/start`
 * and the plugin OAuth seam (`ctx.oauth.startFlow`):
 *
 * - per-provider `queueStart` + supersede (a fixed callback port cannot be
 *   bound twice, so `supersede → start → bind` is atomic per provider);
 * - the `awaitStartOutcome` race of first step / settled / FLOW_START_TIMEOUT_MS;
 * - `forgetFlow` on an early failure (the caller gets no id to poll);
 * - `openInBrowser` for the first auth URL, suppressed under vitest.
 *
 * See change: expose-plugin-credential-and-oauth-seams (D3); moved verbatim
 * from provider-auth-routes.ts (delegate-provider-oauth-to-pi-ai).
 */

import { openBrowser as platformOpenBrowser } from "@blackbelt-technology/pi-dashboard-shared/platform/commands.js";
import {
  cancelFlow,
  deleteFlow,
  FLOW_START_TIMEOUT_MS,
  loadPiDeviceId,
  type OAuthFlow,
  pendingFlowsFor,
  pruneFlows,
  type StartedFlow,
  type StartFlowParams,
  SUPERSEDE_SETTLE_TIMEOUT_MS,
  startFlow,
} from "./provider-auth-adapter.js";

/** Flow `provider` prefix for plugin-started flows: `plugin:<pluginId>:<key>`. */
const PLUGIN_FLOW_PREFIX = "plugin:";

export function pluginFlowProvider(pluginId: string, key: string): string {
  return `${PLUGIN_FLOW_PREFIX}${pluginId}:${key}`;
}

export function isPluginFlow(flow: Pick<OAuthFlow, "provider">): boolean {
  return flow.provider.startsWith(PLUGIN_FLOW_PREFIX);
}

/**
 * Open a URL in the system's default browser.
 *
 * Suppressed under vitest: tests drive scripted fake flows whose `auth_url`
 * events carry fixture URLs; without this guard every `npm test` run spawns
 * real `open`/`xdg-open` calls. Same shape as `auth/test-env-guard.ts`.
 */
function openInBrowser(url: string): void {
  if (process.env.VITEST === "true") {
    console.warn("[provider-auth] browser open suppressed under vitest:", url);
    return;
  }
  platformOpenBrowser(url, {
    onError: (err) => console.error("[provider-auth] Failed to open browser:", err.message),
  });
}

/** Bound how long a supersede waits for the outgoing flow to release its port. */
async function waitForSettle(flow: OAuthFlow): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      flow.settled,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SUPERSEDE_SETTLE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Cancel any pending flow for `provider` and WAIT for its listener to close. */
async function supersedePendingFlows(provider: string): Promise<void> {
  for (const existing of pendingFlowsFor(provider)) {
    cancelFlow(existing);
    await waitForSettle(existing);
  }
}

/** Which branch of the start handshake won. */
type StartOutcome = "step" | "settled" | "timeout";

async function awaitStartOutcome(started: StartedFlow): Promise<StartOutcome> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      started.firstEvent.then((): StartOutcome => "step"),
      started.settled.then((): StartOutcome => "settled"),
      new Promise<StartOutcome>((resolve) => {
        timer = setTimeout(() => resolve("timeout"), FLOW_START_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Per-provider start chain. One entry per provider (the tail of its chain), so
 * the map stays bounded by the provider/key count.
 */
const startTails = new Map<string, Promise<void>>();

function queueStart<T>(provider: string, run: () => Promise<T>): Promise<T> {
  const tail = startTails.get(provider) ?? Promise.resolve();
  // `run` on BOTH outcomes: a failed predecessor must not wedge the provider.
  const next = tail.then(run, run);
  startTails.set(
    provider,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** A flow record whose start failed must not linger: the caller has no id. */
function forgetFlow(flow: OAuthFlow): void {
  cancelFlow(flow);
  deleteFlow(flow.id);
}

export type BeginFlowParams = Omit<StartFlowParams, "openInBrowser"> & {
  /** Open the first auth URL in the local browser. Default true. */
  openBrowser?: boolean;
};

export type BeginFlowResult =
  | { ok: true; flow: OAuthFlow }
  | { ok: false; code: "start_timeout" | "login_failed"; message: string };

/**
 * Start a flow with the shared robustness. `ok:true` once the flow produced a
 * first user-facing step (or completed); `start_timeout` after 15 s of quiet;
 * `login_failed` when it settled unsuccessfully before any step. On failure
 * the record is forgotten.
 */
export async function beginFlow(params: BeginFlowParams): Promise<BeginFlowResult> {
  pruneFlows();
  const { openBrowser = true, ...startParams } = params;
  let started: StartedFlow | undefined;
  let outcome: StartOutcome = "timeout";
  await queueStart(params.provider, async () => {
    await supersedePendingFlows(params.provider);
    // pi 1.0.0 Sign in with ChatGPT needs `getDeviceId`. See change: update-pi-core-1-0-adopt-apis.
    await loadPiDeviceId();
    started = startFlow({ ...startParams, ...(openBrowser ? { openInBrowser } : {}) });
    outcome = await awaitStartOutcome(started);
  });
  if (!started) return { ok: false, code: "login_failed", message: "Provider login failed" };

  const flow = (started as StartedFlow).flow;
  if (outcome === "timeout") {
    forgetFlow(flow);
    return { ok: false, code: "start_timeout", message: "Provider did not respond" };
  }
  if (outcome === "settled" && flow.status !== "complete") {
    const message = flow.error ?? "Provider login failed";
    forgetFlow(flow);
    return { ok: false, code: "login_failed", message };
  }
  return { ok: true, flow };
}
