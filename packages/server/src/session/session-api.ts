/**
 * REST API wrappers for session control operations.
 * These expose WebSocket-only operations as HTTP endpoints
 * for use by skills, scripts, and external tooling.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import {
  FORK_DEGRADED_TO_NEW_CODE,
  FORK_DEGRADED_TO_NEW_MESSAGE,
  isSessionProcessGone,
} from "../browser-handlers/session-action-handler.js";
import { forwardExtensionUiResponse } from "../browser-handlers/directory-handler.js";
import {
  isLifecycleAction,
  LIFECYCLE_ACTIONS,
  type LifecycleAction,
} from "../browser-handlers/session-lifecycle.js";
import { sendTierRefusal, tierRefusalFor } from "../auth/route-tier-gate.js";
import { attachRenameTarget, detachShouldClearName } from "../openspec/proposal-attach-naming.js";
import type { BrowserGateway } from "../pairing/browser-gateway.js";
import { requestArchive } from "../browser-handlers/session-meta-handler.js";
import type { PendingArchiveIntentRegistry } from "../pending/pending-archive-intent-registry.js";
import type { PendingForkRegistry } from "../pending/pending-fork-registry.js";
import type { PendingResumeIntentRegistry } from "../pending/pending-resume-intent-registry.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { keeperOptsFromSpawnResult } from "../spawn-process/headless-pid-registry.js";
import { isAcp, UNSUPPORTED_FOR_ACP, unsupportedMessage } from "../browser-handlers/acp-guard.js";
import { preflightAcpSpawn, spawnAcpSession, validateAcpAgent } from "../spawn-process/acp-spawn.js";
import { spawnPiSession } from "../spawn-process/process-manager.js";
import { deriveSpawnCorrelationTtlMs } from "../spawn-process/spawn-recovery-window.js";
import { armSpawnWatchdog } from "../spawn-process/spawn-register-watchdog.js";
import { mintSpawnToken } from "../auth/spawn-token.js";
import type { NetworkGuard } from "../routes/route-deps.js";
import type { SessionManager } from "./memory-session-manager.js";
import { systemRenameUpdates, userRenameUpdates } from "./name-provenance.js";
import { decideResume } from "./session-origin.js";

/** Prompt delivery mode (change: leaf-only-helpers, WO-A 1.3). */
const PROMPT_MODES = ["steer", "followUp"] as const;
type PromptMode = (typeof PROMPT_MODES)[number];

/** Returns an error message, or undefined when absent/valid. */
function validatePromptMode(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !PROMPT_MODES.includes(value as PromptMode))
    return `mode must be one of: ${PROMPT_MODES.join(", ")}`;
  return undefined;
}

/** Spawn capability-scope body limits (change: leaf-only-helpers, WO-A 1.1). */
const SPAWN_EXCLUDE_TOOLS_MAX_ENTRIES = 32;
const SPAWN_EXCLUDE_TOOL_MAX_CHARS = 200;
const SPAWN_NAME_MAX_CHARS = 200;

/** Returns an error message, or undefined when absent/valid. */
function validateSpawnExcludeTools(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return "excludeTools must be an array of strings";
  if (value.length > SPAWN_EXCLUDE_TOOLS_MAX_ENTRIES)
    return `excludeTools must have at most ${SPAWN_EXCLUDE_TOOLS_MAX_ENTRIES} entries`;
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0)
      return "excludeTools entries must be non-empty strings";
    if (entry.length > SPAWN_EXCLUDE_TOOL_MAX_CHARS)
      return `excludeTools entries must be at most ${SPAWN_EXCLUDE_TOOL_MAX_CHARS} chars`;
  }
  return undefined;
}

/** Returns an error message, or undefined when absent/valid. */
function validateSpawnName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) return "name must be a non-empty string";
  if (value.length > SPAWN_NAME_MAX_CHARS) return `name must be at most ${SPAWN_NAME_MAX_CHARS} chars`;
  return undefined;
}

export interface SessionApiDeps {
  sessionManager: SessionManager;
  piGateway: PiGateway;
  browserGateway: BrowserGateway;
  pendingForkRegistry?: PendingForkRegistry;
  pendingDashboardSpawns?: Map<string, number>;
  /** D21 enforcement predicate; gates REST-spawn owner stamping (D11). */
  isResolverActive?: () => boolean;
  /** §6.2/D11: token-keyed owner correlation, shared with the browser spawn road. */
  pendingPrincipalOwnerRegistry?: import("../pending/pending-principal-owner-registry.js").PendingPrincipalOwnerRegistry;
  /**
   * User-resume-intent registry. Tagged in the resume endpoint so the
   * `sessionManager.onChange` ended→alive branch can distinguish a
   * REST-initiated user resume from a bridge auto-reattach on reboot.
   * See change: preserve-session-order-on-reboot.
   */
  pendingResumeIntents?: PendingResumeIntentRegistry;
  /**
   * Optional pending-attach registry. When provided, the resume endpoint's
   * fork-empty-session degradation path inherits the parent's
   * `attachedProposal` for the new spawn.
   * See change: fix-fork-empty-session-silent-timeout.
   */
  pendingAttachRegistry?: import("../pending/pending-attach-registry.js").PendingAttachRegistry;
  /**
   * Prompts transmitted and awaiting a bridge acknowledgement.
   * See change: fix-spawn-correlation-ttl-coupling (D7).
   */
  pendingPromptAcks?: import("../pending/pending-prompt-acks.js").PendingPromptAcks;
  /** Archive index + transition owner. See change: archive-sessions-lazy-load. */
  sessionArchive?: import("./session-archive.js").SessionArchive;
  /** One-shot intents for idle-alive archive requests. See change: archive-sessions-lazy-load. */
  pendingArchiveIntents?: PendingArchiveIntentRegistry;
  /**
   * Shared lifecycle handler. server.ts wires the real implementation (the
   * force-kill ladder + the three bridge forwards). Absent in unit contexts
   * that never hit the route. See change: expand-mcp-tiered-surface (D3).
   */
  handleLifecycle?: (sessionId: string, action: LifecycleAction, extras?: { pgid?: number }) => Promise<{ delivered?: boolean } | void>;
  /**
   * Live trusted-network list, for the in-handler `operate` check on the two
   * destructive lifecycle actions (`force_kill`, `kill_process`).
   * See change: expand-mcp-tiered-surface (D3).
   */
  getTrustedNetworks?: () => string[];
  /** Strict local-proof context (`requireLocalProof`). */
  localTrust?: import("../auth/local-proof.js").LocalTrustContext;
  /**
   * Admission guard for the lifecycle/extension-ui routes. Without it an
   * unauthenticated off-host caller (no Origin, so the CSRF gate is silent)
   * could reach the destructive lifecycle handler. See change:
   * expand-mcp-tiered-surface (D3).
   */
  networkGuard?: NetworkGuard;
}

type IdParams = { Params: { id: string } };

/** Helper: validate session exists, return it or send error response */
function getSessionOrFail(sessionManager: SessionManager, id: string): { session: any } | { error: ApiResponse } {
  const session = sessionManager.get(id);
  if (!session) return { error: { success: false, error: "session not found" } };
  return { session };
}

export function registerSessionApi(fastify: FastifyInstance, deps: SessionApiDeps) {
  const { sessionManager, piGateway, browserGateway, pendingForkRegistry, pendingDashboardSpawns, pendingResumeIntents, pendingAttachRegistry, pendingPromptAcks, sessionArchive, pendingArchiveIntents } = deps;
  const handleLifecycle = deps.handleLifecycle;
  const getTrustedNetworks = deps.getTrustedNetworks ?? (() => []);
  const networkGuard = deps.networkGuard;

  // Bootstrap gate + queue removed under change: eliminate-electron-runtime-install
  // (task 3.5). pi/openspec/tsx ship as regular npm deps so pi is always
  // resolvable at startup; queueing pi-dependent operations during an
  // install window is no longer needed.

  // POST /api/session/:id/prompt
  fastify.post<IdParams & { Body: { text?: string; images?: any[]; mode?: string } }>(
    "/api/session/:id/prompt",
    async (request, reply) => {
      const { id } = request.params;
      const { text, images, mode } = request.body ?? {};
      // Untrusted input: a bare truthiness check accepted objects and numbers,
      // which then reached the bridge as a `send_prompt.text`.
      // See change: fix-spawn-correlation-ttl-coupling.
      if (typeof text !== "string" || text.length === 0) {
        reply.code(400);
        return { success: false, error: "text is required" } satisfies ApiResponse;
      }
      if (images !== undefined && !Array.isArray(images)) {
        reply.code(400);
        return { success: false, error: "images must be an array" } satisfies ApiResponse;
      }
      // WO-A (change: leaf-only-helpers): `mode` selects how pi takes the prompt
      // (`deliverAs`). It rides the bridge `send_prompt` as `delivery`, the field
      // the bridge already routes: while streaming, "followUp" (the default, so
      // today's bridge-buffered queueing is unchanged) buffers in the bridge and
      // "steer" goes to pi as `{deliverAs:"steer"}`; idle, both go straight to pi.
      const modeError = validatePromptMode(mode);
      if (modeError) {
        reply.code(400);
        return { success: false, error: modeError } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      // The handle rides OUT on `send_prompt` and comes back on the bridge's
      // `prompt_received`, which is what makes delivery observable without
      // gating this response on a round trip.
      // See change: fix-spawn-correlation-ttl-coupling (D7).
      const promptId = randomUUID();
      const sent = piGateway.sendToSession(id, {
        type: "send_prompt",
        sessionId: id,
        text,
        images,
        promptId,
        delivery: (mode ?? "followUp") as "steer" | "followUp",
      });
      if (!sent) {
        reply.code(502);
        return {
          success: false,
          transmitted: false,
          error: "no bridge connection for session",
        } satisfies ApiResponse;
      }
      // Bounded on the same derived window as the spawn correlations, and on
      // the session unregistering (`event-wiring`). Sharing the spawn formula
      // is DELIBERATE, not incidental: the ack has no watchdog of its own to
      // outlive, and a change whose thesis is TTL discipline should not invent
      // a second unexplained number for the same "how long can a bridge stay
      // silent before we stop waiting" question.
      // A prompt whose text is a slash command is dispatched by a bridge path
      // that never echoes the handle, so its delivery stays unobservable and
      // the entry simply TTL-evicts. Recorded, not fixed here.
      // See change: fix-spawn-correlation-ttl-coupling (D7).
      pendingPromptAcks?.record(
        promptId,
        id,
        deriveSpawnCorrelationTtlMs(loadConfig().spawnRegisterTimeoutMs),
      );
      // A live contention record means a second bridge recently claimed this
      // id. The routing table cannot hold a usurper any more, so the prompt WAS
      // delivered to the one owner — but the caller must not read a plain
      // success while the session's bridge state is disputed. Annotated, not
      // failed: reporting a bare failure would invite a retry and double-send.
      // See change: fix-duplicate-bridge-registration (D4).
      //
      // It reports TRANSMISSION only. The former `delivered: true` here was
      // false advertising: this branch is exactly the displaced-bridge case
      // where a socket write is least likely to have reached pi.
      // See change: fix-spawn-correlation-ttl-coupling (D7).
      const record = piGateway.contention?.get(id);
      if (record) {
        return {
          success: true,
          transmitted: true,
          promptId,
          bridgeState: "contended",
          warning:
            `another bridge recently claimed session ${id} and was refused ` +
            `(incumbent pid ${record.incumbentPid ?? "unknown"}, ` +
            `newcomer pid ${record.newcomerPid ?? "unknown"}); ` +
            "the prompt was transmitted to the bridge that owns this session",
        };
      }
      return { success: true, transmitted: true, promptId } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/abort
  fastify.post<IdParams>(
    "/api/session/:id/abort",
    async (request, reply) => {
      const { id } = request.params;
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      piGateway.sendToSession(id, { type: "abort", sessionId: id });
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/shutdown
  fastify.post<IdParams>(
    "/api/session/:id/shutdown",
    async (request, reply) => {
      const { id } = request.params;
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      // Delegate rather than re-implement. As a parallel implementation this
      // route omitted the `closedReason:"manual"` liveness write (#449, so a
      // REST-closed session came back as a cold-start recovery candidate) and
      // killed only through the headless registry — leaking a tmux-spawned `pi`
      // exactly as the WS path used to (#452).
      // See change: fix-tmux-session-shutdown-leak (task 7.4).
      await browserGateway.shutdownSession(id);
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/rename
  fastify.post<IdParams & { Body: { name?: string } }>(
    "/api/session/:id/rename",
    async (request, reply) => {
      const { id } = request.params;
      const { name } = request.body ?? {};
      if (name === undefined) {
        reply.code(400);
        return { success: false, error: "name is required" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      // A REST rename is a user action, like the browser path: tag `user`,
      // clear the witness. See change: investigate-auto-name-provenance-relabel (D2).
      const updates = userRenameUpdates(name);
      sessionManager.update(id, updates);
      browserGateway.broadcastSessionUpdated(id, updates);
      piGateway.sendToSession(id, { type: "rename_session", sessionId: id, name });
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/archive
  fastify.post<IdParams>(
    "/api/session/:id/archive",
    async (request, reply) => {
      const { id } = request.params;
      const result = await requestArchive(id, {
        sessionManager,
        piGateway,
        headlessPidRegistry: browserGateway.headlessPidRegistry,
        broadcast: (msg) => browserGateway.broadcast(msg),
        sessionArchive,
        pendingArchiveIntents,
      });
      if (!result.ok) {
        reply.code(result.error === "session not found" ? 404 : 409);
        return { success: false, error: result.error } satisfies ApiResponse;
      }
      return (result.pending ? { success: true, pending: true } : { success: true }) as ApiResponse;
    },
  );

  // POST /api/session/:id/unarchive
  fastify.post<IdParams>(
    "/api/session/:id/unarchive",
    async (request, reply) => {
      const { id } = request.params;
      const result = sessionArchive?.unarchiveSession(id);
      if (!result?.ok) {
        reply.code(404);
        return { success: false, error: result?.error ?? "archive unavailable" } satisfies ApiResponse;
      }
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/spawn
  fastify.post<{ Body: { cwd?: string; agent?: string; excludeTools?: string[]; name?: string } }>(
    "/api/session/spawn",
    async (request, reply) => {
      const { cwd, agent, excludeTools, name } = request.body ?? {};
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd is required" } satisfies ApiResponse;
      }
      // `agent` selects a configured ACP agent (see change: add-acp-session-driver).
      const acpAgent = agent === undefined ? undefined : validateAcpAgent(agent);
      if (acpAgent && !acpAgent.ok) {
        reply.code(400);
        return { success: false, error: acpAgent.message } satisfies ApiResponse;
      }
      // WO-A (change: leaf-only-helpers): the caller may narrow the spawned
      // session's capabilities (`excludeTools`) and title it (`name`). Both are
      // validated at the HTTP boundary before anything is minted or spawned.
      const excludeToolsError = validateSpawnExcludeTools(excludeTools);
      if (excludeToolsError) {
        reply.code(400);
        return { success: false, error: excludeToolsError } satisfies ApiResponse;
      }
      const nameError = validateSpawnName(name);
      if (nameError) {
        reply.code(400);
        return { success: false, error: nameError } satisfies ApiResponse;
      }
      // ACP spawns cannot apply pi-only capability scope; refuse rather than
      // report a successful spawn that silently dropped the restriction.
      if (acpAgent?.ok && (excludeTools !== undefined || name !== undefined)) {
        reply.code(400);
        return { success: false, error: "excludeTools and name are not supported for ACP agent spawns" } satisfies ApiResponse;
      }
      if (acpAgent?.ok) {
        const preflight = preflightAcpSpawn(cwd, acpAgent.agent);
        if (!preflight.ok) {
          reply.code(400);
          return { success: false, error: preflight.reasons.map((r) => r.message).join("; ") } satisfies ApiResponse;
        }
      }

      // D11 trusted road: a host HTTP spawn stamps the REQUEST principal (a
      // resolved human — never the local operator or a device bearer), filed
      // against a pre-minted spawn token BEFORE the spawn await, exactly like
      // the browser `spawn_session` road. Inert / principal-less ⇒ ownerless.
      const requestPrincipal = (request as { principal?: { iss: string; sub: string } }).principal;
      const ownerToStamp =
        deps.isResolverActive?.() && requestPrincipal
          ? { iss: requestPrincipal.iss, sub: requestPrincipal.sub }
          : undefined;
      const ownerSpawnToken = ownerToStamp ? mintSpawnToken() : undefined;
      if (ownerToStamp && ownerSpawnToken) deps.pendingPrincipalOwnerRegistry?.file(ownerSpawnToken, ownerToStamp);

      const doSpawn = async () => {
        const config = loadConfig();
        const spawnResult = acpAgent?.ok
          ? await spawnAcpSession(cwd, { agent: acpAgent.agent.id, ...(ownerSpawnToken ? { spawnToken: ownerSpawnToken } : {}) })
          : await spawnPiSession(cwd, {
              strategy: config.spawnStrategy,
              ...(ownerSpawnToken ? { spawnToken: ownerSpawnToken } : {}),
              ...(excludeTools ? { excludeTools } : {}),
              ...(name ? { name } : {}),
            });
        // REST spawn has no browser socket; the reclaim must run regardless, or
        // a duplicate refused for contention keeps writing the incumbent's
        // transcript. See change: fix-duplicate-bridge-registration (D0/D2).
        armSpawnWatchdog(cwd, (acpAgent ? "headless" : config.spawnStrategy) as any, spawnResult);
        if (spawnResult.process && spawnResult.pid) {
          browserGateway.headlessPidRegistry.register(
            spawnResult.pid,
            cwd,
            spawnResult.process,
            spawnResult.spawnToken,
            keeperOptsFromSpawnResult(spawnResult),
          );
        }
        if (spawnResult.dashboardSpawned && spawnResult.success) {
          pendingDashboardSpawns?.set(cwd, (pendingDashboardSpawns?.get(cwd) ?? 0) + 1);
        }
        return spawnResult;
      };

      const spawnResult = await doSpawn();
      if (!spawnResult.success) {
        if (ownerSpawnToken) deps.pendingPrincipalOwnerRegistry?.remove(ownerSpawnToken);
        reply.code(500);
        return { success: false, error: spawnResult.message } satisfies ApiResponse;
      }
      return { success: true, data: { message: spawnResult.message } } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/resume
  fastify.post<IdParams & { Body: { mode?: string } }>(
    "/api/session/:id/resume",
    async (request, reply) => {
      const { id } = request.params;
      const { mode } = request.body ?? {};
      if (mode !== "continue" && mode !== "fork") {
        reply.code(400);
        return { success: false, error: "mode must be 'continue' or 'fork'" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      const session = result.session;
      // ACP sessions cannot be resumed or forked: refuse before any side effect.
      // See change: add-acp-session-driver (D15).
      if (isAcp(session)) {
        reply.code(409);
        return { success: false, error: unsupportedMessage(mode), code: UNSUPPORTED_FOR_ACP } as ApiResponse;
      }
      // D13 / task 11.11: a session that ran on ANOTHER host is read-only here.
      // Checked before the `sessionFile` guard because the interesting remote
      // failure is not an absent path but a present, unrelated one — two hosts
      // with the same username produce identical paths, so resuming would
      // attach a local pi as a second writer to a stranger's transcript (#E15).
      const resumeVerdict = decideResume({
        origin: session.originDeviceId
          ? { local: false, deviceId: session.originDeviceId }
          : { local: true },
        status: session.status,
      });
      if (!resumeVerdict.allow) {
        reply.code(409);
        return { success: false, error: resumeVerdict.reason } satisfies ApiResponse;
      }
      if (!session.sessionFile) {
        reply.code(400);
        return { success: false, error: "session file is unknown" } satisfies ApiResponse;
      }
      // Reject "already active" ONLY when the process is genuinely live. A
      // zombie (stale "active" status, dead bridge + keeper) must be allowed to
      // reopen. See change: resume-zombie-active-session.
      if (
        mode === "continue" &&
        session.status !== "ended" &&
        !isSessionProcessGone(id, (sid) => piGateway.isSessionConnected(sid))
      ) {
        reply.code(409);
        return { success: false, error: "session is already active" } satisfies ApiResponse;
      }
      // The id-keyed guard above did not prevent the incident: a second keeper
      // resumed the same *session file* under a different id. Identity of a
      // conversation is the file; identity of a connection is the id. Refuse a
      // `continue` whose target file a live bridge already serves under ANY id.
      // Liveness is D1's definition, so a half-open bridge cannot lock a resume
      // out. Fork is exempt (it mints a new conversation).
      // See change: fix-duplicate-bridge-registration (D5).
      if (mode === "continue") {
        const liveHolder = piGateway.findLiveSessionBySessionFile?.(session.sessionFile);
        if (liveHolder && liveHolder !== id) {
          reply.code(409);
          return {
            success: false,
            error:
              `session file is already served by live session ${liveHolder}; ` +
              "resuming it would start a second pi writing the same transcript",
          } satisfies ApiResponse;
        }
      }
      if (session.resuming) {
        reply.code(409);
        return { success: false, error: "session is already being resumed" } satisfies ApiResponse;
      }
      // Fork preflight: silent-degrade when the source has no on-disk JSONL.
      // Mirrors the WS-handler logic. See change:
      // fix-fork-empty-session-silent-timeout.
      if (mode === "fork" && !existsSync(session.sessionFile)) {
        // Inherit attachedProposal from parent.
        if (session.attachedProposal && pendingAttachRegistry) {
          pendingAttachRegistry.enqueue(session.cwd, session.attachedProposal);
        }
        const degradeConfig = loadConfig();
        const degradeResult = await spawnPiSession(session.cwd, {
          strategy: degradeConfig.spawnStrategy,
        });
        armSpawnWatchdog(session.cwd, degradeConfig.spawnStrategy as any, degradeResult);
        if (degradeResult.process && degradeResult.pid) {
          browserGateway.headlessPidRegistry.register(
            degradeResult.pid,
            session.cwd,
            degradeResult.process,
            degradeResult.spawnToken,
            keeperOptsFromSpawnResult(degradeResult),
          );
        }
        if (degradeResult.dashboardSpawned && degradeResult.success) {
          pendingDashboardSpawns?.set(
            session.cwd,
            (pendingDashboardSpawns?.get(session.cwd) ?? 0) + 1,
          );
        }
        if (!degradeResult.success) {
          reply.code(500);
          return {
            success: false,
            error: degradeResult.message,
          } satisfies ApiResponse;
        }
        return {
          success: true,
          data: { message: FORK_DEGRADED_TO_NEW_MESSAGE },
          code: FORK_DEGRADED_TO_NEW_CODE,
        } satisfies ApiResponse<{ message: string }>;
      }
      // Tag the user-resume intent BEFORE spawning. REST resume always
      // uses "front" placement — the only "keep" path is drag-to-resume
      // which goes through the WebSocket handler, not this REST endpoint.
      // See changes: preserve-session-order-on-reboot,
      //              differentiate-resume-intent-by-trigger.
      pendingResumeIntents?.record(id, "front");
      const config = loadConfig();
      const spawnResult = await spawnPiSession(session.cwd, {
        sessionFile: session.sessionFile,
        mode,
        strategy: config.spawnStrategy,
      });
      // REST resume — the exact path that minted the incident's duplicate.
      const resumeTimeoutMs = armSpawnWatchdog(
        session.cwd,
        config.spawnStrategy as any,
        spawnResult,
        undefined,
        config.spawnRegisterTimeoutMs,
      );
      // Fork bookkeeping uses the spawn token (not cwd) so two concurrent
      // forks in the same cwd correlate correctly. Its TTL derives from the
      // same timeout that armed the watchdog above. See change:
      // spawn-correlation-token, fix-spawn-correlation-ttl-coupling.
      if (mode === "fork" && pendingForkRegistry && spawnResult.spawnToken) {
        pendingForkRegistry.recordFork(
          spawnResult.spawnToken,
          id,
          deriveSpawnCorrelationTtlMs(resumeTimeoutMs ?? config.spawnRegisterTimeoutMs),
        );
      }
      if (spawnResult.dashboardSpawned && spawnResult.success) {
        pendingDashboardSpawns?.set(session.cwd, (pendingDashboardSpawns?.get(session.cwd) ?? 0) + 1);
      }
      if (!spawnResult.success) {
        reply.code(500);
        return { success: false, error: spawnResult.message } satisfies ApiResponse;
      }
      return { success: true, data: { message: spawnResult.message } } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/flow-control
  fastify.post<IdParams & { Body: { action?: string } }>(
    "/api/session/:id/flow-control",
    async (request, reply) => {
      const { id } = request.params;
      const { action } = request.body ?? {};
      if (action !== "abort" && action !== "toggle_autonomous") {
        reply.code(400);
        return { success: false, error: "action must be 'abort' or 'toggle_autonomous'" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      if (isAcp(result.session)) {
        reply.code(409);
        return { success: false, error: unsupportedMessage("flow_control"), code: UNSUPPORTED_FOR_ACP } as ApiResponse;
      }
      piGateway.sendToSession(id, { type: "flow_control", sessionId: id, action });
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/model
  fastify.post<IdParams & { Body: { provider?: string; modelId?: string } }>(
    "/api/session/:id/model",
    async (request, reply) => {
      const { id } = request.params;
      const { provider, modelId } = request.body ?? {};
      if (!provider || !modelId) {
        reply.code(400);
        return { success: false, error: "provider and modelId are required" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      piGateway.sendToSession(id, { type: "set_model", sessionId: id, provider, modelId });
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/thinking-level
  fastify.post<IdParams & { Body: { level?: string } }>(
    "/api/session/:id/thinking-level",
    async (request, reply) => {
      const { id } = request.params;
      const { level } = request.body ?? {};
      if (!level) {
        reply.code(400);
        return { success: false, error: "level is required" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      piGateway.sendToSession(id, { type: "set_thinking_level", sessionId: id, level });
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/lifecycle — shared handler for the four lifecycle
  // verbs (stop_after_turn, retry, force_kill, kill_process). The route sits at
  // `control` in ROUTE_TIERS; the two destructive verbs additionally require
  // `operate`, checked HERE because the action is in the body and the
  // onRequest gate runs before body parsing. See change:
  // expand-mcp-tiered-surface (D3).
  fastify.post<IdParams & { Body: { action?: unknown } }>(
    "/api/session/:id/lifecycle",
    { ...(networkGuard ? { preHandler: networkGuard } : {}) },
    async (request, reply) => {
      const { id } = request.params;
      const action = request.body?.action;
      const pgid = (request.body as { pgid?: unknown } | undefined)?.pgid;
      if (!isLifecycleAction(action)) {
        reply.code(400);
        return {
          success: false,
          error: `action must be one of ${LIFECYCLE_ACTIONS.join(", ")}`,
        } satisfies ApiResponse;
      }
      const check = getSessionOrFail(sessionManager, id);
      if ("error" in check) {
        reply.code(404);
        return check.error;
      }
      if (action === "force_kill" || action === "kill_process") {
        const refusal = tierRefusalFor(request, "operate", getTrustedNetworks, deps.localTrust);
        if (refusal) {
          sendTierRefusal(reply, refusal.scope);
          return;
        }
      }
      // retry / stop_after_turn / kill_process are pi-only (force_kill stays valid).
      if (action !== "force_kill" && isAcp(check.session)) {
        reply.code(409);
        return { success: false, error: unsupportedMessage(action), code: UNSUPPORTED_FOR_ACP } as ApiResponse;
      }
      if (!handleLifecycle) {
        reply.code(501);
        return { success: false, error: "lifecycle handler not wired" } satisfies ApiResponse;
      }
      const result = await handleLifecycle(id, action, typeof pgid === "number" ? { pgid } : {});
      // Never report success for a forward that reached no bridge.
      if (result && result.delivered === false) {
        reply.code(502);
        return { success: false, transmitted: false, error: "no bridge connection for session" } satisfies ApiResponse;
      }
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/extension-ui-response — REST twin of the browser-WS
  // `extension_ui_response` case. Both clear the gateway's pendingUiRequests
  // entry and forward on the same shared path. See change:
  // expand-mcp-tiered-surface (D3).
  fastify.post<
    IdParams & { Body: { requestId?: unknown; result?: unknown; cancelled?: unknown } }
  >(
    "/api/session/:id/extension-ui-response",
    { ...(networkGuard ? { preHandler: networkGuard } : {}) },
    async (request, reply) => {
      const { id } = request.params;
      const { requestId, result, cancelled } = request.body ?? {};
      if (typeof requestId !== "string" || requestId.length === 0) {
        reply.code(400);
        return { success: false, error: "requestId is required" } satisfies ApiResponse;
      }
      const check = getSessionOrFail(sessionManager, id);
      if ("error" in check) {
        reply.code(404);
        return check.error;
      }
      browserGateway.clearUiRequest(id, requestId);
      forwardExtensionUiResponse(piGateway, {
        sessionId: id,
        requestId,
        result,
        cancelled: cancelled === true,
      });
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/attach-proposal
  fastify.post<IdParams & { Body: { changeName?: string } }>(
    "/api/session/:id/attach-proposal",
    async (request, reply) => {
      const { id } = request.params;
      const { changeName } = request.body ?? {};
      if (!changeName) {
        reply.code(400);
        return { success: false, error: "changeName is required" } satisfies ApiResponse;
      }
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      const updates: Record<string, unknown> = { attachedProposal: changeName };
      const session = result.session;
      // Idempotent auto-rename (see change: fix-mobile-attach-proposal-display).
      const newName = attachRenameTarget(session, changeName);
      if (newName !== undefined) {
        Object.assign(updates, systemRenameUpdates(session, newName));
        piGateway.sendToSession(id, { type: "rename_session", sessionId: id, name: newName, origin: "system" });
      }
      sessionManager.update(id, updates);
      browserGateway.broadcastSessionUpdated(id, updates);
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/session/:id/detach-proposal
  fastify.post<IdParams>(
    "/api/session/:id/detach-proposal",
    async (request, reply) => {
      const { id } = request.params;
      const result = getSessionOrFail(sessionManager, id);
      if ("error" in result) {
        reply.code(404);
        return result.error;
      }
      const session = result.session;
      const updates: Record<string, unknown> = {
        attachedProposal: null, openspecPhase: null, openspecChange: null,
        // Detach ends the attachment lifecycle — clear the replace-proposal
        // state too. See change: replace-proposal-dialog-with-race-handling.
        pendingReplaceProposal: null, rejectedReplaceProposals: [],
      };
      // Idempotent auto-revert (see change: fix-mobile-attach-proposal-display).
      if (detachShouldClearName(session)) {
        Object.assign(updates, systemRenameUpdates(session, ""));
        piGateway.sendToSession(id, { type: "rename_session", sessionId: id, name: "", origin: "system" });
      }
      sessionManager.update(id, updates);
      browserGateway.broadcastSessionUpdated(id, updates);
      return { success: true } satisfies ApiResponse;
    },
  );
}
