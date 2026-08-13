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
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { type ToolInvocation } from "./dispatch.js";
import { probeAdapterVersion, provisionDashboardEntry } from "./provisioning.js";
import { mountMcpRoutes } from "./routes.js";
import { SubscriptionRegistry, type StreamSink } from "./streaming.js";
import { McpTokenRegistry } from "./tokens.js";
import { MCP_TOOLS, checkToolCompleteness, assertContextPartitionTotal } from "./tools.js";

const PLUGIN_ID = "mcp-server";

/** Bridge message names this plugin answers on a session's own socket. */
const MINT_MESSAGE = "mcp/mint-token";
const REVOKE_MESSAGE = "mcp/revoke-token";

function mcpConfigPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "mcp.json");
}

/**
 * Read the installed `pi-mcp-adapter` version from disk.
 *
 * Resolved here rather than consumed from a host service, because there is no
 * such service — consuming a name nobody registers yields `null` forever and
 * makes the probe report "not installed" even when it is, which is worse than
 * no diagnostic at all.
 */
function readInstalledAdapterVersion(): string | null {
  const candidates = [
    path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "pi-mcp-adapter", "package.json"),
    path.join(os.homedir(), ".pi", "agent", "node_modules", "pi-mcp-adapter", "package.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = fs.readFileSync(p, "utf8");
      const version = (JSON.parse(raw) as { version?: unknown }).version;
      if (typeof version === "string") return version;
    } catch {
      /* not installed at this location; try the next */
    }
  }
  return null;
}

/** Atomic write: temp file in the same directory, then rename. */
function writeFileAtomic(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, target);
}

export async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.logger.info("mcp-server plugin server entry activated");

  // TEMPORARY BISECT COMMIT — revert before merge.
  //
  // `job-object-windows` fails with "app never brought a server up on :8000"
  // on this branch only; the same workflow is green on every other recent
  // branch, and the Linux equivalent passes. This early return keeps the
  // package BUNDLED and IMPORTED (so `bundled-plugins-complete` still passes)
  // while doing none of its runtime work.
  //
  //   Windows goes GREEN -> the cause is this function's runtime work
  //                         (route mounting / provisioning / adapter probe).
  //   Windows stays RED  -> the cause is packaging or module import, not
  //                         anything registerPlugin does.
  if (process.env.MCP_SERVER_PLUGIN_BISECT !== "off") {
    ctx.logger.warn("mcp-server: BISECT no-op active; endpoint NOT mounted");
    return;
  }

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
    list_sessions: async () => ({ sessions: ctx.sessionManager.listAll() }),
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

  await mountMcpRoutes(ctx.fastify, {
    tokens,
    verifyDeviceToken: (token) => verifyDeviceToken(token),
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
    return { token };
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

  const adapterVersion = readInstalledAdapterVersion();
  const probe = probeAdapterVersion(adapterVersion);
  if (!probe.ok) {
    // A warning, not a failure: the endpoint serves external clients fine
    // without a local adapter. Only the local-pi path needs the floor.
    ctx.logger.warn(`mcp-server: ${probe.message}`);
  }

  // A live getter — the bound port is unknown until listen() resolves, so a
  // boot-time snapshot would provision a URL pointing at the wrong address on
  // any non-default port.
  const port = ctx.consume<() => number | null>("host.httpPort")?.() ?? 8000;
  const result = provisionDashboardEntry(
    { readFile: (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null), writeFileAtomic },
    mcpConfigPath(),
    `http://127.0.0.1:${port}/mcp`,
  );
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
