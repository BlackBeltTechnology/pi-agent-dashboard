/**
 * Access-prompt review API (change: add-access-grant-dialog, tasks 8.1-8.3,
 * 8b.7a/8b.7b/8b.8, 2b.9).
 *
 * The Access page is the second place an access prompt can be answered: every
 * pending entry, prompted or not, is listed and answerable here, INCLUDING when
 * prompting is disabled or host admission is in report mode (spec
 * access-settings-tab). The WebSocket answers only prompted entries under live
 * `enforce` (`GrantCoordinator.onResponse`); this surface uses `settle`, which is
 * why its mutations sit behind the same gates as the grant endpoint:
 *
 *   (a) the global cross-site mutation-origin gate (every non-GET `/api/*`);
 *   (b) `networkGuard`: genuinely-local (tunnel-aware), local token, trusted
 *       network, or authenticated. Deliberately WIDER than
 *       `POST /api/access/grants` (auth-or-loopback): a trusted-network browser
 *       can already answer through the dialog (WS), so the Access page gives it
 *       the same reach, YOLO included (user decision C).
 *
 * Reads sit behind `networkGuard` only, like every Access read. `channel` (the
 * requester key: a socket id or a source prefix) is never serialised.
 */
import type {
  AccessPlaneId,
  GrantPromptCopy,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { FastifyInstance } from "fastify";
import type { AccessPlaneRegistry } from "../access/access-plane.js";
import type { GrantCoordinator, GrantVerdictRecord } from "../access/grant-coordinator.js";
import type { PendingGrant } from "../access/pending-grant-registry.js";
import type { HostGateMode } from "../access/prompt-channel.js";
import type { Refusal } from "../access/refusal-ledger.js";
import type { YoloController, YoloLogEntry, YoloSession } from "../access/yolo-session.js";
import { YOLO_DURATIONS_MS } from "../access/yolo-session.js";
import type { NetworkGuard } from "./route-deps.js";

/** Why the operator would get no dialog right now (S4 banners). */
type PromptingBlocker = "report-mode" | "kill-switch" | "disabled";

interface PendingPromptView {
  promptId: string;
  plane: AccessPlaneId;
  subject: string;
  mode: "held" | "deferred";
  /** False = recorded without a dialog; `suppressedBy` says why. */
  prompted: boolean;
  suppressedBy?: string;
  recordedAt: number;
  expiresAt: number;
  /** Milliseconds left at response time; clients re-base on their own clock. */
  ttlMs: number;
  hits: number;
  store: string;
  copy: GrantPromptCopy;
}

/** One row of the verdict list: operator answers and YOLO auto-answers, told apart (8b.8). */
type VerdictView =
  | (GrantVerdictRecord & { answeredBy: "operator" })
  | (YoloLogEntry & { answeredBy: "yolo" });

interface AccessPromptsView {
  prompting: {
    enabled: boolean;
    killSwitch: boolean;
    hostGateMode: HostGateMode;
    /** Empty = a capability-holding browser would get dialogs. */
    blockers: PromptingBlocker[];
  };
  pending: PendingPromptView[];
  verdicts: VerdictView[];
  yolo: {
    /** Activation is offered only under `enforce` (no YOLO in report mode). */
    available: boolean;
    durationsMinutes: number[];
    session: YoloSession | null;
  };
  refusals: Refusal[];
}

export interface AccessPromptRouteDeps {
  networkGuard: NetworkGuard;
  coordinator: GrantCoordinator;
  planes: AccessPlaneRegistry;
  yolo: Pick<YoloController, "status" | "history" | "activate" | "end" | "offerRoots">;
  prompting(): { enabled: boolean; killSwitch: boolean; hostGateMode: HostGateMode };
  listRefusals(): Refusal[];
  clearRefusal(plane: AccessPlaneId, subject: string): boolean;
  now?(): number;
}

function promptingBlockers(p: {
  enabled: boolean;
  killSwitch: boolean;
  hostGateMode: HostGateMode;
}): PromptingBlocker[] {
  const out: PromptingBlocker[] = [];
  if (p.hostGateMode !== "enforce") out.push("report-mode");
  if (p.killSwitch) out.push("kill-switch");
  if (!p.enabled) out.push("disabled");
  return out;
}

/** Merge operator verdicts and YOLO auto-answers, newest first. */
function mergeVerdicts(operator: GrantVerdictRecord[], auto: YoloLogEntry[]): VerdictView[] {
  const rows: VerdictView[] = [
    ...operator.map((r) => ({ ...r, answeredBy: "operator" as const })),
    ...auto.map((r) => ({ ...r, answeredBy: "yolo" as const })),
  ];
  return rows.sort((a, b) => b.at - a.at);
}

function toPendingView(e: PendingGrant, planes: AccessPlaneRegistry, at: number): PendingPromptView {
  const plane = planes.get(e.plane);
  const view: PendingPromptView = {
    promptId: e.promptId,
    plane: e.plane,
    subject: e.subject,
    mode: e.mode,
    prompted: e.prompted,
    recordedAt: e.recordedAt,
    expiresAt: e.expiresAt,
    ttlMs: Math.max(0, e.expiresAt - at),
    hits: e.hits,
    store: e.store,
    copy: plane
      ? plane.describe(e.subject, e.ancestors)
      : { mode: "deferred", verdicts: ["allow-always", "deny"], store: e.store },
  };
  if (e.suppressedBy) view.suppressedBy = e.suppressedBy;
  return view;
}

/** Validate an activation body; `null` = a scoped request without a base. */
function parseYoloActivation(
  body: unknown,
): { durationMs: number; base: string; root?: string; unscoped: boolean } | null {
  const b = (body ?? {}) as { durationMinutes?: unknown; base?: unknown; root?: unknown; unscoped?: unknown };
  const unscoped = b.unscoped === true;
  const base = typeof b.base === "string" ? b.base : "";
  if (!unscoped && base === "") return null;
  return {
    // A non-number duration becomes NaN, which the controller refuses as invalid.
    durationMs: typeof b.durationMinutes === "number" ? b.durationMinutes * 60_000 : Number.NaN,
    base,
    root: typeof b.root === "string" ? b.root : undefined,
    unscoped,
  };
}

const SETTLE_STATUS: Record<string, number> = {
  malformed: 400,
  "unoffered-subject": 403,
  unknown: 404,
  expired: 410,
  duplicate: 409,
  ignored: 409,
};

export function registerAccessPromptRoutes(fastify: FastifyInstance, deps: AccessPromptRouteDeps): void {
  const { networkGuard, coordinator, planes, yolo } = deps;
  const now = deps.now ?? Date.now;

  fastify.get("/api/access/prompts", { preHandler: networkGuard }, async () => {
    const p = deps.prompting();
    const at = now();
    const pending = coordinator.registry.list(at).map((e) => toPendingView(e, planes, at));
    const data: AccessPromptsView = {
      prompting: { ...p, blockers: promptingBlockers(p) },
      pending,
      verdicts: mergeVerdicts(coordinator.recentVerdicts(), yolo.history()),
      yolo: {
        available: p.hostGateMode === "enforce",
        durationsMinutes: YOLO_DURATIONS_MS.map((ms) => ms / 60_000),
        session: yolo.status(),
      },
      refusals: deps.listRefusals(),
    };
    return { success: true, data };
  });

  // Answer a pending entry from the Access page (8.1): prompted or not, with
  // prompting disabled or not. The body is validated by the registry itself.
  fastify.post<{ Params: { promptId: string }; Body: { plane?: unknown; subject?: unknown; verdict?: unknown } }>(
    "/api/access/prompts/:promptId",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const out = await coordinator.settle({
        type: "grant_response",
        promptId: request.params.promptId,
        plane: body.plane,
        subject: body.subject,
        verdict: body.verdict,
      });
      if (!out.ok) {
        reply.code(SETTLE_STATUS[out.reason] ?? 400);
        return { success: false, error: out.reason };
      }
      return { success: true, data: out.record };
    },
  );

  // Legal YOLO roots for a base directory (the session cwd or a denial's
  // subject): the base and its ladder, forbidden rungs removed, narrowest first.
  fastify.get<{ Querystring: { base?: string } }>(
    "/api/access/yolo/roots",
    { preHandler: networkGuard },
    async (request, reply) => {
      const base = request.query.base;
      if (typeof base !== "string" || base === "") {
        reply.code(400);
        return { success: false, error: "base required" };
      }
      return { success: true, data: { roots: await yolo.offerRoots(base) } };
    },
  );

  // Activate, or ADD a root to the live session (8b.7b: one shared session,
  // timer unchanged). Every surface (Access card, dialog, directory page) posts here.
  fastify.post<{ Body: { durationMinutes?: unknown; base?: unknown; root?: unknown; unscoped?: unknown } }>(
    "/api/access/yolo",
    { preHandler: networkGuard },
    async (request, reply) => {
      const req = parseYoloActivation(request.body);
      if (!req) {
        reply.code(400);
        return { success: false, error: "base required" };
      }
      const out = await yolo.activate(req);
      if (!out.ok) {
        reply.code(out.reason === "report-mode" ? 409 : 400);
        return { success: false, error: out.reason };
      }
      console.warn(
        `[access-grant] YOLO ${out.added ? "root added" : "active"}: ${out.session.unscoped ? "UNSCOPED" : out.session.roots.map((r) => JSON.stringify(r.path)).join(", ")}`,
      );
      return { success: true, data: { session: out.session, added: out.added === true } };
    },
  );

  fastify.delete("/api/access/yolo", { preHandler: networkGuard }, async () => {
    yolo.end();
    console.warn("[access-grant] YOLO ended by the operator");
    return { success: true };
  });

  // Clear one remembered refusal (2b.9: durable, listed, clearable).
  fastify.delete<{ Querystring: { plane?: string; subject?: string } }>(
    "/api/access/refusals",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { plane, subject } = request.query;
      if (!plane || !subject || !planes.get(plane as AccessPlaneId)) {
        reply.code(400);
        return { success: false, error: "plane and subject required" };
      }
      if (!deps.clearRefusal(plane as AccessPlaneId, subject)) {
        reply.code(404);
        return { success: false, error: "no such refusal" };
      }
      return { success: true };
    },
  );
}
