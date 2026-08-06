/**
 * pi-flows · Anthropic Messages Bridge — pi extension bridge entry.
 *
 * Auto-registered at ~/.pi/agent/settings.json#dashboardPluginBridges
 * (key: dashboard-flows-anthropic-bridge) when the dashboard plugin is
 * enabled; auto-deregistered on disable.
 *
 * Behaviour:
 *   1. On activate, probe for two peers:
 *        - @pi/anthropic-messages (the rename/transform package)
 *        - pi-flows (the multi-agent orchestrator)
 *   2. If BOTH present → load @pi/anthropic-messages, run its default export
 *      against the main pi instance, AND emit `flow:register-agent-extension`
 *      so every spawned flow agent gets the same hooks.
 *   3. If either peer missing → stay in `waiting_peers`, re-probe on every
 *      `session_start` to catch late installs after `/reload`.
 *   4. Hooks are wired exactly once per pi process; subsequent re-probes
 *      only update the broadcasted status.
 *
 * The bridge does NOT reimplement any of @pi/anthropic-messages's transforms
 * — it is pure plumbing. If the package ships a fix, this plugin picks it up
 * via npm without code changes here.
 */
import { createRequire } from "node:module";
import { resolvePiPackageEntry } from "@blackbelt-technology/pi-dashboard-shared/pi-package-resolver.js";
import { probeAll, type PeerProbe, type ProbeResult } from "../peer-probe.js";

type Status = "probing" | "waiting_peers" | "active" | "degraded";

interface BridgeStatusEvent {
  status: Status;
  peers: {
    "@pi/anthropic-messages": PeerProbe;
    "pi-flows": PeerProbe;
  };
  pid: number;
  at: number;
}

// Anchor module resolution at process.cwd() — matches the user's mental model
// (peers must be installed in the project pi was launched from).
const requireFromCwd = createRequire(`${process.cwd()}/_`);

export default async function activate(ctx: any): Promise<void> {
  const pi = ctx?.pi ?? ctx;
  const events = ctx?.events ?? pi?.events;

  let status: Status = "probing";
  let wired = false;
  let lastBroadcast = "";

  function broadcast(probe: ProbeResult): void {
    const payload: BridgeStatusEvent = {
      status,
      peers: {
        "@pi/anthropic-messages": probe.am,
        "pi-flows": probe.flows,
      },
      pid: process.pid,
      at: Date.now(),
    };
    const json = JSON.stringify(payload);
    if (json === lastBroadcast) return;
    lastBroadcast = json;
    try {
      events?.emit?.("flows-anthropic-bridge:status", payload);
    } catch {
      /* never throw from broadcast */
    }
  }

  function runProbe(): ProbeResult {
    return probeAll({
      // Tier 1: standard Node resolver anchored at cwd.
      resolve: (spec) => requireFromCwd.resolve(spec),
      // Tier 2: pi-packages fallback. Reads ~/.pi/agent/settings.json +
      // <cwd>/.pi/settings.json and returns an absolute entry path for
      // peers installed via pi (npm/git/local) but not in any
      // node_modules ancestor of cwd. See change:
      // add-shared-pi-package-resolver.
      resolvePiPackage: (spec) => {
        const ep = resolvePiPackageEntry(spec, { cwd: process.cwd() });
        return ep ? { entryPath: ep } : null;
      },
      flowsListenerCount: () =>
        typeof pi?.events?.listenerCount === "function"
          ? pi.events.listenerCount("flow:register-agent-extension")
          : 0,
    });
  }

  // Stable factory reference. Built once on first successful wire, then
  // RE-EMITTED on every session boundary so pi-flows re-acquires it after it
  // re-seeds its extraAgentExtensions array (on /reload or a new flow
  // context) and so an activation-order race (plugin emits before pi-flows
  // subscribes) self-heals. Stable identity lets pi-flows dedupe.
  let agentFactory: ((agentPi: any) => Promise<void>) | null = null;

  function emitAgentFactory(): void {
    if (!agentFactory) return;
    try {
      pi?.events?.emit?.("flow:register-agent-extension", { factory: agentFactory });
    } catch {
      /* never throw from re-announce */
    }
  }

  async function tryWire(): Promise<void> {
    if (wired) {
      // Defensive: if a peer disappeared post-wire, drop to "degraded".
      const probe = runProbe();
      if (!probe.bothPresent && status !== "degraded") {
        status = "degraded";
        broadcast(probe);
      } else {
        // Re-announce the factory: pi-flows may have re-seeded its array
        // since the last emit. Dedup is pi-flows' responsibility.
        emitAgentFactory();
      }
      return;
    }
    const probe = runProbe();
    if (!probe.bothPresent) {
      status = "waiting_peers";
      broadcast(probe);
      return;
    }
    let mod: any;
    try {
      // Two-tier import (matches probe). When tier-1 (Node resolver) hit,
      // use the bare specifier so Node ESM produces a single module
      // instance shared with anyone else doing the same import. When
      // tier-2 (pi-packages) hit, use the absolute entry path returned by
      // the shared resolver — pi installed the peer to a path Node's
      // node_modules walk never reaches.
      if (probe.am.via === "pi-packages" && probe.am.entryPath) {
        mod = await import(probe.am.entryPath);
      } else {
        // Peer dependency, not a direct dep — TS can't see types here.
        // Resolved at runtime via probeAll() before we reach this line.
        // Try the current scoped name first, fall back to the legacy name.
        try {
          // @ts-expect-error optional peer; resolved dynamically
          mod = await import("@blackbelt-technology/pi-anthropic-messages");
        } catch {
          // @ts-expect-error legacy pre-rescope name; resolved dynamically
          // biome-ignore lint/correctness/noUndeclaredDependencies: @pi/anthropic-messages returns E404 on the registry. It is a legacy pre-rescope name reached only through this dynamic-import fallback; declaring it would write an unresolvable dependency into a published manifest. Mirrored by the publish-correctness checker's reasoned allowlist.
          mod = await import("@pi/anthropic-messages");
        }
      }
    } catch (e) {
      // Resolve said yes, import said no — surface the import error and stay
      // waiting so a later /reload (with the package present) can complete.
      status = "waiting_peers";
      broadcast({
        ...probe,
        am: { ok: false, reason: `import failed: ${(e as Error).message}` },
      });
      return;
    }
    const piAnthropicMessages = mod.default;
    const isClaudeAnthropicMessages = mod.isClaudeAnthropicMessages;

    // 1. Main session.
    await piAnthropicMessages(pi);

    // 2. Every spawned flow agent. Build the factory ONCE (stable ref) and
    //    emit it; re-emitted on each session_start via emitAgentFactory().
    agentFactory = async (agentPi: any) => {
      await piAnthropicMessages(agentPi);
      try {
        agentPi?.on?.("session_start", (_e: unknown, agentCtx: any) => {
          try {
            events?.emit?.("flows-anthropic-bridge:agent-active", {
              pid: process.pid,
              modelId: agentCtx?.model?.id,
              gateOpen: !!isClaudeAnthropicMessages?.(agentCtx),
            });
          } catch {
            /* never throw */
          }
        });
      } catch {
        /* agentPi.on not available — ignore */
      }
    };
    emitAgentFactory();

    wired = true;
    status = "active";
    broadcast(probe);
  }

  // Initial probe at activation time.
  await tryWire();

  // Re-probe on every session boundary. Cheap; covers late installs after
  // `/reload` and config changes that affect peer resolvability.
  try {
    pi?.on?.("session_start", () => {
      void tryWire();
    });
  } catch {
    /* pi.on not available — stop here, initial probe was the only chance */
  }
}
