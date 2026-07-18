/**
 * REST routes for browser-based pi provider authentication.
 */
import type { FastifyInstance } from "fastify";
import {
  getProviderHandler,
  getAllHandlers,
  generatePKCE,
  generateState,
  type AuthCodeHandler,
  type DeviceCodeHandler,
  type PKCEPair,
} from "../auth/provider-auth-handlers.js";
import {
  writeCredential,
  removeCredential,
  getAuthStatus,
  getOAuthProvidersMeta,
  resolveAuthJsonKey,
  type ApiKeyCredential,
} from "../auth/provider-auth-storage.js";
import { getLatestCatalogue } from "../package/provider-catalogue-cache.js";
import { startCallbackServer } from "../auth/oauth-callback-server.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import type { BrowserGateway } from "../pairing/browser-gateway.js";
import { refreshModelRegistry } from "../model-proxy/registry-singleton.js";

// ── In-memory flow store (short-lived PKCE + device code state) ──────────────

interface AuthCodeFlow {
  providerId: string;
  pkce: PKCEPair;
  state: string;
  redirectUri: string;
  createdAt: number;
}

interface DeviceCodeFlow {
  providerId: string;
  deviceCode: string;
  interval: number;
  expiresIn: number;
  extra?: Record<string, unknown>;
  status: "pending" | "complete" | "error" | "expired";
  error?: string;
  createdAt: number;
}

const authCodeFlows = new Map<string, AuthCodeFlow>();
const deviceCodeFlows = new Map<string, DeviceCodeFlow>();

// Expire flows after 10 minutes
const FLOW_TTL_MS = 10 * 60 * 1000;

function pruneFlows() {
  const now = Date.now();
  for (const [id, f] of authCodeFlows) {
    if (now - f.createdAt > FLOW_TTL_MS) authCodeFlows.delete(id);
  }
  for (const [id, f] of deviceCodeFlows) {
    if (now - f.createdAt > FLOW_TTL_MS) deviceCodeFlows.delete(id);
  }
}

function makeFlowId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Delegate to the shared platform primitive. The cross-OS dispatch
// (open/start/xdg-open) and URL escaping live in
// `packages/shared/src/platform/commands.ts`.
// See change: consolidate-platform-handlers.
import { openBrowser as platformOpenBrowser } from "@blackbelt-technology/pi-dashboard-shared/platform/commands.js";

/** Open a URL in the system's default browser */
function openInBrowser(url: string): void {
  platformOpenBrowser(url, {
    onError: (err) => console.error("[provider-auth] Failed to open browser:", err.message),
  });
}

// ── Route registration ───────────────────────────────────────────────────────

export function registerProviderAuthRoutes(
  fastify: FastifyInstance,
  deps: { piGateway: PiGateway; browserGateway: BrowserGateway },
) {
  const { piGateway, browserGateway } = deps;

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

  // List OAuth providers
  fastify.get("/api/provider-auth/providers", async () => {
    return getOAuthProvidersMeta();
  });

  // List provider ids the dashboard's hand-written handler registry can
  // drive. Catalogue ids absent here = OAuth providers the UI knows about
  // but the dashboard cannot complete a login flow for. See change:
  // adopt-pi-071-072-073-features.
  fastify.get("/api/provider-auth/handlers", async () => {
    return { ids: getAllHandlers().map((h) => h.providerId) };
  });

  // Full status (OAuth + API key)
  fastify.get("/api/provider-auth/status", async () => {
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

  // Start auth-code flow — opens system browser, starts temp callback server
  fastify.post<{ Body: { provider: string } }>("/api/provider-auth/authorize", async (request, reply) => {
    pruneFlows();
    const { provider } = request.body ?? {};
    const handler = getProviderHandler(provider);
    if (!handler || handler.flowType !== "auth_code") {
      return reply.code(400).send({ error: `Unknown auth-code provider: ${provider}` });
    }
    const h = handler as AuthCodeHandler;
    const pkce = await generatePKCE();
    const state = generateState();
    const redirectUri = `http://localhost:${h.callbackPort}${h.callbackPath}`;
    const authUrl = h.buildAuthUrl(redirectUri, state, pkce);
    const flowId = makeFlowId();
    authCodeFlows.set(flowId, { providerId: provider, pkce, state, redirectUri, createdAt: Date.now() });

    // Start temp callback server to receive the OAuth redirect
    try {
      await startCallbackServer({
        providerId: provider,
        port: h.callbackPort,
        path: h.callbackPath,
        onCode: async (code, cbState) => {
          const flow = Array.from(authCodeFlows.values()).find(
            (f) => f.providerId === provider && f.state === (cbState || state),
          );
          if (!flow) throw new Error("Unknown or expired flow");
          // Remove the flow
          for (const [id, f] of authCodeFlows) {
            if (f === flow) { authCodeFlows.delete(id); break; }
          }
          const credential = await h.exchangeCode(code, flow.redirectUri, flow.pkce, flow.state);
          writeCredential(flow.providerId, credential);
          notifyBridges();
        },
      });
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }

    // Open the auth URL in the system browser
    openInBrowser(authUrl);

    return { flowId, authUrl };
  });

  // Start device-code flow
  fastify.post<{ Body: { provider: string; enterpriseDomain?: string } }>(
    "/api/provider-auth/device-code",
    async (request, reply) => {
      pruneFlows();
      const { provider, enterpriseDomain } = request.body ?? {};
      const handler = getProviderHandler(provider);
      if (!handler || handler.flowType !== "device_code") {
        return reply.code(400).send({ error: `Unknown device-code provider: ${provider}` });
      }
      const h = handler as DeviceCodeHandler;
      try {
        const dc = await h.requestDeviceCode(enterpriseDomain);
        const flowId = makeFlowId();
        deviceCodeFlows.set(flowId, {
          providerId: provider,
          deviceCode: dc.deviceCode,
          interval: dc.interval,
          expiresIn: dc.expiresIn,
          extra: dc.extra,
          status: "pending",
          createdAt: Date.now(),
        });
        // Start polling in background
        pollDeviceCode(flowId, h).catch(() => {});
        return {
          flowId,
          userCode: dc.userCode,
          verificationUri: dc.verificationUri,
          expiresIn: dc.expiresIn,
          interval: dc.interval,
        };
      } catch (err: any) {
        return reply.code(400).send({ error: err.message });
      }
    },
  );

  // Poll device-code status
  fastify.get<{ Params: { flowId: string } }>(
    "/api/provider-auth/device-status/:flowId",
    async (request, reply) => {
      const flow = deviceCodeFlows.get(request.params.flowId);
      if (!flow) return reply.code(404).send({ error: "Unknown flow" });
      return { status: flow.status, error: flow.error };
    },
  );

  // Save API key
  fastify.put<{ Body: { provider: string; key: string } }>(
    "/api/provider-auth/api-key",
    async (request, reply) => {
      const { provider, key } = request.body ?? {};
      if (!provider || !key) return reply.code(400).send({ error: "provider and key required" });
      try {
        // Resolve the authJsonKey for API key providers (e.g., "anthropic-api" → "anthropic")
        const authJsonKey = resolveAuthJsonKey(provider);
        const credential: ApiKeyCredential = { type: "api_key", key };
        writeCredential(authJsonKey, credential);
        notifyBridges();
        return { ok: true };
      } catch (err: any) {
        request.log.error(err, "Failed to save API key");
        return reply.code(500).send({ error: err.message || "Failed to save API key" });
      }
    },
  );

  // Remove credential
  fastify.delete<{ Params: { provider: string } }>(
    "/api/provider-auth/:provider",
    async (request) => {
      const authJsonKey = resolveAuthJsonKey(request.params.provider);
      removeCredential(authJsonKey);
      notifyBridges();
      return { ok: true };
    },
  );

  // ── Device-code background poller ──────────────────────────────────────────

  async function pollDeviceCode(flowId: string, handler: DeviceCodeHandler) {
    const flow = deviceCodeFlows.get(flowId);
    if (!flow) return;
    try {
      const credential = await handler.pollForToken(
        flow.deviceCode, flow.interval, flow.expiresIn, flow.extra,
      );
      writeCredential(flow.providerId, credential);
      notifyBridges();
      flow.status = "complete";
    } catch (err: any) {
      flow.status = err.message?.includes("expired") ? "expired" : "error";
      flow.error = err.message;
    }
  }
}
