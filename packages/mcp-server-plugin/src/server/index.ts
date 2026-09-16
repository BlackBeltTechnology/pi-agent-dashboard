/**
 * mcp-server-plugin · SERVER entry.
 *
 * Mounts `POST /mcp` on the shared Fastify instance handed to every plugin
 * (`ctx.fastify`), exactly as seven other plugins already do. Registration is
 * synchronous because routes must exist before `fastify.listen`.
 *
 * Wiring notes that are decisions, not detail:
 *
 * - The token registry is created HERE and never persisted, so it dies with the
 *   plugin. A plugin load failure therefore leaves no credential behind (X8),
 *   and a restart invalidates everything at once (X9).
 *
 * - Minting is driven only by `registerPiHandler`, i.e. messages arriving over
 *   a session's own bridge socket. The sessionId comes from the dispatch key,
 *   never from the message body — that is the whole basis of Decision 6, and
 *   why minting for a foreign session is unrepresentable rather than merely
 *   rejected.
 *
 * - Provisioning failure is logged, never thrown: writing `mcp.json` is a
 *   convenience for local pi sessions, not a precondition for serving `/mcp`
 *   (J7).
 *
 * See change: extract-mcp-client-plugin (tasks 6.1, 6.2).
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import {
  createRealConfigIO,
  type McpClientConfigService,
} from "@blackbelt-technology/pi-dashboard-mcp-client-plugin/core";
import { createAdapterWarnOnce } from "./adapter-diagnostic.js";
import type { ToolInvocation } from "./dispatch.js";
import { GENERATED_TOOLS } from "./generated/tools.js";
import { type ListSessionsArgs, listSessions, validateListSessionsArgs } from "./list-sessions.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { provisionDashboardEntry } from "./provisioning.js";
import { mountMcpRoutes } from "./routes.js";
import { filterToolsByRoute } from "./route-skew.js";
import { SubscriptionRegistry } from "./streaming.js";
import { McpTokenRegistry } from "./tokens.js";
import { assertContextPartitionTotal, checkToolCompleteness } from "./tools.js";

const PLUGIN_ID = "mcp-server";

/** Bridge message names this plugin answers on a session's own socket. */
const MINT_MESSAGE = "mcp/mint-token";
const REVOKE_MESSAGE = "mcp/revoke-token";

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("mcp-server plugin server entry activated");

  // Fail loudly at load rather than advertising a tool that cannot be called.
  // The denylist.ts lesson: an advertised-but-dead tool is worse than an absent
  // one, because the client believes the call landed.
  const partition = assertContextPartitionTotal();
  if (!partition.ok) {
    ctx.logger.error(
      `mcp-server: ServerPluginContext partition is incomplete — unclassified: ${partition.unclassified.join(", ")}; overlapping: ${partition.overlapping.join(", ")}`,
    );
  }

  const tokens = new McpTokenRegistry();
  const subscriptions = new SubscriptionRegistry();

  // Resolved once at load and asserted: a missing host service would silently
  // refuse every device bearer (401 on every external-client request), and the
  // unit suite cannot see it because it injects this dependency directly.
  const hostVerifyDeviceToken = ctx.consume<(t: string) => string | null>(
    "host.verifyDeviceToken",
  );
  // Tier-aware companion (change: expand-mcp-tiered-surface, D1). Preferred
  // when a host provides it; absent against an older host, where the id-only
  // service is used and every device token reads as `operate`.
  const hostVerifyDeviceTokenTier = ctx.consume<
    (t: string) => { id: string; tier: import("@blackbelt-technology/pi-dashboard-shared/tiers.js").Tier } | null
  >("host.verifyDeviceTokenTier");
  if (!hostVerifyDeviceTokenTier) {
    ctx.logger.info(
      "mcp-server: host service 'host.verifyDeviceTokenTier' is unavailable — device tokens resolve to the operate tier (old host)",
    );
  }
  if (!hostVerifyDeviceToken && !hostVerifyDeviceTokenTier) {
    ctx.logger.error(
      "mcp-server: host service 'host.verifyDeviceToken' is unavailable — device-token callers (Claude Desktop, Cursor, phone) cannot authenticate",
    );
  }
  const verifyDeviceToken = (token: string): string | null =>
    hostVerifyDeviceToken?.(token) ?? hostVerifyDeviceTokenTier?.(token)?.id ?? null;

  const handlers: Record<string, (inv: ToolInvocation) => Promise<unknown>> = {
    list_sessions: async ({ args }) =>
      // Bounded, filterable, cursor-paged (change: paginate-mcp-list-sessions).
      listSessions(ctx.sessionManager.listAll() as DashboardSession[], args as ListSessionsArgs),
    send_prompt: async ({ args }) => ({
      delivered: ctx.sendToSession(args.sessionId as string, args.text as string),
    }),
    spawn_session: async ({ args }) => ctx.spawnSession({ cwd: args.cwd as string }),
    abort: async ({ args }) => {
      const aborted = await ctx.abortSession(args.sessionId as string);
      // X4: abortSession returns false for a disconnected bridge. Reporting it
      // as `aborted:false` rather than a bare success is the whole point — a
      // false success would tell the caller a no-op worked.
      return { aborted };
    },
  };

  // Route-skew guard (D4): a published plugin may run against an older host
  // that lacks some REST routes. Drop those rows from the advertised surface
  // with one warning each, rather than advertising a tool that 404s.
  const tools = filterToolsByRoute(
    GENERATED_TOOLS,
    (method, url) => ctx.fastify.hasRoute({ method: method as never, url }),
    (m) => ctx.logger.warn(m),
  );
  const advertised = new Set(tools.map((t) => t.name));

  const completeness = checkToolCompleteness(tools, (name) =>
    advertised.has(name) ? () => undefined : undefined,
  );
  if (!completeness.ok) {
    ctx.logger.error(
      `mcp-server: advertised tools without a handler: ${completeness.missing.join(", ")}`,
    );
  }

  // Lazy, once-per-process adapter-version diagnostic. Emitted on the first
  // `/mcp` request (not at registration) and only when the consumed service's
  // verdict is not `ok`; a missing service reads as `unknown`.
  const warnAdapterOnce = createAdapterWarnOnce(ctx.logger, () =>
    ctx.consume<McpClientConfigService>("mcp-client.config"),
  );

  await mountMcpRoutes(ctx.fastify, {
    tokens,
    tools,
    verifyDeviceToken: (token) => verifyDeviceToken(token),
    verifyDeviceTokenTier: hostVerifyDeviceTokenTier ?? undefined,
    onMcpRequest: warnAdapterOnce,
    serverInfo: { name: "pi-dashboard", version: process.env.npm_package_version ?? "0.0.0" },
    invokeTool: async (invocation) => {
      const handler = handlers[invocation.tool.name];
      if (!handler) throw new Error(`No handler for tool ${invocation.tool.name}`);
      return handler(invocation);
    },
    // REST-bound tools execute through the live Fastify instance with caller
    // identity (D4). `origin` is forwarded ONLY for genuinely-local callers
    // (see dispatch's `injectIdentity`); session callers are excluded here too.
    inject: async ({ method, url, payload, headers, remoteAddress }) => {
      const res = await ctx.fastify.inject({
        method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        url,
        ...(payload !== undefined ? { payload: payload as object } : {}),
        ...(headers ? { headers } : {}),
        ...(remoteAddress ? { remoteAddress } : {}),
      });
      let body: unknown = res.body;
      try {
        body = res.json();
      } catch {
        /* non-JSON body stays as text */
      }
      return { statusCode: res.statusCode, body };
    },
    // Session-bound tools forward to the owning bridge.
    sendToSession: (sessionId, message) => ctx.sendToSession(sessionId, message as never),
    // Tool-specific argument checks beyond the generated schema shape — the
    // bound/filter/cursor rules the list_sessions page owns.
    validateToolArgs: (name, args) =>
      name === "list_sessions" ? validateListSessionsArgs(args) : null,
    recordRefusal: ({ callerSessionId, targetSessionId, tool }) => {
      // G5 — refusals must be observable, with all three identifiers.
      ctx.logger.warn(
        `mcp-server: refused self-target caller=${callerSessionId} target=${targetSessionId} tool=${tool}`,
      );
    },
    // D2/observability — an out-of-tier call is logged with caller identity,
    // tool name, caller tier and required tier.
    recordTierRefusal: ({ caller, tool, callerTier, requiredTier }) => {
      const who =
        caller.kind === "session" ? `session=${caller.sessionId}` : `device=${caller.deviceId}`;
      ctx.logger.warn(
        `mcp.tier_refused caller=${who} tool=${tool} callerTier=${callerTier} requiredTier=${requiredTier}`,
      );
    },
    // `subscriptions/listen` is intercepted by the route layer before dispatch
    // (it needs the live reply to hijack), so no `openSubscription` hook is
    // needed here. `streamingAvailable` reflects the real wiring below.
    streamingAvailable: true,
    streaming: {
      registry: subscriptions,
      source: { onEvent: (handler) => ctx.onEvent(handler) },
    },
    log: {
      info: (m) => ctx.logger.info(m),
      warn: (m) => ctx.logger.warn(m),
      error: (m) => ctx.logger.error(m),
    },
  });

  // --- Token lifecycle over the bridge (Decision 6 / 8) ---------------------

  ctx.registerPiHandler(MINT_MESSAGE, (msg: unknown, sessionId: string) => {
    // `sessionId` is supplied by the gateway from the socket's own key. Nothing
    // in `msg` influences attribution, so minting for a foreign session has no
    // representation on the wire (M4).
    const token = tokens.mintForSession(sessionId);
    ctx.logger.info(`mcp-server: minted a token for session ${sessionId}`);
    // D5: the plaintext travels back on the session-private extension lane —
    // registerPiHandler return values are DISCARDED by the dispatcher, so a
    // `return { token }` here was dead code and the delivery path never had a
    // wire. X1: a closed bridge socket surfaces as `false` — logged with the
    // session id, never a throw, and /mcp keeps serving other callers.
    const delivered = ctx.sendExtensionMessage(sessionId, { type: "mcp_token_minted", token });
    if (!delivered) {
      ctx.logger.warn(
        `mcp-server: could not deliver the minted token to session ${sessionId} (bridge unreachable)`,
      );
    }
  });

  ctx.registerPiHandler(REVOKE_MESSAGE, (msg: unknown, sessionId: string) => {
    const revoked = tokens.revokeSession(sessionId);
    ctx.logger.info(`mcp-server: revoked ${revoked} token(s) for session ${sessionId}`);
    return { revoked };
  });

  ctx.onSessionEnded((sessionId: string) => {
    const revoked = tokens.revokeSession(sessionId);
    if (revoked > 0) {
      ctx.logger.info(`mcp-server: session ${sessionId} ended, ${revoked} token(s) died with it`);
    }
  });

  // --- Provisioning ---------------------------------------------------------

  // A live getter — the bound port is unknown until listen() resolves, so a
  // boot-time snapshot would provision a URL pointing at the wrong address on
  // any non-default port.
  const port = ctx.consume<() => number | null>("host.httpPort")?.() ?? 8000;
  const result = provisionDashboardEntry(createRealConfigIO(), {
    url: `http://127.0.0.1:${port}/mcp`,
  });
  if (!result.ok) {
    ctx.logger.warn(`mcp-server: could not provision mcp.json (${result.state}): ${result.message}`);
  } else {
    ctx.logger.info(`mcp-server: mcp.json entry ${result.action}`);
  }

  ctx.provide(`${PLUGIN_ID}.disposeForTest`, () => {
    // Order matters: release streams (which hold event-bus listeners) before
    // dropping the tokens they were authorised by.
    subscriptions.closeAll();
    tokens.dispose();
  });
}

export default registerPlugin;
