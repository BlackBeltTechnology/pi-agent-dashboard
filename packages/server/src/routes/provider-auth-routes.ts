/**
 * REST routes for pi provider authentication — OAuth sign-in plus API keys.
 *
 * OAuth is delegated: every flow (PKCE, the loopback callback listener,
 * device-code polling, the code-for-token exchange) belongs to the pi runtime's
 * own `login()`. This module is the host side — it starts a flow, reports what
 * the flow is waiting on, forwards the operator's answer, and cancels. It never
 * constructs an authorization URL.
 *
 * See change: delegate-provider-oauth-to-pi-ai (D2, D6, D7).
 */


// Delegate to the shared platform primitive. The cross-OS dispatch
// (open/start/xdg-open) and URL escaping live in
// `packages/shared/src/platform/commands.ts`.
// See change: consolidate-platform-handlers.
import { openBrowser as platformOpenBrowser } from "@blackbelt-technology/pi-dashboard-shared/platform/commands.js";
import type { FastifyInstance } from "fastify";
import {
  abortAllFlows,
  cancelFlow,
  deleteFlow,
  FLOW_START_TIMEOUT_MS,
  getFlow,
  type OAuthFlow,
  pendingFlowsFor,
  pruneFlows,
  SUPERSEDE_SETTLE_TIMEOUT_MS,
  startFlow,
  startFlowPruneTimer,
  type StartedFlow,
  toFlowStatus,
} from "../auth/provider-auth-adapter.js";
import {
  getOAuthRegistry,
  type OAuthRegistryEntry,
} from "../auth/provider-auth-handlers.js";
import { oauthRegistryReady } from "../auth/provider-auth-registry.js";
import {
  type ApiKeyCredential,
  CredentialTypeConflictError,
  getAuthStatus,
  getOAuthProvidersMeta,
  oauthIdSet,
  removeCredential,
  resolveAuthJsonKey,
  writeCredential,
} from "../auth/provider-auth-storage.js";
import { refreshModelRegistry } from "../model-proxy/registry-singleton.js";
import { getLatestCatalogue, isCatalogueReady } from "../package/provider-catalogue-cache.js";
import type { BrowserGateway } from "../pairing/browser-gateway.js";
import type { PiGateway } from "../pi/pi-gateway.js";

/** Open a URL in the system's default browser */
function openInBrowser(url: string): void {
  platformOpenBrowser(url, {
    onError: (err) => console.error("[provider-auth] Failed to open browser:", err.message),
  });
}

export interface ProviderAuthRouteDeps {
  piGateway: PiGateway;
  browserGateway: BrowserGateway;
  /**
   * Registry override. Production reads the bootstrap-built registry; tests
   * inject a scripted set so no real provider flow is ever started.
   */
  oauthRegistry?: OAuthRegistryEntry[];
  /** Readiness-gate override paired with {@link oauthRegistry}. */
  oauthReady?: Promise<void>;
}

/**
 * Bound how long a supersede waits for the outgoing flow to release its
 * callback port. The wait is the point — a fixed port cannot be bound twice —
 * but it must never hang `/start`.
 */
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

/**
 * Cancel any pending flow for `provider` and WAIT for its listener to close.
 *
 * A provider's callback port is fixed (53692 / 1455) and registered with the
 * provider, so a second start cannot bind it until the first flow's `finally`
 * ran — which happens only once its pending prompt is rejected, i.e. once
 * `login()` settled. Skipping the wait trades a clean 200 for an EADDRINUSE.
 */
async function supersedePendingFlows(provider: string): Promise<void> {
  for (const existing of pendingFlowsFor(provider)) {
    cancelFlow(existing);
    await waitForSettle(existing);
  }
}

/** Which branch of the start handshake won. */
type StartOutcome = "step" | "settled" | "timeout";

/**
 * Answer `POST /start` once the flow produced its first user-facing step, or
 * settled, or went quiet for {@link FLOW_START_TIMEOUT_MS}. The timer is
 * cleared whichever branch wins.
 */
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

// ── Route registration ───────────────────────────────────────────────────────

export function registerProviderAuthRoutes(
  fastify: FastifyInstance,
  deps: ProviderAuthRouteDeps,
) {
  const { piGateway } = deps;
  const registry = (): OAuthRegistryEntry[] => deps.oauthRegistry ?? getOAuthRegistry();
  // Resolved ONCE, at registration: production kicks the build off at boot (so
  // the first request rarely waits for the ~330 ms runtime import); tests inject
  // a settled promise and never touch the SDK.
  const registryReady: Promise<void> = deps.oauthReady ?? oauthRegistryReady();

  function notifyBridges() {
    // Tell every bridge to reload auth.json + refresh its model registry.
    // Each bridge will then push a fresh per-session models_list (and
    // providers_list); browsers pick those up via the existing per-session
    // broadcast and update modelsMap / catalogue cache without needing a
    // global wipe. See change: simplify-model-selection-channels.
    piGateway.broadcast({ type: "credentials_updated" });
    // Eager-refresh model proxy registry so /v1/models reflects the change.
    refreshModelRegistry().catch(() => {});
  }

  // A flow record whose start already failed must not linger: the caller got a
  // non-2xx and has no id to poll.
  function forgetFlow(flow: OAuthFlow): void {
    cancelFlow(flow);
    deleteFlow(flow.id);
  }

  const stopPruneTimer = startFlowPruneTimer();
  fastify.addHook("onClose", async () => {
    stopPruneTimer();
    abortAllFlows();
  });

  // List OAuth providers (id, name, flowType) from the runtime registry.
  fastify.get("/api/provider-auth/providers", async () => {
    await registryReady;
    return getOAuthProvidersMeta(registry());
  });

  // List provider ids the dashboard can drive a login flow for. Catalogue ids
  // absent here = OAuth providers the UI knows about but cannot complete a
  // login for. See change: adopt-pi-071-072-073-features.
  fastify.get("/api/provider-auth/handlers", async () => {
    await registryReady;
    return { ids: registry().map((e) => e.id) };
  });

  // Full status (OAuth + API key)
  fastify.get("/api/provider-auth/status", async () => {
    await registryReady;
    // Cold-cache nudge: if no bridge has pushed a catalogue yet, ask
    // every connected pi to send one. Best-effort, doesn't block this
    // response. See change: replace-hardcoded-provider-lists.
    if (getLatestCatalogue().length === 0) {
      for (const sid of piGateway.getConnectedSessionIds()) {
        piGateway.sendToSession(sid, { type: "request_providers", sessionId: sid });
      }
    }
    return getAuthStatus();
  });

  // Catalogue availability (D5): lets the client distinguish "no api-key
  // credentials" from "the api-key provider list is unavailable". A separate
  // route on purpose — the /status body is a bare array clients pin, and a
  // header is invisible to non-browser consumers. See change:
  // redesign-providers-settings-page.
  fastify.get("/api/provider-auth/catalogue-ready", async () => {
    return { ready: isCatalogueReady() };
  });

  // Start a sign-in flow of any shape. Answers once the flow produced its
  // first user-facing step (authorization URL, device code, or an answerable
  // prompt), or failed, or went quiet for 15 s.
  fastify.post<{ Body: { provider?: unknown; enterpriseDomain?: unknown } }>(
    "/api/provider-auth/start",
    async (request, reply) => {
      await registryReady;
      pruneFlows();

      const body = request.body ?? {};
      const provider = typeof body.provider === "string" ? body.provider : "";
      const entry = registry().find((e) => e.id === provider);
      if (!entry) {
        return reply.code(400).send({ error: `Unknown OAuth provider: ${provider}` });
      }

      await supersedePendingFlows(provider);

      const started = startFlow({
        provider,
        loginFlow: entry.auth,
        // A blank string is meaningful ("github.com"); null / 42 / absent are
        // not pre-answers at all.
        preAnswers:
          typeof body.enterpriseDomain === "string" ? [body.enterpriseDomain] : [],
        writeCredential,
        notifyBridges,
        openInBrowser,
      });

      const outcome = await awaitStartOutcome(started);
      if (outcome === "timeout") {
        forgetFlow(started.flow);
        return reply.code(504).send({ error: "Provider did not respond" });
      }
      if (outcome === "settled" && started.flow.status !== "complete") {
        // Failed before producing anything to render: there is no id worth
        // polling, so the message travels in this response.
        const message = started.flow.error ?? "Provider login failed";
        forgetFlow(started.flow);
        return reply.code(500).send({ error: message });
      }
      return toFlowStatus(started.flow);
    },
  );

  // Poll a flow's status.
  fastify.get<{ Params: { flowId: string } }>(
    "/api/provider-auth/flow/:flowId",
    async (request, reply) => {
      await registryReady;
      pruneFlows();
      const flow = getFlow(request.params.flowId);
      if (!flow) return reply.code(404).send({ error: "Invalid or expired flow" });
      return toFlowStatus(flow);
    },
  );

  // Answer the flow's currently pending prompt. The value may be a secret
  // (authorization code / a redirect URL carrying one), so it is handed to the
  // flow unchanged and NEVER logged, persisted, or echoed back.
  fastify.post<{ Params: { flowId: string }; Body: { value?: unknown } }>(
    "/api/provider-auth/flow/:flowId/input",
    async (request, reply) => {
      await registryReady;
      pruneFlows();
      const flow = getFlow(request.params.flowId);
      if (!flow) return reply.code(404).send({ error: "Invalid or expired flow" });
      const resolve = flow.resolveInput;
      if (!resolve) {
        return reply.code(409).send({ error: "No input pending for this flow" });
      }
      resolve(typeof request.body?.value === "string" ? request.body.value : "");
      return reply.code(202).send({ ok: true });
    },
  );

  // Cancel a flow. The record stays readable until pruned so the caller can
  // observe `status: "error", error: "Cancelled"`.
  fastify.delete<{ Params: { flowId: string } }>(
    "/api/provider-auth/flow/:flowId",
    async (request, reply) => {
      await registryReady;
      pruneFlows();
      const flow = getFlow(request.params.flowId);
      if (!flow) return reply.code(404).send({ error: "Invalid or expired flow" });
      cancelFlow(flow);
      return reply.code(204).send();
    },
  );

  // Save API key
  fastify.put<{ Body: { provider: string; key: string } }>(
    "/api/provider-auth/api-key",
    async (request, reply) => {
      await registryReady;
      const { provider, key } = request.body ?? {};
      if (!provider || !key) return reply.code(400).send({ error: "provider and key required" });
      try {
        // Resolve the authJsonKey for API key providers (e.g., "anthropic-api" → "anthropic")
        const authJsonKey = resolveAuthJsonKey(provider);
        const credential: ApiKeyCredential = { type: "api_key", key };
        await writeCredential(authJsonKey, credential);
        notifyBridges();
        return { ok: true };
      } catch (err: any) {
        // D2 — a cross-type clobber is a CONFLICT, not a server fault: 409 with
        // the stable machine code + the stored type, so the client renders a
        // translated message. See change: redesign-providers-settings-page.
        if (err instanceof CredentialTypeConflictError) {
          return reply.code(409).send({
            error: err.message,
            code: err.code,
            vars: { storedType: err.storedType },
          });
        }
        request.log.error(err, "Failed to save API key");
        return reply.code(500).send({ error: err.message || "Failed to save API key" });
      }
    },
  );

  // Remove credential. A refusal (cross-type removal per D2/X2, or corrupt
  // auth.json whose bytes could not be backed up) maps to the SAME { error,
  // code, vars } shape PUT returns, so the Settings UI can show why. See
  // changes: fix-corrupt-auth-json-500, redesign-providers-settings-page,
  // delegate-provider-oauth-to-pi-ai (the row-kind union now includes ids with
  // a stored OAuth credential that the registry does not list).
  fastify.delete<{ Params: { provider: string } }>(
    "/api/provider-auth/:provider",
    async (request, reply) => {
      await registryReady;
      try {
        const rawId = request.params.provider;
        // The kind of the row the removal was addressed to: "oauth" for an
        // OAuth id (the Subscription row, registry-listed or stored), "api_key"
        // otherwise — including an `<id>-api` twin, which resolves to the bare
        // id. A stored OAuth credential must not be revocable through the
        // api-key row (X2).
        const isOAuthRow = oauthIdSet().has(rawId);
        const authJsonKey = resolveAuthJsonKey(rawId);
        await removeCredential(authJsonKey, isOAuthRow ? "oauth" : "api_key");
      } catch (err: any) {
        if (err instanceof CredentialTypeConflictError) {
          return reply.code(409).send({
            error: err.message,
            code: err.code,
            vars: { storedType: err.storedType },
          });
        }
        request.log.error(err, "Failed to remove credential");
        return reply.code(500).send({ error: err.message || "Failed to remove credential" });
      }
      notifyBridges();
      return { ok: true };
    },
  );
}
