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
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { createAdapterWarnOnce } from "./adapter-diagnostic.js";
import type { ToolInvocation } from "./dispatch.js";
import { type ListSessionsArgs, listSessions } from "./list-sessions.js";
import { provisionDashboardEntry } from "./provisioning.js";
import { mountMcpRoutes } from "./routes.js";
import { SubscriptionRegistry } from "./streaming.js";
import { McpTokenRegistry } from "./tokens.js";
import { assertContextPartitionTotal, checkToolCompleteness, MCP_TOOLS } from "./tools.js";

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
  if (!hostVerifyDeviceToken) {
    ctx.logger.error(
      "mcp-server: host service 'host.verifyDeviceToken' is unavailable — device-token callers (Claude Desktop, Cursor, phone) cannot authenticate",
    );
  }
  const verifyDeviceToken = (token: string): string | null =>
    hostVerifyDeviceToken?.(token) ?? null;

  const handlers: Record<string, (inv: ToolInvocation) => Promise<unknown>> = {
    list_sessions: async ({ args }) =>
      // The host exposes `listAll(): unknown[]`; rows are `DashboardSession`s by
      // contract (the same rows the snapshot serves).
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

  const completeness = checkToolCompleteness(MCP_TOOLS, (name) => handlers[name]);
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
    verifyDeviceToken: (token) => verifyDeviceToken(token),
    onMcpRequest: warnAdapterOnce,
    serverInfo: { name: "pi-dashboard", version: process.env.npm_package_version ?? "0.0.0" },
    invokeTool: async (invocation) => {
      const handler = handlers[invocation.tool.name];
      if (!handler) throw new Error(`No handler for tool ${invocation.tool.name}`);
      return handler(invocation);
    },
    recordRefusal: ({ callerSessionId, targetSessionId, tool }) => {
      // G5 — refusals must be observable, with all three identifiers.
      ctx.logger.warn(
        `mcp-server: refused self-target caller=${callerSessionId} target=${targetSessionId} tool=${tool}`,
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
