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
 * The settings surface is the ONE deliberate exception: it is registered before
 * that check so an operator can inspect the policy with no token. It opens
 * nothing — the policy is validated in-memory and the command log and
 * provisioning store are file READS — and its platform half reports itself
 * unavailable rather than rendering an empty delegation roster, which would
 * understate who can act.
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
import { createFakeAdapterFromEnv } from "../adapters/fake.js";
import type { ChatGatewayConfig } from "../shared/types.js";
import { TEAM_CONFIG_MESSAGE, TEAM_SURFACE_MESSAGE } from "../shared/types.js";
import { isConfigured, resolveConfig } from "./config.js";
import { createChatGateway } from "./gateway.js";
import { createBindingStore, createSpawnCorrelator } from "./routing.js";
import { createHostSeam } from "./seam.js";
import { createCommandLog } from "./team/audit.js";
import { createTeamController } from "./team/controller.js";
import { createDisarmStore } from "./team/disarm-store.js";
import { createProvisioner } from "./team/provisioner.js";
import { createProvisioningStore } from "./team/provisioning-store.js";
import {
  buildTeamSurface,
  type DelegationAnswer,
  type DelegationPort,
} from "./team/surface.js";
import {
  FAIL_CLOSED_TEAM_CONFIG,
  type ValidatedTeamConfig,
  validateTeamControls,
  validateTeamControlsWrite,
} from "./team/team-config.js";

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

/**
 * The disarm latch (task 11.3). Its own file, NOT config: a chat disarm must not
 * write config, because the dashboard is the only config writer.
 */
export function disarmFilePath(): string {
  return path.join(chatGatewayStateDir(), "disarm.json");
}

/**
 * Whether a dashboard-written `disarmed` flag should be applied to the layer.
 *
 * Compares against the LIVE latch, never `teamConfig.disarmed`. A chat-initiated
 * disarm flips the runtime latch WITHOUT writing config (the dashboard stays the
 * only config writer), so the two deliberately disagree afterwards — and a
 * caller comparing against CONFIG would see "no change" on the dashboard's
 * re-arm, silently leaving the layer disarmed with no way back.
 *
 * The CALLER must also require that the write actually carried the field: an
 * omitted `disarmed` is defaulted to `false` by `validateTeamControlsWrite`, and
 * `false` against a live `true` reads as a re-arm. Absence is a no-op.
 */
export function shouldApplyDisarm(written: boolean, live: boolean): boolean {
  return written !== live;
}

/**
 * The mode-specific half of the settings surface lane.
 *
 * Everything else the panel needs (policy, workspaces, inert folders, channel
 * mappings, command log) is local and identical in both modes. Only the
 * PLATFORM half differs — a gateway with no token cannot enumerate a guild — so
 * it is the one thing injected.
 */
interface SurfaceLane {
  delegation: DelegationPort;
  /** Live disarm state: the controller owns it when one is running. */
  isDisarmed: () => boolean;
  problemFor: (workspaceId: string) => string | undefined;
  /**
   * Converge the platform onto the prospective config. An inert install owns no
   * channel and resolves `ok:true`, so the write lane has exactly ONE shape
   * instead of two divergent ones.
   */
  reconcile: () => Promise<{ ok: boolean; reason?: string }>;
  /** Push a chat-initiated disarm into a running controller, when there is one. */
  onDisarmChanged?: (disarmed: boolean) => void;
}

/**
 * Answer "unavailable" for every role in a batch.
 *
 * NOT an empty roster. An empty `assigners` list reads as "nobody can hand this
 * role out", which understates who holds it; a surface that cannot enumerate
 * must say so and name what is missing.
 */
function unavailableForAll(
  roleIds: readonly string[],
  missingPermission: string,
): Record<string, DelegationAnswer> {
  return Object.fromEntries(
    roleIds.map((id) => [id, { kind: "unavailable" as const, missingPermission }]),
  );
}

export default async function registerChatGateway(ctx: ServerPluginContext): Promise<void> {
  const rawConfig = ctx.getPluginConfig<ChatGatewayConfig>();
  const config = resolveConfig(rawConfig);

  // ── Team-controls policy (D6) ────────────────────────────────────────────
  //
  // Validated BEFORE the inert check on purpose. Config is validated TOTAL-ly;
  // a rejected config degrades to the fail-closed default (nobody may act,
  // nothing is provisioned) rather than to a live but unconfigured layer. Doing
  // it here is what lets an operator see the policy the layer will enforce —
  // including the fail-closed banner — with no token configured.
  const parsedTeam = validateTeamControls(rawConfig?.teamControls);
  let teamConfigError: string | undefined;
  if (!parsedTeam.ok) {
    teamConfigError = `${parsedTeam.reason} at ${parsedTeam.path}`;
    ctx.logger.error(
      `chat-gateway: team-controls config rejected (${teamConfigError}) — running fail-closed`,
    );
  }
  // MUTABLE: the dashboard can rewrite the policy while the layer runs. The
  // provisioner and controller read it through a getter, so a revoked principal
  // stops being authorized immediately instead of at the next restart.
  let teamConfig = parsedTeam.ok ? parsedTeam.value : FAIL_CLOSED_TEAM_CONFIG;

  // File READS, not sockets: an operator inspecting the panel must see the
  // recorded history and the channels the layer already owns even when the bot
  // is disconnected.
  const channels = createProvisioningStore({ filePath: channelsFilePath() });
  channels.load();
  const commandLog = createCommandLog({
    filePath: commandLogFilePath(),
    limit: teamConfig.auditRetention,
    // A lost audit write is a real degradation: the panel would show a trail that
    // no longer matches what happened. Surfaced in `/api/health.plugins[]` rather
    // than silently swallowed or thrown into the message path.
    onPersistFailure: reportLayerFailure,
  });
  // Restore the persisted trail. The log is written append-only FOR the purpose
  // of surviving a restart, so skipping this would leave the operator looking at
  // "No activity recorded." after every reboot while the file sat full on disk —
  // the one failure mode an audit log must not have. Sits above the inert early
  // return so the settings panel (which stays up without a token) still shows
  // the history it is perfectly capable of reading.
  commandLog.load();
  // Task 11.3: the disarm latch, read at boot by the controller below. Loaded
  // here with the other file reads so the restart story is one place to read.
  const disarmStore = createDisarmStore({ filePath: disarmFilePath() });

  // Harness fixture (`adapters/fake.ts`), env-guarded: a socket-less platform so
  // the L3 team-controls scenarios have something to render. With it the layer
  // counts as CONFIGURED despite having no token — which is the point, since the
  // docker harness carries no Discord credential.
  const fakeAdapter = createFakeAdapterFromEnv();

  // Inert by design: no token, no work. This is the ONLY early return that is
  // not an error.
  if (fakeAdapter === undefined && !isConfigured(config)) {
    ctx.logger.info(
      "chat-gateway: inert (no bot token configured) — no adapter, no connection",
    );
    // The settings surface stays UP: everything it reads is local, and an
    // operator must be able to inspect the policy before a token exists. Only
    // the platform half is missing, so the delegation disclosure says exactly
    // that instead of rendering an empty roster.
    registerSurfaceLane({
      delegation: {
        assignersForRoles: (roleIds) =>
          Promise.resolve(unavailableForAll(roleIds, "the gateway is not connected")),
      },
      isDisarmed: () => teamConfig.disarmed,
      problemFor: () => undefined,
      reconcile: async () => ({ ok: true }),
    });
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

  /** Report a layer failure on `/api/health.plugins[]`, preserving the rest. */
  function reportLayerFailure(reason: string): void {
    ctx.logger.error(`chat-gateway: team-controls — ${reason}`);
    const status = getPluginStatusStore();
    const previous = status.getStatus(PLUGIN_ID);
    // Merge: the loader owns displayName/claims/dependsOn, we only add the error.
    if (previous) status.setStatus({ ...previous, error: reason });
  }

  const seam = createHostSeam(ctx);
  // `discord.js` is imported LAZILY and on the real path only, so neither an
  // unconfigured install nor the harness fixture ever loads it.
  const adapter =
    fakeAdapter ??
    new (await import("../adapters/discord.js")).DiscordAdapter({
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
  // provisioning store loaded above (before the inert check), so authorization
  // can only ever see a binding the layer actually owns.
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
    // Task 11.3: the latch outlives the process, or a restart silently re-arms
    // the layer. `undefined` (never persisted) falls back to config, so a
    // dashboard-authored `disarmed: true` still works on a fresh install.
    initialDisarmed: disarmStore.load(),
    onDisarmChange: (disarmed) => disarmStore.save(disarmed),
  });

  const gateway = createChatGateway({
    platform: adapter.platform,
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

  /**
   * Register the settings surface (tasks 8.1-8.5) in whichever mode this
   * install is in — see `SurfaceLane`.
   *
   * A function DECLARATION on purpose: the inert branch above calls it before
   * this point in the source, and declarations hoist.
   */
  function registerSurfaceLane(lane: SurfaceLane): void {
    // Read-only PROJECTION of authoritative state. The panel renders what this
    // returns and decides nothing itself, so there is exactly one place that
    // knows what the layer will do.
    const buildSurface = () =>
      buildTeamSurface({
        config: teamConfig,
        workspaces: ctx.listWorkspaces(),
        allowedRoots: config.allowedRoots,
        log: commandLog,
        isDisarmed: lane.isDisarmed(),
        delegation: lane.delegation,
        channelFor: (workspaceId) => channels.forWorkspace(workspaceId)?.channelId,
        problemFor: lane.problemFor,
        ...(teamConfigError !== undefined ? { configError: teamConfigError } : {}),
      });

    ctx.registerBrowserHandler(TEAM_SURFACE_MESSAGE, () => {
      void buildSurface()
        .then((surface) => {
          ctx.broadcastToSubscribers({ type: TEAM_SURFACE_MESSAGE, surface });
        })
        .catch((err: unknown) => {
          // Without this the panel waits forever on a failed build.
          ctx.logger.warn(`chat-gateway: team surface build failed — ${String(err)}`);
        });
    });


    /**
     * Report a failed write. `withSurface` is set when the panel also needs the
     * refreshed state; it is omitted for a refused payload, which changed
     * nothing and so has nothing new to show.
     */
    async function failWrite(reason: string, withSurface: boolean): Promise<void> {
      ctx.broadcastToSubscribers({
        type: TEAM_CONFIG_MESSAGE,
        ok: false,
        reason,
        ...(withSurface ? { surface: await buildSurface() } : {}),
      });
    }

    /**
     * Converge the platform onto `candidate`, then persist it.
     *
     * Returns `undefined` on success, or the refusal reason. Extracted so the
     * write handler reads as a sequence of decisions instead of a nest of them.
     */
    async function applyWrite(candidate: ValidatedTeamConfig): Promise<string | undefined> {
      const previous = teamConfig;
      // D7 ORDERING: converge the PLATFORM before recording the config as
      // applied. Reconcile reads `teamConfig` through a getter, so assigning
      // here is how it sees the prospective config. Persisting first would
      // leave a window in which a revoked principal is denied in chat while
      // still holding channel VIEW access — precisely what D7 forbids.
      teamConfig = candidate;
      const swept = await lane.reconcile();
      if (!swept.ok) {
        // A partially-applied reconcile may have revoked access already.
        // Converge back, best-effort: if the platform is failing this fails too,
        // and the layer then holds the WIDER config (authorized in chat, access
        // revoked on the platform) — the safe direction to fail in.
        teamConfig = previous;
        await lane.reconcile();
        return swept.reason ?? "config_reconcile_failed";
      }
      try {
        await ctx.updatePluginConfig({ teamControls: candidate });
        return undefined;
      } catch (err) {
        // The platform already matches the new config but it could not be
        // persisted; revert both so memory, disk and platform agree.
        teamConfig = previous;
        await lane.reconcile();
        ctx.logger.error(`chat-gateway: team-controls write failed to persist: ${String(err)}`);
        return "config_write_failed";
      }
    }

    // The write lane. A failed reconcile is reported as a FAILED WRITE, not a
    // success with a warning: the operator asked for a state the platform does
    // not have, and must be told so.
    ctx.registerBrowserHandler(TEAM_CONFIG_MESSAGE, (msg) => {
      void (async () => {
        // NOT `validateTeamControls`: startup reads `undefined` as "nothing
        // configured yet" and defaults, but a LIVE write that omits the payload
        // must be refused. Applying it as defaults would silently wipe every
        // binding and deactivate every provisioned channel.
        const parsed = validateTeamControlsWrite(
          (msg as { teamControls?: unknown } | null)?.teamControls,
        );
        // Nothing persisted and no platform call made — a rejected config must
        // not half-apply.
        if (!parsed.ok) {
          await failWrite(`${parsed.reason} at ${parsed.path}`, false);
          return;
        }

        // Only a change from what the layer is CURRENTLY doing applies the flag,
        // and only when the write actually CARRIES `disarmed`. An omitted field
        // defaults to `false` downstream, which against a chat-disarmed layer's
        // live `true` would read as "re-arm" and silently undo it — so absence
        // must be a no-op, not a `false`.
        const wroteDisarm = (msg as { teamControls?: { disarmed?: unknown } } | null)?.teamControls
          ?.disarmed;
        const disarmChanged =
          typeof wroteDisarm === "boolean" && shouldApplyDisarm(wroteDisarm, team.isDisarmed());
        const refused = await applyWrite(parsed.value);
        if (refused !== undefined) {
          await failWrite(refused, true);
          return;
        }

        teamConfigError = undefined;
        if (disarmChanged) lane.onDisarmChanged?.(parsed.value.disarmed);
        ctx.broadcastToSubscribers({
          type: TEAM_CONFIG_MESSAGE,
          ok: true,
          surface: await buildSurface(),
        });
      })();
    });
  }

  // Live lane: a connected gateway owns channels, so the platform half is the
  // adapter-backed delegation port and the provisioner's reconcile.
  registerSurfaceLane({
    delegation: {
      assignersForRoles(roleIds) {
        if (!teamConfig.guildId) {
          // No guild ⇒ nothing to enumerate. Say so once for the whole batch
          // rather than falling through to an empty list, which would read as
          // "nobody can assign this".
          return Promise.resolve(unavailableForAll(roleIds, "a configured teamControls.guildId"));
        }
        // The platform read is a network call and can fail (missing Server
        // Members intent, insufficient permissions). A rejection would leave the
        // panel waiting forever, so it is reported as unavailable WITH the
        // reason.
        return adapter.assignersForRoles(teamConfig.guildId, roleIds).catch((err: unknown) => {
          ctx.logger.warn(`chat-gateway: team delegation query failed — ${String(err)}`);
          return unavailableForAll(roleIds, `the platform read failed (${String(err)})`);
        });
      },
    },
    isDisarmed: () => team.isDisarmed(),
    problemFor: () => provisioner.lastFailure() ?? undefined,
    reconcile: () => provisioner.reconcile(),
    onDisarmChanged: (disarmed) => team.syncDisarmFromConfig(disarmed),
  });

  ctx.logger.info(
    `chat-gateway: started (${store.all().length} bound channel(s), allowedRoots=${config.allowedRoots.length}); L1 pairing code ${gateway.status().pairingCode} — DM it to the bot to pair a new user`,
  );
}
