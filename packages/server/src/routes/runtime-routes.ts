/**
 * Runtime overlay REST surface (D3, D7, D10).
 *
 *   GET  /api/runtime/status[?refresh=true]   runtime identity + check + staging
 *   POST /api/runtime/source   {source: bundled|npm|github, channel?, pin?}
 *   POST /api/runtime/update   {version?}            → stage (202, progress via WS)
 *   POST /api/runtime/activate {}                    → request.json activateNonce
 *   POST /api/runtime/rollback {to: previous|bundled}
 *
 * All behind `networkGuard` (+ the global mutation-origin gate). Mutations are
 * Electron-only (403 otherwise, same pattern as /api/electron/reextract).
 * The server writes ONLY request.json; no route can set a local source or
 * path — local is enabled from the Electron app menu only (D7). Choosing any
 * source here bumps `sourceSeq`, which turns a local link off.
 *
 * See change: electron-runtime-overlay-updates.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { RuntimeUpdateMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { LaunchSource } from "@blackbelt-technology/pi-dashboard-shared/dashboard-starter.js";
import { readRuntimeManifest } from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/manifest.mjs";
import {
  deriveEffectiveSource,
  patchRuntimeRequest,
  type RuntimeChannel,
  type RuntimeSource,
  readRuntimeRequest,
  readRuntimeState,
  selectRuntimeSource,
} from "@blackbelt-technology/pi-dashboard-shared/runtime-overlay/state.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import semver from "semver";
import type { RuntimeHealth } from "../runtime-overlay/runtime-health.js";
import type { StageProgress, StageSource } from "../runtime-overlay/runtime-stager.js";
import type { RuntimeUpdateChecker } from "../runtime-overlay/runtime-update-checker.js";
import type { NetworkGuard } from "./route-deps.js";

export interface RuntimeRouteDeps {
  dir: string;
  launchSource: () => LaunchSource;
  networkGuard: NetworkGuard;
  checker: Pick<RuntimeUpdateChecker, "check" | "peek" | "invalidate">;
  stage: (version: string, source: StageSource, onProgress: (p: StageProgress) => void) => Promise<{ root: string }>;
  runtimeHealth: () => RuntimeHealth;
  /** pi-coding-agent version the running server resolves (Settings display). */
  piVersion?: () => string | undefined;
  /**
   * Shared package-manager lock (`PackageManagerWrapper.runExclusive`): staging
   * never overlaps a pi-core/package install. Default: run directly.
   */
  exclusive?: <T>(fn: () => Promise<T>) => Promise<T>;
  /** WS broadcast of staging progress / completion. */
  broadcast?: (msg: RuntimeUpdateMessage) => void;
}

const SELECTABLE: ReadonlySet<string> = new Set<RuntimeSource>(["bundled", "npm", "github"]);
const CHANNELS: ReadonlySet<string> = new Set<RuntimeChannel>(["stable", "beta"]);

type Body = Record<string, unknown>;

function bad(reply: FastifyReply, code: number, error: string, message: string) {
  reply.code(code);
  return { success: false, error, message };
}

function onlyKeys(body: Body, allowed: string[]): string | null {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  return extra.length ? extra.join(", ") : null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; message: string };

/** POST /api/runtime/source body. Any local-folder field is refused (D7). */
function parseSourceBody(body: Body): Parsed<{ source: RuntimeSource; channel?: RuntimeChannel; pin?: string | null }> {
  const extra = onlyKeys(body, ["source", "channel", "pin"]);
  if (extra) return { ok: false, error: "invalid_body", message: `unsupported field(s): ${extra} — a local folder is set from the app menu only` };
  const { source, channel, pin } = body;
  if (typeof source !== "string" || !SELECTABLE.has(source)) {
    return { ok: false, error: "invalid_source", message: "source must be bundled, npm or github (local is set from the app menu)" };
  }
  if (channel !== undefined && (typeof channel !== "string" || !CHANNELS.has(channel))) {
    return { ok: false, error: "invalid_channel", message: "channel must be stable or beta" };
  }
  if (pin !== undefined && pin !== null && (typeof pin !== "string" || semver.valid(pin) !== pin)) {
    return { ok: false, error: "invalid_pin", message: "pin must be an exact version" };
  }
  return {
    ok: true,
    value: {
      source: source as RuntimeSource,
      ...(channel !== undefined ? { channel: channel as RuntimeChannel } : {}),
      ...(pin !== undefined ? { pin: pin as string | null } : {}),
    },
  };
}

/** POST /api/runtime/update body: only an exact `version` — no package specs (allowlist). */
function parseUpdateBody(body: Body): Parsed<string | undefined> {
  const extra = onlyKeys(body, ["version"]);
  if (extra) return { ok: false, error: "invalid_body", message: `unsupported field(s): ${extra} — only first-party runtime releases can be staged` };
  if (body.version !== undefined && (typeof body.version !== "string" || semver.valid(body.version) !== body.version)) {
    return { ok: false, error: "invalid_version", message: "version must be an exact release version" };
  }
  return { ok: true, value: body.version as string | undefined };
}

export function registerRuntimeRoutes(fastify: FastifyInstance, deps: RuntimeRouteDeps): void {
  let staging: { version: string; last?: StageProgress } | null = null;
  let lastStageError: { version: string; message: string } | null = null;

  const electronOnly = async (_req: FastifyRequest, reply: FastifyReply) => {
    if (deps.launchSource() !== "electron") {
      reply.code(403).send({
        success: false,
        error: "runtime_electron_only",
        message: "Runtime updates are only available in the desktop app.",
      });
    }
  };
  const mutation = { preHandler: [deps.networkGuard, electronOnly] };
  // Every request.json mutation is refused while a stage is in flight: a
  // rollback/source change landing mid-stage would be overwritten by the
  // stage's `pending`, or publish a runtime fetched from the old source.
  const notStaging = async (_req: FastifyRequest, reply: FastifyReply) => {
    if (staging) {
      reply.code(409).send({ success: false, error: "staging_busy", message: `Staging ${staging.version} is in progress.` });
    }
  };
  const quietMutation = { preHandler: [deps.networkGuard, electronOnly, notStaging] };
  const exclusive = deps.exclusive ?? (<T>(fn: () => Promise<T>) => fn());

  /** Target of an Update without an explicit version: the checker's release. */
  const resolveCheckTarget = async (): Promise<Parsed<string>> => {
    const check = await deps.checker.check();
    if (check.state === "available" || check.state === "up_to_date") return { ok: true, value: check.target };
    return { ok: false, error: "no_target", message: check.state === "check_failed" ? check.reason : "no release to stage" };
  };

  /**
   * Reserve the single staging slot BEFORE any await (atomic w.r.t. other
   * requests), then resolve the version (explicit, or the checker target).
   * The slot is released again on failure.
   */
  const reserveStaging = async (explicit: string | undefined): Promise<Parsed<{ version: string; last?: StageProgress }>> => {
    const job: { version: string; last?: StageProgress } = { version: explicit ?? "(resolving)" };
    staging = job;
    let target: Parsed<string>;
    try {
      target = explicit !== undefined ? { ok: true, value: explicit } : await resolveCheckTarget();
    } catch (err) {
      target = { ok: false, error: "no_target", message: err instanceof Error ? err.message : String(err) };
    }
    if (!target.ok) {
      staging = null;
      return target;
    }
    job.version = target.value;
    return { ok: true, value: job };
  };

  /** Background staging job; progress + result over WS, one job at a time. */
  const startStaging = (job: { version: string; last?: StageProgress }, source: StageSource): void => {
    const { version } = job;
    lastStageError = null;
    const onProgress = (p: StageProgress) => {
      job.last = p;
      deps.broadcast?.({ type: "runtime_update_progress", ...p });
    };
    console.log(`[runtime-overlay] stage start version=${version} source=${source}`);
    exclusive(() => deps.stage(version, source, onProgress))
      .then(() => {
        console.log(`[runtime-overlay] stage done version=${version} source=${source} → pending`);
        deps.broadcast?.({ type: "runtime_update_staged", version });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        lastStageError = { version, message };
        console.warn(`[runtime-overlay] stage failed version=${version} source=${source} reason=${message}`);
        deps.broadcast?.({ type: "runtime_update_failed", version, message });
      })
      .finally(() => {
        staging = null;
      });
  };

  const writeActivate = () => {
    const next = patchRuntimeRequest(deps.dir, { activateNonce: randomUUID() });
    console.log(`[runtime-overlay] activate requested nonce=${next.activateNonce} pending=${next.pending ?? "none"} source=${next.source}`);
    return next;
  };

  fastify.get<{ Querystring: { refresh?: string } }>("/api/runtime/status", { preHandler: deps.networkGuard }, async (request) => {
    // Cached 24 h per selection; `refresh=true` is "Check now".
    const check = await deps.checker.check({ force: request.query.refresh === "true" });
    const req = readRuntimeRequest(deps.dir);
    const state = readRuntimeState(deps.dir);
    const previous = typeof state.previous === "string" && !state.previous.startsWith("local:") ? state.previous : undefined;
    return {
      success: true,
      data: {
        runtime: deps.runtimeHealth(),
        piVersion: deps.piVersion?.() ?? null,
        source: deriveEffectiveSource(req, state),
        channel: req?.channel ?? "stable",
        pin: req?.pin ?? null,
        pending: req?.pending ?? null,
        previous: previous ?? null,
        check,
        staging,
        lastStageError,
      },
    };
  });

  fastify.post<{ Body: Body }>("/api/runtime/source", quietMutation, async (request, reply) => {
    const parsed = parseSourceBody(request.body ?? {});
    if (!parsed.ok) return bad(reply, 400, parsed.error, parsed.message);
    const next = selectRuntimeSource(deps.dir, parsed.value);
    deps.checker.invalidate();
    return { success: true, data: { source: next.source, channel: next.channel ?? "stable", pin: next.pin ?? null } };
  });

  fastify.post<{ Body: Body }>("/api/runtime/update", mutation, async (request, reply) => {
    const parsed = parseUpdateBody(request.body ?? {});
    if (!parsed.ok) return bad(reply, 400, parsed.error, parsed.message);
    const source = readRuntimeRequest(deps.dir)?.source;
    if (source !== "npm" && source !== "github") {
      return bad(reply, 409, "no_remote_source", "Choose npm or GitHub as the update source first.");
    }
    if (staging) return bad(reply, 409, "staging_busy", `Already staging ${staging.version}.`);
    const reserved = await reserveStaging(parsed.value);
    if (!reserved.ok) return bad(reply, 409, reserved.error, reserved.message);
    const job = reserved.value;
    const version = job.version;
    startStaging(job, source);
    reply.code(202);
    return { success: true, data: { version } };
  });

  fastify.post("/api/runtime/activate", quietMutation, async (_request, reply) => {
    const next = writeActivate();
    reply.code(202);
    return { success: true, data: { pending: next.pending ?? null } };
  });

  /** Point request.json at the rollback target; null = refused (reason in the error). */
  const pointRollback = (to: unknown): { target: string } | { code: number; error: string; message: string } => {
    if (to === "bundled") {
      // Also turns a local link off (sourceSeq bump).
      selectRuntimeSource(deps.dir, { source: "bundled" });
      deps.checker.invalidate();
      return { target: "bundled" };
    }
    if (to !== "previous") return { code: 400, error: "invalid_target", message: "to must be previous or bundled" };
    const previous = readRuntimeState(deps.dir).previous;
    if (!previous) return { code: 409, error: "no_previous", message: "There is no previous runtime." };
    if (previous.startsWith("local:")) {
      return { code: 409, error: "previous_is_local", message: "The previous runtime is a local folder — re-select it from the app menu." };
    }
    if (previous === "bundled") {
      selectRuntimeSource(deps.dir, { source: "bundled" });
      return { target: previous };
    }
    // Electron only considers overlays for an npm/github source: restore the
    // previous runtime's own origin (from its manifest) along with `pending`.
    const origin = readRuntimeManifest(path.join(deps.dir, "versions", previous))?.origin;
    if (origin !== "npm" && origin !== "github") {
      return { code: 409, error: "previous_missing", message: `The previous runtime ${previous} is no longer installed.` };
    }
    if (readRuntimeRequest(deps.dir)?.source !== origin) selectRuntimeSource(deps.dir, { source: origin });
    patchRuntimeRequest(deps.dir, { pending: previous });
    return { target: previous };
  };

  fastify.post<{ Body: Body }>("/api/runtime/rollback", quietMutation, async (request, reply) => {
    const res = pointRollback(request.body?.to);
    if ("code" in res) return bad(reply, res.code, res.error, res.message);
    writeActivate();
    reply.code(202);
    return { success: true, data: { target: res.target } };
  });
}
