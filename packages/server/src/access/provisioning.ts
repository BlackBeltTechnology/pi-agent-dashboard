/**
 * Provisioning registry (change: add-access-provisioning, design D1-D9, D14).
 *
 * One pending request = one project root + up to 32 folder lines + optional
 * remote goals. The registry only PROPOSES: `create` classifies and records,
 * `settle` is the ONLY place a grant is written, and only for a line the
 * operator approved and the server re-verified. It never touches the access-plane
 * `PendingGrantRegistry`, never consults YOLO, and owns no timer: `now` and every
 * collaborator are injected, expiry is lazy (`expire` / any call sweeps).
 *
 * Wiring (routes, gateway, `server.ts`) lives elsewhere. Callers must:
 *   - gate WHO may call `settle` (live prompt capability, D3) BEFORE calling it;
 *   - map `ProvisionFailure.status` to HTTP and send `provision_dismiss` from
 *     `deps.onTerminal` (called once per terminal transition, first-wins);
 *   - call `recordDroppedResponse()` for a `provision_response` they dropped.
 *
 * Trust limit (D11): approval proves a capability-holding connection answered.
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ProvisionLineClassification,
  ProvisionRemoteTarget,
  ProvisionRequestLine,
  ProvisionRequestMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { isSubjectWithin } from "@blackbelt-technology/pi-dashboard-shared/canonical-subject.js";
import type { MirrorSourceKind } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import { hasProjectRootMarker } from "@blackbelt-technology/pi-dashboard-shared/project-root.js";
import type { RecordGrantInput, RecordGrantResult } from "./access-grants.js";
import { type AccessGrant, GRANT_CAP_PER_SCOPE, listGrants, recordGrant, revokeGrant } from "./access-grants.js";
import {
  type ForbiddenSubjectsEnv,
  isUngrantableSubject,
  realpathNearestAncestor,
} from "./forbidden-subjects.js";
import type { HostGateMode } from "./prompt-channel.js";

// ── constants (design D6) ────────────────────────────────────────────────────

export const PROVISION_MAX_LINES = 32;
export const PROVISION_MAX_PENDING = 4;
export const PROVISION_TTL_MS = 10 * 60_000;
export const PROVISION_ROOT_RATE_MS = 60_000;
export const PROVISION_COOLDOWN_MS = 5 * 60_000;
export const PROVISION_GLOBAL_RATE_WINDOW_MS = 10 * 60_000;
export const PROVISION_GLOBAL_RATE_MAX = 3;
/** Terminal requests kept so `GET /:id` can report outcomes (memory only). */
export const PROVISION_ENDED_KEEP = 50;
export const PROVISION_WHY_MAX = 200;
export const PROVISION_PATH_MAX = 4096;
/** What a view carries for an absent / empty reason (spec "Reasons are bounded and inert"). */
export const PROVISION_NO_REASON = "no reason given";

// ── types ────────────────────────────────────────────────────────────────────

export type ProvisionStatus = "pending" | "settled" | "dismissed" | "expired";
export type ProvisionLineOutcome = "granted" | "rejected" | "changed" | "refused" | "failed" | "handed-off";

/** Why a request was refused at creation, or an answer was refused (HTTP status in `ProvisionFailure.status`). */
export type ProvisionErrorCode =
  | "disabled"
  | "prompting-disabled"
  | "report-mode"
  | "no-operator"
  | "invalid-request"
  | "empty"
  | "too-many-lines"
  | "invalid-root"
  | "pending-exists"
  | "capacity"
  | "rate-limited"
  | "cooldown"
  | "not-found"
  | "already-settled"
  | "invalid-response";

export interface ProvisionFailure {
  ok: false;
  status: number;
  error: ProvisionErrorCode;
  /** `invalid-root` only: which D8 rule failed. */
  reason?: ProjectRootRefusal;
  /** `pending-exists`: the request already pending for that root. */
  requestId?: string;
  retryAfterMs?: number;
}

export interface ProvisionLineView extends ProvisionRequestLine {
  /** Set once the request ended. */
  outcome?: ProvisionLineOutcome;
  /** Why a `refused` / `changed` / `failed` line ended so (`root-changed`, `capacity`, …). */
  reason?: string;
}

export interface ProvisionRequestView {
  requestId: string;
  status: ProvisionStatus;
  /** Real path of the claimed project root (a label, never proof of ownership). */
  projectRoot: string;
  lines: ProvisionLineView[];
  remote: { target: ProvisionRemoteTarget; outcome?: "handed-off" }[];
  createdAt: number;
  expiresAt: number;
  endedAt?: number;
}

export interface ProvisionStats {
  pending: number;
  created: number;
  /** Lines that ended `granted`. */
  approved: number;
  /** Grantable lines the operator rejected or omitted on a settled request. */
  rejected: number;
  dismissed: number;
  expired: number;
  /** Refused creations (any reason). */
  refused: number;
  droppedResponses: number;
}

/** Filesystem facts about one absolute path; `real` is the nearest-ancestor real path. */
export interface PathFacts {
  real: string;
  /** `real` exists (as a file or a directory). */
  exists: boolean;
  isDirectory: boolean;
  /** Holds `.git` or `.pi`; computed only for a directory. */
  hasMarker: boolean;
}

/** Injectable filesystem resolver. */
export interface ProvisioningFs {
  inspect(abs: string): PathFacts;
  inspectAsync(abs: string): Promise<PathFacts>;
  /** Strict `realpath`, `null` when the path does not resolve (settle's synchronous compare). */
  realpathStrict(abs: string): string | null;
}

/** The slice of the grant store the registry needs. */
export interface ProvisioningGrantStore {
  list(): Pick<AccessGrant, "subject" | "scope">[];
  record(input: RecordGrantInput): RecordGrantResult;
  revoke(subject: string, scope?: "session" | "project"): boolean;
  /** Persisted-scope cap (default `GRANT_CAP_PER_SCOPE`). */
  cap: number;
}

export interface ProvisioningDeps {
  now(): number;
  grants: ProvisioningGrantStore;
  /** `null` = no mirror installed; the choice is then skipped. */
  mirror(): { setChoice(kind: MirrorSourceKind, folder: string, choice: boolean | null): void } | null;
  /** Test seam: override a D6 bound (the pending cap of 4 is unreachable under the global 3/10 min rate). */
  limits?: { globalRateMax?: number };
  /** D7 readers, evaluated live on every create AND every settle. */
  ladder: {
    killSwitch(): boolean;
    promptEnabled(): boolean;
    hostGateMode(): HostGateMode;
    /** Live capability-holding operate-tier sockets. */
    operatorCount(): number;
  };
  fs?: ProvisioningFs;
  /** Home / platform for `~` expansion, forbidden subjects and credential folders. */
  env?: ForbiddenSubjectsEnv;
  /** Called ONCE per terminal transition; the wiring sends `provision_dismiss`. */
  onTerminal?(requestId: string, reason: "settled" | "dismissed" | "expired"): void;
  /** `[access-provision]` log sink (default `console.log`). */
  log?(line: string): void;
  newId?(): string;
}

export interface CreateInput {
  /** Raw project root as sent by the caller; validated here (D8). */
  projectRoot: unknown;
  lines: unknown;
  remote?: unknown;
}

export interface SettleInput {
  lines: { lineId: string; verdict: "approve" | "reject"; piTrust?: boolean }[];
}

export type ProjectRootRefusal = "not-absolute" | "missing" | "not-directory" | "forbidden" | "no-marker";

// ── pure helpers ─────────────────────────────────────────────────────────────

/** Control characters (C0, DEL, C1, line/paragraph separators) never reach a view or a log. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

/** Strip control characters, cap at `max` code points, mark a cut with `…`. */
export function capText(raw: string, max: number): string {
  const chars = Array.from(raw.replace(CONTROL_CHARS, ""));
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : chars.join("");
}

/** Bounded, inert reason text (D4); absent / empty / non-string → `PROVISION_NO_REASON`. */
export function sanitizeWhy(raw: unknown): string {
  if (typeof raw !== "string") return PROVISION_NO_REASON;
  const text = capText(raw, PROVISION_WHY_MAX);
  return text.trim() === "" ? PROVISION_NO_REASON : text;
}

/** Credential folders (D5a), relative to home; `Library/Keychains` is macOS only. */
function credentialFolders(home: string, platform: NodeJS.Platform): string[] {
  const rel = [".aws", ".gnupg", ".kube", ".docker"];
  if (platform === "darwin") rel.push(path.join("Library", "Keychains"));
  return rel.map((r) => path.join(home, r));
}

// ── default fs resolver ──────────────────────────────────────────────────────

async function realpathNearestAncestorAsync(p: string): Promise<string> {
  try {
    return await fs.promises.realpath(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(await realpathNearestAncestorAsync(parent), path.basename(p));
  }
}

async function markerAsync(dir: string): Promise<boolean> {
  for (const name of [".git", ".pi"]) {
    try {
      await fs.promises.access(path.join(dir, name));
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

export const defaultProvisioningFs: ProvisioningFs = {
  inspect(abs) {
    const real = realpathNearestAncestor(abs);
    let exists = false;
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(real).isDirectory();
      exists = true;
    } catch {
      /* missing */
    }
    return { real, exists, isDirectory, hasMarker: isDirectory && hasProjectRootMarker(real) };
  },
  async inspectAsync(abs) {
    const real = await realpathNearestAncestorAsync(abs);
    let exists = false;
    let isDirectory = false;
    try {
      isDirectory = (await fs.promises.stat(real)).isDirectory();
      exists = true;
    } catch {
      /* missing */
    }
    return { real, exists, isDirectory, hasMarker: isDirectory && (await markerAsync(real)) };
  },
  realpathStrict(abs) {
    try {
      return fs.realpathSync(abs);
    } catch {
      return null;
    }
  },
};

/** The live grant store (`access-grants.ts`) as the registry's `grants` dep. */
export function createDefaultProvisioningGrantStore(): ProvisioningGrantStore {
  return { list: listGrants, record: recordGrant, revoke: revokeGrant, cap: GRANT_CAP_PER_SCOPE };
}

// ── project root (design D8) ─────────────────────────────────────────────────

function checkRootFacts(abs: string, facts: PathFacts, env: ForbiddenSubjectsEnv): { ok: true; real: string } | { ok: false; reason: ProjectRootRefusal } {
  if (!path.isAbsolute(abs)) return { ok: false, reason: "not-absolute" };
  if (!facts.isDirectory) return { ok: false, reason: facts.exists ? "not-directory" : "missing" };
  if (isUngrantableSubject(facts.real, env)) return { ok: false, reason: "forbidden" };
  if (!facts.hasMarker) return { ok: false, reason: "no-marker" };
  return { ok: true, real: facts.real };
}

/**
 * D8: `projectRoot` must be absolute, an existing directory holding `.git` or
 * `.pi`, and not an ungrantable subject. Returns the REAL path (the pending key
 * and every grant's `origin`), or the first failing rule.
 */
export function validateProjectRoot(
  projectRoot: unknown,
  opts: { fs?: ProvisioningFs; env?: ForbiddenSubjectsEnv } = {},
): { ok: true; real: string } | { ok: false; reason: ProjectRootRefusal } {
  if (typeof projectRoot !== "string" || projectRoot === "" || projectRoot.includes("\0") || !path.isAbsolute(projectRoot)) {
    return { ok: false, reason: "not-absolute" };
  }
  const facts = (opts.fs ?? defaultProvisioningFs).inspect(projectRoot);
  return checkRootFacts(projectRoot, facts, opts.env ?? {});
}

/** First verdict per `lineId` wins; a non-boolean `piTrust` is `false` (design D9). */
function parseVerdicts(input: SettleInput): Map<string, { approve: boolean; piTrust: boolean }> {
  const out = new Map<string, { approve: boolean; piTrust: boolean }>();
  for (const a of input.lines) {
    if (a && typeof a.lineId === "string" && !out.has(a.lineId)) out.set(a.lineId, { approve: a.verdict === "approve", piTrust: a.piTrust === true });
  }
  return out;
}

/** Request-shape checks that need no filesystem: arrays, known goals, 32-line cap, non-empty. */
function parseCreateShape(
  input: CreateInput,
): { ok: true; rawLines: unknown[]; remote: ProvisionRemoteTarget[] } | { ok: false; failure: ProvisionFailure } {
  const bad = (error: ProvisionErrorCode): { ok: false; failure: ProvisionFailure } => ({ ok: false, failure: { ok: false, status: 400, error } });
  const rawRemote = input.remote ?? [];
  if (!Array.isArray(input.lines) || !Array.isArray(rawRemote)) return bad("invalid-request");
  if (rawRemote.some((g) => !REMOTE_TARGETS.includes(g as ProvisionRemoteTarget))) return bad("invalid-request");
  const remote = [...new Set(rawRemote as ProvisionRemoteTarget[])];
  if (input.lines.length > PROVISION_MAX_LINES) return bad("too-many-lines");
  if (input.lines.length === 0 && remote.length === 0) return bad("empty");
  return { ok: true, rawLines: input.lines, remote };
}

// ── registry ─────────────────────────────────────────────────────────────────

interface Request {
  id: string;
  status: ProvisionStatus;
  projectRoot: string;
  lines: ProvisionLineView[];
  remote: { target: ProvisionRemoteTarget; outcome?: "handed-off" }[];
  createdAt: number;
  expiresAt: number;
  endedAt?: number;
}

const REMOTE_TARGETS: readonly ProvisionRemoteTarget[] = ["lan", "internet", "device"];

interface RootState {
  lastCreatedAt: number;
  cooldownUntil: number;
}

export class ProvisioningRegistry {
  private readonly deps: ProvisioningDeps;
  private readonly fsr: ProvisioningFs;
  private readonly env: ForbiddenSubjectsEnv;
  private readonly pending = new Map<string, Request>();
  private readonly ended = new Map<string, Request>();
  private readonly roots = new Map<string, RootState>();
  private globalCreations: number[] = [];
  private readonly counters = { created: 0, approved: 0, rejected: 0, dismissed: 0, expired: 0, refused: 0, droppedResponses: 0 };

  constructor(deps: ProvisioningDeps) {
    this.deps = deps;
    this.fsr = deps.fs ?? defaultProvisioningFs;
    this.env = deps.env ?? {};
  }

  // ── reads ──────────────────────────────────────────────────────────────────

  /** Pending requests, oldest first (Access page; the dialog reconcile on reconnect). */
  list(): ProvisionRequestView[] {
    this.expire();
    return [...this.pending.values()].map(view);
  }

  /** A pending or recently ended request; `undefined` after a restart or once aged out. */
  get(id: string): ProvisionRequestView | undefined {
    this.expire();
    const r = this.pending.get(id) ?? this.ended.get(id);
    return r ? view(r) : undefined;
  }

  stats(): ProvisionStats {
    this.expire();
    return { pending: this.pending.size, ...this.counters };
  }

  /** A `provision_response` the wiring dropped (no live capability on that socket). */
  recordDroppedResponse(): void {
    this.counters.droppedResponses += 1;
    this.log("[access-provision] response-dropped reason=no-capability");
  }

  // ── D7 ladder ──────────────────────────────────────────────────────────────

  /** First failing rung, or `null`. Evaluated live at create AND settle. */
  checkEligibility(): ProvisionFailure | null {
    const l = this.deps.ladder;
    if (l.killSwitch()) return { ok: false, status: 503, error: "disabled" };
    if (!l.promptEnabled()) return { ok: false, status: 409, error: "prompting-disabled" };
    if (l.hostGateMode() === "report") return { ok: false, status: 409, error: "report-mode" };
    if (l.operatorCount() === 0) return { ok: false, status: 409, error: "no-operator" };
    return null;
  }

  // ── create (D4, D6, D7, D8) ────────────────────────────────────────────────

  create(input: CreateInput): { ok: true; request: ProvisionRequestView } | ProvisionFailure {
    const now = this.deps.now();
    this.expire();
    const refuse = (f: ProvisionFailure): ProvisionFailure => {
      this.counters.refused += 1;
      const project = typeof input.projectRoot === "string" ? capText(input.projectRoot, PROVISION_PATH_MAX) : "";
      this.log(`[access-provision] refused id=- project=${JSON.stringify(project)} lines=${Array.isArray(input.lines) ? input.lines.length : 0} reason=${f.error}`);
      return f;
    };

    const ineligible = this.checkEligibility();
    if (ineligible) return refuse(ineligible);

    const shape = parseCreateShape(input);
    if (!shape.ok) return refuse(shape.failure);

    const root = validateProjectRoot(input.projectRoot, { fs: this.fsr, env: this.env });
    if (!root.ok) return refuse({ ok: false, status: 400, error: "invalid-root", reason: root.reason });

    const bound = this.checkBounds(root.real, now);
    if (bound) return refuse(bound);
    const { rawLines, remote } = shape;
    const rs = this.roots.get(root.real);

    const request: Request = {
      id: (this.deps.newId ?? randomUUID)(),
      status: "pending",
      projectRoot: root.real,
      lines: this.classifyLines(rawLines, root.real),
      remote: remote.map((target) => ({ target })),
      createdAt: now,
      expiresAt: now + PROVISION_TTL_MS,
    };
    this.pending.set(request.id, request);
    this.globalCreations.push(now);
    this.roots.set(root.real, { lastCreatedAt: now, cooldownUntil: rs?.cooldownUntil ?? 0 });
    this.counters.created += 1;
    this.logTransition("created", request);
    for (const l of request.lines) {
      this.log(`[access-provision] line id=${request.id} lineId=${l.lineId} class=${l.classification} path=${JSON.stringify(l.path)} why=${JSON.stringify(l.why)}`);
    }
    return { ok: true, request: view(request) };
  }

  /** D6 bounds in order: duplicate root, pending total, cooldown, per-root rate, global rate. */
  private checkBounds(root: string, now: number): ProvisionFailure | null {
    const existing = [...this.pending.values()].find((r) => r.projectRoot === root);
    if (existing) return { ok: false, status: 409, error: "pending-exists", requestId: existing.id };
    if (this.pending.size >= PROVISION_MAX_PENDING) return { ok: false, status: 429, error: "capacity" };
    this.pruneRates(now);
    const rs = this.roots.get(root);
    if (rs && now < rs.cooldownUntil) return { ok: false, status: 429, error: "cooldown", retryAfterMs: rs.cooldownUntil - now };
    if (rs && now - rs.lastCreatedAt < PROVISION_ROOT_RATE_MS) {
      return { ok: false, status: 429, error: "rate-limited", retryAfterMs: PROVISION_ROOT_RATE_MS - (now - rs.lastCreatedAt) };
    }
    if (this.globalCreations.length >= (this.deps.limits?.globalRateMax ?? PROVISION_GLOBAL_RATE_MAX)) {
      return { ok: false, status: 429, error: "rate-limited", retryAfterMs: this.globalCreations[0] + PROVISION_GLOBAL_RATE_WINDOW_MS - now };
    }
    return null;
  }

  /** D4: expand, resolve to the real path, classify (first match wins), collapse equal real paths. */
  private classifyLines(rawLines: unknown[], projectRoot: string): ProvisionLineView[] {
    const out: ProvisionLineView[] = [];
    const seen = new Set<string>();
    for (const raw of rawLines) {
      const one = this.classifyOne(raw, projectRoot);
      if (one.classification !== "invalid") {
        if (seen.has(one.path)) continue;
        seen.add(one.path);
      }
      out.push({ lineId: `l${out.length + 1}`, ...one });
    }
    return out;
  }

  private classifyOne(raw: unknown, projectRoot: string): Omit<ProvisionLineView, "lineId"> {
    const home = this.env.homedir ?? os.homedir();
    const rec = raw && typeof raw === "object" ? (raw as { path?: unknown; why?: unknown }) : {};
    const why = sanitizeWhy(rec.why);
    const abs = expandLine(rec.path, projectRoot, home);
    if (abs === null) {
      return { path: typeof rec.path === "string" ? capText(rec.path, PROVISION_WHY_MAX) : "", why, classification: "invalid" };
    }
    const facts = this.fsr.inspect(abs);
    const classification = this.classify(facts, projectRoot, home, this.env.platform ?? process.platform);
    return { path: facts.real, why, classification, ...(classification === "grantable" && facts.hasMarker ? { projectRoot: true } : {}) };
  }

  /** D4 steps 2-7 over already-gathered facts (shared by create and the async settle phase). */
  private classify(facts: PathFacts, projectRoot: string, home: string, platform: NodeJS.Platform): ProvisionLineClassification {
    if (!facts.isDirectory) return "missing";
    const real = facts.real;
    if (isUngrantableSubject(real, this.env)) return "forbidden";
    if (credentialFolders(home, platform).some((c) => isSubjectWithin(real, c) || isSubjectWithin(c, real))) return "sensitive";
    if (isSubjectWithin(real, projectRoot)) return "in-root";
    if (this.deps.grants.list().some((g) => g.scope === "project" && isSubjectWithin(real, g.subject))) return "covered";
    return "grantable";
  }

  // ── terminal transitions other than settle ─────────────────────────────────

  /** Operator-side dismissal (Access page "Dismiss all pending" calls this per request). */
  dismiss(id: string): { ok: true; request: ProvisionRequestView } | ProvisionFailure {
    this.expire();
    const r = this.pending.get(id);
    if (!r) return this.ended.has(id) ? { ok: false, status: 409, error: "already-settled" } : { ok: false, status: 404, error: "not-found" };
    for (const l of r.lines) l.outcome = "rejected";
    this.counters.dismissed += 1;
    this.finish(r, "dismissed", 0);
    return { ok: true, request: view(r) };
  }

  /** Dismiss every pending request; each starts its root's cooldown. Returns how many. */
  dismissAll(): number {
    this.expire();
    const ids = [...this.pending.keys()];
    for (const id of ids) this.dismiss(id);
    return ids.length;
  }

  /** Expire every pending request past its TTL (`now >= expiresAt`); returns them. */
  expire(): ProvisionRequestView[] {
    const now = this.deps.now();
    const out: ProvisionRequestView[] = [];
    for (const r of [...this.pending.values()]) {
      if (now < r.expiresAt) continue;
      for (const l of r.lines) l.outcome = "rejected";
      this.counters.expired += 1;
      this.finish(r, "expired", 0, r.expiresAt);
      out.push(view(r));
    }
    return out;
  }

  // ── settle (design D5) ─────────────────────────────────────────────────────

  /**
   * Apply the operator's per-line answer. The caller has ALREADY proven the
   * answer came from a live capability (D3). Order: ladder re-check (refuse,
   * stay pending) → async re-resolve phase (root + every approved line) → ONE
   * synchronous section: realpath compare, net-new capacity check, writes. A
   * request that went terminal during the async phase wins (first-wins).
   */
  async settle(requestId: string, input: SettleInput): Promise<{ ok: true; request: ProvisionRequestView } | ProvisionFailure> {
    this.expire();
    const r0 = this.pending.get(requestId);
    if (!r0) return this.ended.has(requestId) ? { ok: false, status: 409, error: "already-settled" } : { ok: false, status: 404, error: "not-found" };
    if (!input || !Array.isArray(input.lines)) return { ok: false, status: 400, error: "invalid-response" };

    const ineligible = this.checkEligibility();
    if (ineligible) {
      this.log(`[access-provision] refused id=${r0.id} project=${JSON.stringify(r0.projectRoot)} lines=${r0.lines.length} reason=${ineligible.error}`);
      return ineligible;
    }

    const verdicts = parseVerdicts(input);
    const approved = r0.lines.filter((l) => verdicts.get(l.lineId)?.approve);
    const resolved = await this.reresolve(r0, approved);

    // ── synchronous section: no `await` below this line ──
    const r = this.pending.get(requestId);
    if (!r) return { ok: false, status: 409, error: "already-settled" };
    if (this.deps.now() >= r.expiresAt) {
      this.expire();
      return { ok: false, status: 409, error: "already-settled" };
    }
    const stillIneligible = this.checkEligibility();
    if (stillIneligible) return stillIneligible;

    const eligible = this.decideLines(r, verdicts, resolved);
    this.writeEligible(r, eligible);
    this.applyPiTrust(r, verdicts);
    for (const g of r.remote) g.outcome = "handed-off";
    this.countLines(r);
    this.finish(r, "settled", approved.length);
    return { ok: true, request: view(r) };
  }

  private countLines(r: Request): void {
    for (const l of r.lines) {
      if (l.outcome === "granted") this.counters.approved += 1;
      else if (l.outcome === "rejected" && l.classification === "grantable") this.counters.rejected += 1;
    }
  }

  /** Async phase: re-validate the root and re-resolve each approved grantable line (cheap pre-filter). */
  private async reresolve(r: Request, approved: ProvisionLineView[]): Promise<{ rootOk: boolean; stale: Set<string> }> {
    const home = this.env.homedir ?? os.homedir();
    const platform = this.env.platform ?? process.platform;
    const check = checkRootFacts(r.projectRoot, await this.fsr.inspectAsync(r.projectRoot), this.env);
    const rootOk = check.ok && check.real === r.projectRoot;
    const stale = new Set<string>();
    if (!rootOk) return { rootOk, stale };
    for (const l of approved) {
      if (l.classification !== "grantable") continue;
      const facts = await this.fsr.inspectAsync(l.path);
      // `covered` stays acceptable: an exact grant made meanwhile is idempotent, an ancestor grant adds nothing wider.
      const now = this.classify(facts, r.projectRoot, home, platform);
      if (facts.real !== l.path || (now !== "grantable" && now !== "covered")) stale.add(l.lineId);
    }
    return { rootOk, stale };
  }

  /** Sync phase 1: set the outcome of every line that will NOT be written; return those that will. */
  private decideLines(
    r: Request,
    verdicts: ReadonlyMap<string, { approve: boolean }>,
    resolved: { rootOk: boolean; stale: ReadonlySet<string> },
  ): ProvisionLineView[] {
    const eligible: ProvisionLineView[] = [];
    for (const l of r.lines) {
      const end = (outcome: ProvisionLineOutcome, reason?: string) => {
        l.outcome = outcome;
        if (reason) l.reason = reason;
      };
      if (!verdicts.get(l.lineId)?.approve) end("rejected");
      else if (l.classification !== "grantable") end("refused", "not-grantable");
      else if (!resolved.rootOk) end("refused", "root-changed");
      else if (resolved.stale.has(l.lineId) || this.fsr.realpathStrict(l.path) !== l.path) end("changed", "path-changed");
      else eligible.push(l);
    }
    return eligible;
  }

  /** Sync phase 2: net-new capacity check (refuse ALL, never evict), then one write per line. */
  private writeEligible(r: Request, eligible: ProvisionLineView[]): void {
    const persisted = new Set(this.deps.grants.list().filter((g) => g.scope === "project").map((g) => g.subject));
    const netNew = eligible.filter((l) => !persisted.has(l.path)).length;
    if (persisted.size + netNew > this.deps.grants.cap) {
      for (const l of eligible) {
        l.outcome = "refused";
        l.reason = "capacity";
      }
      return;
    }
    for (const l of eligible) this.writeLine(l, r.projectRoot, persisted);
  }

  /** pi-trust choice: only for lines that ended `granted`, explicit, project-root lines (D9). */
  private applyPiTrust(r: Request, verdicts: ReadonlyMap<string, { piTrust: boolean }>): void {
    for (const l of r.lines) {
      if (l.outcome !== "granted" || !l.projectRoot) continue;
      try {
        this.deps.mirror()?.setChoice("accessGrants", l.path, verdicts.get(l.lineId)?.piTrust === true);
      } catch (err) {
        this.log(`[access-provision] pi-trust-choice-failed id=${r.id} path=${JSON.stringify(l.path)} error=${JSON.stringify(String((err as Error)?.message ?? err))}`);
      }
    }
  }

  /** One approved line → one grant write; a failure ends THAT line only. */
  private writeLine(l: ProvisionLineView, origin: string, persisted: ReadonlySet<string>): void {
    let res: RecordGrantResult;
    try {
      res = this.deps.grants.record({ subject: l.path, scope: "project", via: "provision", origin, evict: false });
    } catch (err) {
      res = { ok: false, error: String((err as Error)?.message ?? err) };
    }
    if (!res.ok) {
      l.outcome = res.error === "capacity" ? "refused" : "failed";
      l.reason = res.error === "capacity" ? "capacity" : "write-failed";
      return;
    }
    if (res.grant.subject !== l.path) {
      // Lost the race inside the store's own realpath: undo what we just added.
      if (!persisted.has(res.grant.subject)) this.deps.grants.revoke(res.grant.subject, "project");
      l.outcome = "changed";
      l.reason = "path-changed";
      return;
    }
    l.outcome = "granted";
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** First-wins terminal transition: move to `ended`, start the cooldown, log, notify. */
  private finish(r: Request, status: Exclude<ProvisionStatus, "pending">, approvedVerdicts: number, endedAt = this.deps.now()): void {
    r.status = status;
    r.endedAt = endedAt;
    this.pending.delete(r.id);
    this.ended.set(r.id, r);
    while (this.ended.size > PROVISION_ENDED_KEEP) {
      const oldest = this.ended.keys().next().value;
      if (oldest === undefined) break;
      this.ended.delete(oldest);
    }
    const rs = this.roots.get(r.projectRoot);
    if (approvedVerdicts === 0 && rs) rs.cooldownUntil = r.endedAt + PROVISION_COOLDOWN_MS;
    this.logTransition(status, r, status === "settled" ? { approved: approvedVerdicts } : {});
    try {
      this.deps.onTerminal?.(r.id, status);
    } catch (err) {
      this.log(`[access-provision] onTerminal-failed id=${r.id} error=${JSON.stringify(String((err as Error)?.message ?? err))}`);
    }
  }

  /** Drop rate state that can no longer refuse anything (bounds memory). */
  private pruneRates(now: number): void {
    this.globalCreations = this.globalCreations.filter((t) => now - t < PROVISION_GLOBAL_RATE_WINDOW_MS);
    for (const [root, s] of this.roots) {
      const active = [...this.pending.values()].some((r) => r.projectRoot === root);
      if (!active && now - s.lastCreatedAt >= PROVISION_ROOT_RATE_MS && now >= s.cooldownUntil) this.roots.delete(root);
    }
  }

  private logTransition(kind: string, r: Request, extra: { approved?: number } = {}): void {
    const granted = r.lines.filter((l) => l.outcome === "granted").length;
    this.log(
      `[access-provision] ${kind} id=${r.id} project=${JSON.stringify(r.projectRoot)} lines=${r.lines.length}` +
        (extra.approved !== undefined ? ` approved=${extra.approved} granted=${granted}` : ""),
    );
  }

  private log(line: string): void {
    (this.deps.log ?? ((l: string) => console.log(l)))(line);
  }
}

// ── view / wire helpers ──────────────────────────────────────────────────────

/** D4.1: absolute, `~`-rooted (`~`, `~/…`) or relative to the project root; else `null` (`invalid`). */
function expandLine(raw: unknown, projectRoot: string, home: string): string | null {
  if (typeof raw !== "string" || raw === "" || raw.length > PROVISION_PATH_MAX || raw.includes("\0")) return null;
  if (raw === "~") return home;
  if (raw.startsWith("~/") || raw.startsWith(`~${path.sep}`)) return path.join(home, raw.slice(2));
  if (raw.startsWith("~")) return null;
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(projectRoot, raw);
}

function view(r: Request): ProvisionRequestView {
  const v: ProvisionRequestView = {
    requestId: r.id,
    status: r.status,
    projectRoot: r.projectRoot,
    lines: r.lines.map((l) => ({ ...l })),
    remote: r.remote.map((g) => ({ ...g })),
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
  if (r.endedAt !== undefined) v.endedAt = r.endedAt;
  return v;
}

/** The `provision_request` WS frame for a pending request (outcome fields dropped). */
export function toProvisionRequestMessage(v: ProvisionRequestView, now: number): ProvisionRequestMessage {
  return {
    type: "provision_request",
    requestId: v.requestId,
    projectRoot: v.projectRoot,
    lines: v.lines.map(({ lineId, path: p, why, classification, projectRoot }) => ({
      lineId,
      path: p,
      why,
      classification,
      ...(projectRoot ? { projectRoot } : {}),
    })),
    remote: v.remote.map((g) => g.target),
    expiresAt: v.expiresAt,
    ttlMs: Math.max(0, v.expiresAt - now),
  };
}
