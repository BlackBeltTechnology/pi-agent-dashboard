/**
 * `MemberDriver` (task 2.9, design D17) and the session driver: the ONLY module
 * that calls the host's `spawnSession` / `emitEventToSession` / `abortSession` /
 * `shutdownSession` seams. A later teammate mode adds another driver behind the
 * same interface; the rest of the plugin never touches a host seam directly.
 *
 * Delivery contract (driver-agnostic): `deliver` returns whether the mail was
 * handed over; delivery is at-least-once and the RECEIVING side de-duplicates by
 * mail id (the session bridge keeps the last 200 ids), so a repeated id is
 * re-acked and never handed to the member twice. `abort` returns `{ok, reason?}`.
 * See change: add-agent-teams-core.
 */
import type {
  PluginSpawnOptions,
  PluginSpawnResult,
  ServerPluginContext,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { ownerFromKey } from "../shared/owner-key.js";
import {
  AGENT_TEAMS_EVENT_MAIL,
  AGENT_TEAMS_EVENT_TEAM_CLOSED,
  AGENT_TEAMS_PLUGIN_ID,
} from "../shared/plugin-id.js";
import { type MailEventPayload, toWireMail } from "../shared/protocol.js";
import type { Mail, Team } from "../shared/types.js";

/** Everything a driver needs to start one teammate; produced by the spawn resolver (§5). */
export interface ResolvedSpawnSpec {
  cwd: string;
  model?: string;
  /** Tool allowlist; absent = unrestricted. The server appends the team tool names before spawn. */
  tools?: string[];
  /** Resolved SKILL paths; absent = unrestricted, `[]` = none. */
  skills?: string[];
  noMcp: boolean;
  noContextFiles: boolean;
  /** Ordered absolute prompt files (protocol first). */
  promptFiles: string[];
  /** `extensionConfig` env projection (`PI_EXT_AGENT_TEAMS_*`). */
  env: Record<string, string | string[]>;
}

interface SpawnRequest {
  teamId: string;
  teamName: string;
  member: string;
  role?: string;
  /** Pre-minted and persisted before the host call so a crash mid-spawn is reconcilable. */
  spawnToken: string;
  principalOwner?: string;
  spec: ResolvedSpawnSpec;
  resume?: { sessionFile: string };
}

type SpawnOutcome = { ok: true; spawnToken: string } | { ok: false; message: string };

/** Which member a driver call is about. `sessionId` is unset until the host resolves the session. */
export interface DriverMemberRef {
  teamId: string;
  member: string;
  sessionId?: string;
}

interface AbortOutcome {
  ok: boolean;
  reason?: string;
}

export interface MemberDriver {
  /** Mode this driver serves (`session`). */
  readonly mode: string;
  spawn(req: SpawnRequest): Promise<SpawnOutcome>;
  /** Hand mails to the member; false when it could not be handed over (stays queued). */
  deliver(ref: DriverMemberRef, mails: readonly Mail[], opts: { wake: boolean }): boolean;
  abort(ref: DriverMemberRef): AbortOutcome;
  shutdown(ref: DriverMemberRef): Promise<boolean>;
  isConnected(ref: DriverMemberRef): boolean;
  /** Lead-role spawn for a server-started team (`pluginRef {"agent-teams": {teamId, role:"lead"}}`). */
  spawnLead?(team: Team, opts: { model?: string; principalOwner?: string; cwd?: string }): Promise<SpawnOutcome>;
  /** Tell a lead session its team closed so its bridge drops the lead-only tools. */
  notifyTeamClosed?(sessionId: string, payload: { teamId: string; closeReason?: string }): boolean;
}

/** The host members the session driver drives (a `ServerPluginContext` subset). */
export type DriverHost = Pick<
  ServerPluginContext,
  "emitEventToSession" | "spawnSession" | "abortSession" | "shutdownSession"
> & {
  isConnected?: (sessionId: string) => boolean;
  abortSpawnedRun?: (opts: { spawnToken: string }) => unknown;
};

export const SESSION_MODE = "session";

function pluginRefFor(req: { teamId: string; member?: string; role: string; principalOwner?: string }): Record<string, unknown> {
  const { principalOwner, ...ref } = req;
  // `principalOwner` arrives as the stored owner key; the host wants the `{iss, sub}` object (a non-key string is dropped).
  const owner = principalOwner ? ownerFromKey(principalOwner) : undefined;
  return {
    [AGENT_TEAMS_PLUGIN_ID]: ref,
    ...(owner ? { principalOwner: owner } : {}),
  };
}

function outcomeOf(res: PluginSpawnResult, token: string): SpawnOutcome {
  return res.success ? { ok: true, spawnToken: res.spawnToken ?? token } : { ok: false, message: res.message ?? "spawn failed" };
}

export function createSessionDriver(host: DriverHost, newToken: () => string = () => `at-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`): MemberDriver {
  return {
    mode: SESSION_MODE,

    async spawn(req) {
      const { spec } = req;
      const opts: PluginSpawnOptions = {
        cwd: spec.cwd,
        ...(spec.model ? { model: spec.model } : {}),
        name: `${req.teamName}/${req.member}`,
        pluginRef: pluginRefFor({
          teamId: req.teamId,
          member: req.member,
          role: req.role ?? "member",
          ...(req.principalOwner ? { principalOwner: req.principalOwner } : {}),
        }),
        // A plain restart re-attaches live sessions; a crash/Reopen must NOT resume
        // without the spawn-time scope + env, so no recovery.
        lifecycle: { recover: false, finalizeOnSocketClose: false },
        spawnToken: req.spawnToken,
        scope: {
          ...(spec.tools ? { tools: spec.tools } : {}),
          ...(spec.skills ? { skills: spec.skills, noSkills: true } : {}),
          extensionConfig: { [AGENT_TEAMS_PLUGIN_ID]: spec.env },
          appendSystemPrompt: spec.promptFiles,
          noContextFiles: spec.noContextFiles,
          noMcp: spec.noMcp,
        },
        ...(req.resume ? { resume: req.resume } : {}),
        // NO initialPrompt: the host queues it per cwd, not per identity (design D10).
      };
      try {
        return outcomeOf(await host.spawnSession(opts), req.spawnToken);
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    },

    deliver(ref, mails, { wake }) {
      if (!ref.sessionId || mails.length === 0) return false;
      const payload: MailEventPayload = { mails: mails.map((m) => ({ ...toWireMail(m), wake })) };
      try {
        return host.emitEventToSession(ref.sessionId, AGENT_TEAMS_EVENT_MAIL, payload as unknown as Record<string, unknown>);
      } catch {
        return false;
      }
    },

    abort(ref) {
      if (!ref.sessionId) return { ok: false, reason: "no_session" };
      try {
        return host.abortSession(ref.sessionId) ? { ok: true } : { ok: false, reason: "not_connected" };
      } catch (err) {
        return { ok: false, reason: (err as Error).message };
      }
    },

    async shutdown(ref) {
      if (!ref.sessionId) return false;
      try {
        return await host.shutdownSession(ref.sessionId);
      } catch {
        return false;
      }
    },

    isConnected(ref) {
      if (!ref.sessionId) return false;
      return host.isConnected ? host.isConnected(ref.sessionId) : false;
    },

    async spawnLead(team, opts) {
      const token = newToken();
      const options: PluginSpawnOptions = {
        cwd: opts.cwd ?? team.leadCwd,
        ...(opts.model ? { model: opts.model } : {}),
        name: `${team.name}/lead`,
        pluginRef: pluginRefFor({ teamId: team.id, role: "lead", ...(opts.principalOwner ? { principalOwner: opts.principalOwner } : {}) }),
        // The lead is an ordinary session: no guard, no tool allowlist.
        lifecycle: { recover: false, finalizeOnSocketClose: false },
        spawnToken: token,
      };
      try {
        return outcomeOf(await host.spawnSession(options), token);
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    },

    notifyTeamClosed(sessionId, payload) {
      try {
        return host.emitEventToSession(sessionId, AGENT_TEAMS_EVENT_TEAM_CLOSED, payload);
      } catch {
        return false;
      }
    },
  };
}
