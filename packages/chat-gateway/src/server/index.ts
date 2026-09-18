/**
 * chat-gateway — dashboard plugin server entry.
 *
 * Adds an inbound chat control plane in front of the dashboard. The gateway is
 * a HEADLESS BROWSER-PROTOCOL CLIENT: it consumes the same session frames the
 * React client does (`ctx.subscribeSession`) and drives sessions over the
 * existing raw-control lane (`ctx.sendExtensionMessage` →
 * `send_prompt`/`prompt_response`) plus `ctx.abortSession`/`ctx.spawnSession`.
 * No bridge message type, no server protocol change.
 *
 * INERTNESS (task 1.3): with no bot token configured nothing is constructed —
 * no adapter, no socket, no timers. The heavy `discord.js` import is therefore
 * deferred past the configured check, so an unconfigured install pays nothing.
 *
 * Trust: `spawnSession`/`abortSession`/`sendExtensionMessage`/`subscribeSession`
 * are host-gated to plugins with `priority <= 100`, which this package's
 * manifest satisfies. On a host without the in-process frame seam the gateway
 * refuses to start rather than half-working (it would receive no session
 * output yet appear healthy).
 *
 * See change: add-chat-gateway.
 */
import { homedir } from "node:os";
import path from "node:path";
import {
  getPluginStatusStore,
  type ServerPluginContext,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { ChatGatewayConfig } from "../shared/types.js";
import { TEAM_CONFIG_MESSAGE, TEAM_SURFACE_MESSAGE } from "../shared/types.js";
import { isConfigured, resolveConfig } from "./config.js";
import { createChatGateway } from "./gateway.js";
import { createBindingStore, createSpawnCorrelator } from "./routing.js";
import { createHostSeam } from "./seam.js";
import { createCommandLog } from "./team/audit.js";
import { createTeamController } from "./team/controller.js";
import { createProvisioner } from "./team/provisioner.js";
import { createProvisioningStore } from "./team/provisioning-store.js";
import { buildTeamSurface, type DelegationPort } from "./team/surface.js";
import { FAIL_CLOSED_TEAM_CONFIG, validateTeamControls, validateTeamControlsWrite } from "./team/team-config.js";

/** The plugin id used by `/api/health.plugins[]`. */
const PLUGIN_ID = "chat-gateway";

/** Dashboard-owned state directory for the gateway's sticky bindings. */
export function chatGatewayStateDir(): string {
  return path.join(homedir(), ".pi", "dashboard", "chat-gateway");
}

export function bindingsFilePath(): string {
  return path.join(chatGatewayStateDir(), "bindings.json");
}

/**
 * Workspace↔channel records. Deliberately NOT `bindings.json`: that file routes
 * a channel to a session cwd, this one records the channel the layer owns.
 */
export function channelsFilePath(): string {
  return path.join(chatGatewayStateDir(), "channels.json");
}

/** Append-only command log (D6). */
export function commandLogFilePath(): string {
  return path.join(chatGatewayStateDir(), "command-log.json");
}

export default async function registerChatGateway(ctx: ServerPluginContext): Promise<void> {
  const rawConfig = ctx.getPluginConfig<ChatGatewayConfig>();
  const config = resolveConfig(rawConfig);

  // Inert by design: no token, no work. This is the ONLY early return that is
  // not an error.
  if (!isConfigured(config)) {
    ctx.logger.info(
      "chat-gateway: inert (no bot token configured) — no adapter, no connection",
    );
    return;
  }

  if (typeof ctx.subscribeSession !== "function") {
    // Fail loudly rather than appear healthy: without the frame seam the
    // gateway could send prompts but would never see a reply.
    ctx.logger.error(
      "chat-gateway: host does not expose subscribeSession — gateway disabled (requires dashboard >= the in-process frame seam)",
    );
    return;
  }

  const store = createBindingStore({ filePath: bindingsFilePath() });
  store.load();

  // ── Team controls (D6) + channel provisioning (D7) ──────────────────────
  //
  // Config is validated TOTAL-ly; a rejected config degrades to the fail-closed
  // default (nobody may act, nothing is provisioned) rather than to a live but
  // unconfigured layer.
  const parsedTeam = validateTeamControls(rawConfig?.teamControls);
  let teamConfigError: string | undefined;
  if (!parsedTeam.ok) {
    teamConfigError = `${parsedTeam.reason} at ${parsedTeam.path}`;
    ctx.logger.error(
      `chat-gateway: team-controls config rejected (${teamConfigError}) — running fail-closed`,
    );
  }
  // MUTABLE: the dashboard can rewrite the policy while the layer runs. The
  // provisioner and controller read it through a getter, so a revoked
  // principal stops being authorized immediately instead of at the next
  // restart.
  let teamConfig = parsedTeam.ok ? parsedTeam.value : FAIL_CLOSED_TEAM_CONFIG;

  /** Report a layer failure on `/api/health.plugins[]`, preserving the rest. */
  function reportLayerFailure(reason: string): void {
    ctx.logger.error(`chat-gateway: team-controls — ${reason}`);
    const status = getPluginStatusStore();
    const previous = status.getStatus(PLUGIN_ID);
    // Merge: the loader owns displayName/claims/dependsOn, we only add the error.
    if (previous) status.setStatus({ ...previous, error: reason });
  }

  const seam = createHostSeam(ctx);
  // Deferred so an unconfigured install never loads discord.js.
  const { DiscordAdapter } = await import("../adapters/discord.js");
  const adapter = new DiscordAdapter({
    enabled: true,
    platform: "discord",
    botToken: config.token,
    // L4: the adapter drops every guild channel that is not opted in (DMs are
    // unaffected). Without this, the adapter would forward every hidden-channel
    // message to the edge.
    allowedChannels: config.groupChannels,
  });

  // initialize() creates the client and logs in; start() only wires handlers.
  // Skipping it makes start() throw `adapter not initialized` and the loader
  // silently swallows the plugin — the whole feature would be dead.
  try {
    await adapter.initialize();
  } catch (err) {
    ctx.logger.error(
      `chat-gateway: adapter failed to initialize — gateway not started (${String(err)})`,
    );
    return;
  }

  // Provisioning + the team controller. Both read the SAME workspace list the
  // dashboard owns, and the controller's channel→workspace map comes from the
  // provisioning store, so authorization can only ever see a binding the layer
  // actually owns.
  const channels = createProvisioningStore({ filePath: channelsFilePath() });
  channels.load();

  const commandLog = createCommandLog({
    filePath: commandLogFilePath(),
    limit: teamConfig.auditRetention,
  });

  const provisioner = createProvisioner({
    adapter,
    store: channels,
    config: () => teamConfig,
    listWorkspaces: () => ctx.listWorkspaces(),
    onFailure: reportLayerFailure,
  });

  const team = createTeamController({
    config: () => teamConfig,
    log: commandLog,
    listWorkspaces: () => ctx.listWorkspaces(),
    channelBindings: provisioner.channelBindings,
    onTrustFailure: reportLayerFailure,
  });

  const gateway = createChatGateway({
    platform: "discord",
    seam,
    adapter,
    config,
    store,
    correlator: createSpawnCorrelator(),
    team,
  });

  ctx.onShutdown(() => {
    void gateway.stop();
  });

  await gateway.start();

  // Activation sweep (D7): a mapping changed while the dashboard was down takes
  // effect here. Awaited, so the layer is not reported started until the
  // platform matches the configuration.
  const sweep = await provisioner.reconcile();
  if (!sweep.ok) {
    ctx.logger.error(`chat-gateway: provisioning did not converge — ${sweep.reason}`);
  }

  // A workspace mutation is a HINT to re-read, not a description of the change:
  // it may coalesce and may fire for something this layer does not care about.
  // `reconcile` is idempotent and issues a platform call only where the desired
  // state differs, so replaying it is free.
  const unsubscribeWorkspaces = ctx.onWorkspacesChanged(() => {
    void provisioner.reconcile();
  });
  ctx.onShutdown(() => {
    unsubscribeWorkspaces();
  });

  // Read-only bindings surface for the settings panel (task 10.1). Registered
  // only once configured + started, so an inert install exposes nothing (task
  // 1.3). networkGuard matches every core /api route; the live L1 pairing code
  // is deliberately NOT returned (an unauthenticated read would be a pairing
  // bypass) — the operator reads it from server.log at startup.
  ctx.fastify.get("/api/chat-gateway/bindings", { preHandler: ctx.networkGuard }, async () => {
    const s = gateway.status();
    return {
      bindings: store.all(),
      status: { running: s.running, boundChannels: s.boundChannels, pendingSpawns: s.pendingSpawns },
    };
  });

  // ── Configuration surface (tasks 8.1-8.5) ───────────────────────────────
  //
  // Read-only PROJECTION of authoritative state. The panel renders what this
  // returns and decides nothing itself, so there is exactly one place that
  // knows what the layer will do.
  const delegation: DelegationPort = {
    assignersForRoles(roleIds) {
      if (!teamConfig.guildId) {
        // No guild ⇒ nothing to enumerate. Say so once for the whole batch
        // rather than falling through to an empty list, which would read as
        // "nobody can assign this".
        return Promise.resolve(
          Object.fromEntries(
            roleIds.map((id) => [
              id,
              { kind: "unavailable" as const, missingPermission: "a configured teamControls.guildId" },
            ]),
          ),
        );
      }
      return adapter.assignersForRoles(teamConfig.guildId, roleIds);
    },
  };

  const buildSurface = () =>
    buildTeamSurface({
      config: teamConfig,
      workspaces: ctx.listWorkspaces(),
      allowedRoots: config.allowedRoots,
      log: commandLog,
      isDisarmed: team.isDisarmed(),
      delegation,
      channelFor: (workspaceId) => channels.forWorkspace(workspaceId)?.channelId,
      problemFor: () => provisioner.lastFailure() ?? undefined,
      ...(teamConfigError !== undefined ? { configError: teamConfigError } : {}),
    });

  async function broadcastSurface(): Promise<void> {
    ctx.broadcastToSubscribers({ type: TEAM_SURFACE_MESSAGE, surface: await buildSurface() });
  }

  ctx.registerBrowserHandler(TEAM_SURFACE_MESSAGE, () => {
    void broadcastSurface();
  });

  // The write lane. A failed reconcile is reported as a FAILED WRITE, not a
  // success with a warning: the operator asked for a state the platform does
  // not have, and must be told so.
  ctx.registerBrowserHandler(TEAM_CONFIG_MESSAGE, (msg) => {
    void (async () => {
      const raw = (msg as { teamControls?: unknown } | null)?.teamControls;
      // NOT `validateTeamControls`: startup reads `undefined` as "nothing
      // configured yet" and defaults, but a LIVE write that omits the payload
      // must be refused. Applying it as defaults would silently wipe every
      // binding and deactivate every provisioned channel.
      const parsed = validateTeamControlsWrite(raw);
      if (!parsed.ok) {
        // Nothing persisted and no platform call made — a rejected config must
        // not half-apply.
        ctx.broadcastToSubscribers({
          type: TEAM_CONFIG_MESSAGE,
          ok: false,
          reason: `${parsed.reason} at ${parsed.path}`,
        });
        return;
      }

      // Only a CHANGE in the flag applies it. An unrelated edit must not
      // silently undo a chat-initiated disarm — the dashboard re-arms by
      // setting this flag, so it is applied deliberately, not as a side effect.
      const disarmChanged = parsed.value.disarmed !== teamConfig.disarmed;
      const previous = teamConfig;

      // D7 ORDERING: converge the PLATFORM before recording the config as
      // applied. Reconcile reads `teamConfig` through a getter, so assigning
      // here is how it sees the prospective config. Persisting first would
      // leave a window in which a revoked principal is denied in chat while
      // still holding channel VIEW access — precisely what D7 forbids.
      teamConfig = parsed.value;
      const swept = await provisioner.reconcile();
      if (!swept.ok) {
        teamConfig = previous;
        // A partially-applied reconcile may have revoked access already.
        // Converge back, best-effort: if the platform is failing this fails
        // too, and the layer then holds the WIDER config (authorized in chat,
        // access revoked on the platform) — the safe direction to fail in.
        await provisioner.reconcile();
        ctx.broadcastToSubscribers({
          type: TEAM_CONFIG_MESSAGE,
          ok: false,
          reason: swept.reason,
          surface: await buildSurface(),
        });
        return;
      }

      try {
        await ctx.updatePluginConfig({ teamControls: parsed.value });
      } catch (err) {
        // The platform already matches the new config but it could not be
        // persisted; revert both so memory, disk and platform agree.
        teamConfig = previous;
        await provisioner.reconcile();
        ctx.logger.error(`chat-gateway: team-controls write failed to persist: ${String(err)}`);
        ctx.broadcastToSubscribers({
          type: TEAM_CONFIG_MESSAGE,
          ok: false,
          reason: "config_write_failed",
          surface: await buildSurface(),
        });
        return;
      }

      teamConfigError = undefined;
      if (disarmChanged) team.syncDisarmFromConfig(parsed.value.disarmed);
      ctx.broadcastToSubscribers({
        type: TEAM_CONFIG_MESSAGE,
        ok: true,
        surface: await buildSurface(),
      });
    })();
  });

  ctx.logger.info(
    `chat-gateway: started (${store.all().length} bound channel(s), allowedRoots=${config.allowedRoots.length}); L1 pairing code ${gateway.status().pairingCode} — DM it to the bot to pair a new user`,
  );
}
