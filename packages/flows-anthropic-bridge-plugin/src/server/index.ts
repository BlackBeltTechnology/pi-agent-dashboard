/**
 * pi-flows · Anthropic Messages Bridge — server entry.
 *
 * Listens for `flows-anthropic-bridge:status` and
 * `flows-anthropic-bridge:agent-active` events emitted by the bridge entry
 * (running in pi processes) and broadcasts them to subscribed dashboard
 * clients. The client renders per-PID peer status in the settings panel.
 *
 * NB: in v1 the bridge → server hop relies on the dashboard's pi-extension
 * forwarding generic events. If your dashboard build does not forward these
 * custom event types yet, the settings panel will simply show "no sessions
 * reporting" — the bridge itself still functions correctly. A future
 * iteration can add a dedicated forwarder for the namespace.
 */
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { getPluginStatusStore } from "@blackbelt-technology/dashboard-plugin-runtime/server";

interface PeerProbe {
  ok: boolean;
  reason?: string;
  /** Which probe tier produced the hit. See change: add-shared-pi-package-resolver. */
  via?: "node" | "pi-packages";
  /** Absolute entry path when `via === "pi-packages"`. */
  entryPath?: string;
}

interface BridgeStatus {
  status: "probing" | "waiting_peers" | "active" | "degraded";
  peers: Record<string, PeerProbe>;
  pid: number;
  at: number;
}

export interface FlowsAnthropicBridgeConfig {
  forceCanonical?: boolean;
  disableCanonical?: boolean;
}

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  const perPid = new Map<number, BridgeStatus>();

  // REST endpoint — last-known status snapshot, for diagnostics.
  //
  // Defensive route registration: if `loadServerEntries` is ever called
  // after `fastify.listen()` (race conditions during restart, hot-install,
  // dynamic plugin enable, etc.) Fastify throws
  // `FST_ERR_INSTANCE_ALREADY_LISTENING` and our load fails. The route is
  // diagnostic-only — the plugin's primary value is the bridge event
  // listeners below, which don't depend on Fastify state. Guarding the
  // registration keeps the rest of the plugin functional.
  //
  // `fastify.server` is the underlying http.Server; `.listening` flips to
  // true after `listen()` resolves and is the canonical pre-flight check.
  const httpServer = (ctx.fastify as unknown as { server?: { listening?: boolean } }).server;
  if (httpServer?.listening) {
    ctx.logger?.warn?.(
      "flows-anthropic-bridge: Fastify already listening; skipping /api/flows-anthropic-bridge/status route registration. " +
      "Bridge event listeners still active.",
    );
  } else {
    try {
      ctx.fastify.get("/api/flows-anthropic-bridge/status", async () => {
        return {
          ok: true,
          pluginId: "flows-anthropic-bridge",
          sessions: Array.from(perPid.values()),
        };
      });
    } catch (err) {
      // Last-resort safety net for any Fastify state we didn't anticipate.
      // Surface a warning but keep the plugin's bridge listeners active.
      ctx.logger?.warn?.(
        `flows-anthropic-bridge: route registration failed (${err instanceof Error ? err.message : String(err)}); ` +
        "continuing with bridge event listeners only.",
      );
    }
  }

  // Wire generic event listeners IF the runtime exposes them. The event
  // surface for plugin-emitted custom events is host-version dependent; we
  // gate every call behind a typeof check to stay forward-compatible.
  const events = (ctx as unknown as { events?: { on?: (e: string, h: (p: unknown) => void) => void } }).events;
  if (events && typeof events.on === "function") {
    events.on("flows-anthropic-bridge:status", (raw: unknown) => {
      const s = raw as BridgeStatus;
      if (typeof s?.pid !== "number") return;
      perPid.set(s.pid, s);

      // Record into the shared plugin-status-store so /api/health.plugins[]
      // can surface `lastProbe`. See change: fix-pi-flows-end-to-end Group 2.
      try {
        getPluginStatusStore().recordBridgeProbe("flows-anthropic-bridge", {
          status: s.status,
          peers: s.peers ?? {},
          at: s.at,
        });
      } catch {
        /* never throw from probe recording */
      }

      const broadcast =
        (ctx as unknown as { broadcastToSubscribers?: (m: unknown) => void }).broadcastToSubscribers;
      try {
        broadcast?.({ type: "flows_anthropic_bridge_status", pid: s.pid, status: s });
      } catch {
        /* never throw from broadcast */
      }
    });

    events.on("flows-anthropic-bridge:agent-active", (raw: unknown) => {
      const broadcast =
        (ctx as unknown as { broadcastToSubscribers?: (m: unknown) => void }).broadcastToSubscribers;
      try {
        broadcast?.({ type: "flows_anthropic_bridge_agent_active", agent: raw });
      } catch {
        /* never throw from broadcast */
      }
    });
  }

  ctx.logger?.info?.("flows-anthropic-bridge server entry ready");
}
