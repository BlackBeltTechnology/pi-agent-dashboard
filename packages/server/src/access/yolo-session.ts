/**
 * YOLO: an automatic `allow-once` at the prompt point, and nowhere else
 * (design D13; tasks 8b.2-8b.6a, 8b.8; spec `access-grant-yolo`).
 *
 * YOLO answers only what could have been ASKED. `decide` runs where a dialog
 * would be raised, after eligibility and containment, and requires exactly the
 * proof the prompt would have required: a held, YOLO-eligible plane, Host
 * admission in `enforce`, and a request carrying a live prompt capability. It then
 * requires the subject's REAL path to lie inside a root (or an unscoped session),
 * refuses a forbidden subject, and never reverses an explicit prior deny. It
 * persists nothing: the verdict answers the in-flight request only (8b.3a,
 * reconciled with the spec: an automatic verdict never outlives its request).
 *
 * Session rules, each a test:
 *   - an operator session lasts 15, 30 or 60 minutes, fixed at activation and
 *     never renewed by activity; ending it takes effect on the next denial;
 *   - scope defaults to the session's working directory, subject to the
 *     forbidden rule, falling back to the narrowest legal rung; unscoped only
 *     when explicitly chosen;
 *   - roots come only from the offered ladder (no free text); adding one to a
 *     live session never extends the timer and never makes it unscoped;
 *   - activating while a session is live ADDS to it, never starts a second;
 *   - the environment session lasts the process lifetime and is refused
 *     outright if ANY root is unusable (no subset, no unscoped fallback);
 *   - in `report` mode no session becomes active and nothing is auto-allowed.
 *
 * See change: add-access-grant-dialog.
 */
import * as fs from "node:fs";
import type { AccessPlaneId } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { AccessPlane } from "./access-plane.js";
import { offeredAncestorLadder } from "./ancestor-ladder.js";
import { isSubjectWithin } from "./canonical-subject.js";
import { isUngrantableSubject } from "./forbidden-subjects.js";
import type { HostGateMode } from "./prompt-channel.js";
import { parseYoloEnv } from "./yolo-env.js";

/** The only durations an operator may choose (resolved, clarification C3). */
export const YOLO_DURATIONS_MS: readonly number[] = [15, 30, 60].map((m) => m * 60_000);
/** How many auto-answers the Access surface keeps (a bounded, in-memory log). */
export const YOLO_LOG_CAPACITY = 200;

export interface YoloRoot {
  path: string;
  addedAt: number;
}

export interface YoloSession {
  source: "operator" | "env";
  activatedAt: number;
  /** `null` = the environment session: lasts the process lifetime. */
  expiresAt: number | null;
  unscoped: boolean;
  roots: YoloRoot[];
}

/** One automatic answer, as the Access surface lists it (task 8b.8). */
export interface YoloLogEntry {
  plane: AccessPlaneId;
  subject: string;
  at: number;
  outcome: "auto-allowed" | "refused-by-prior-refusal";
}

export type YoloResult = { ok: true; session: YoloSession; added?: boolean } | { ok: false; reason: string };

export interface YoloDeps {
  now?(): number;
  hostGateMode(): HostGateMode;
  isRefused(plane: AccessPlaneId, subject: string): boolean;
  /** Ancestor rungs of a base directory (defaults to the shipped ladder). */
  ladder?(base: string): Promise<string[]>;
  onLog?(line: string): void;
}

function realpathOrNull(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

export class YoloController {
  private session: YoloSession | null = null;
  private readonly log: YoloLogEntry[] = [];
  private readonly now: () => number;
  private readonly ladder: (base: string) => Promise<string[]>;
  private readonly emit: (line: string) => void;

  constructor(private readonly deps: YoloDeps) {
    this.now = deps.now ?? Date.now;
    this.ladder = deps.ladder ?? ((base) => offeredAncestorLadder(base));
    this.emit = deps.onLog ?? ((line) => console.error(line));
  }

  /** The live session, or `null`. An expired session is cleared here. */
  status(): YoloSession | null {
    const s = this.session;
    if (s && s.expiresAt !== null && this.now() >= s.expiresAt) this.session = null;
    return this.session;
  }

  /** Auto-answers, newest last; they survive the session ending (8b.8). */
  history(): YoloLogEntry[] {
    return [...this.log];
  }

  /**
   * Roots that may be offered for a base directory: the base itself, then its
   * ancestor ladder, each as a real path, minus anything the forbidden rule
   * refuses. Narrowest first, so the first entry is the default (8b.2b, 8b.4b).
   */
  async offerRoots(base: string): Promise<string[]> {
    const real = realpathOrNull(base);
    if (!real) return [];
    let rungs: string[] = [];
    try {
      rungs = await this.ladder(real);
    } catch {
      rungs = [];
    }
    return [real, ...rungs].filter((p) => !isUngrantableSubject(p));
  }

  /**
   * Operator activation (task 8b.6). While a session is live this ADDS the
   * chosen root to it instead of starting a second one (8b.7b).
   */
  async activate(req: { durationMs: number; base: string; root?: string; unscoped?: boolean }): Promise<YoloResult> {
    if (this.deps.hostGateMode() !== "enforce") return { ok: false, reason: "report-mode" };
    const live = this.status();
    if (live) {
      if (req.unscoped) {
        return live.unscoped ? { ok: true, session: live } : { ok: false, reason: "cannot-widen-to-unscoped" };
      }
      return this.addRoot({ base: req.base, root: req.root });
    }
    if (!YOLO_DURATIONS_MS.includes(req.durationMs)) return { ok: false, reason: "invalid-duration" };

    const now = this.now();
    if (req.unscoped) {
      this.session = { source: "operator", activatedAt: now, expiresAt: now + req.durationMs, unscoped: true, roots: [] };
      return { ok: true, session: this.session };
    }
    const root = await this.pickRoot(req.base, req.root);
    if (!root.ok) return root;
    this.session = {
      source: "operator",
      activatedAt: now,
      expiresAt: now + req.durationMs,
      unscoped: false,
      roots: [{ path: root.path, addedAt: now }],
    };
    return { ok: true, session: this.session };
  }

  /** Add a root to the live session (8b.2d): from the ladder, timer unchanged. */
  async addRoot(req: { base: string; root?: string }): Promise<YoloResult> {
    const live = this.status();
    if (!live) return { ok: false, reason: "no-session" };
    if (live.unscoped) return { ok: true, session: live };
    const root = await this.pickRoot(req.base, req.root);
    if (!root.ok) return root;
    if (!live.roots.some((r) => r.path === root.path)) live.roots.push({ path: root.path, addedAt: this.now() });
    return { ok: true, session: live, added: true };
  }

  /** End the session now; the next denial behaves as if it never existed. */
  end(): void {
    this.session = null;
  }

  /**
   * Environment activation (tasks 2b.8, 8b.6, 8b.6a). Refused outright when
   * Host admission is not enforced, when the value is unparseable, or when ANY
   * root does not resolve or is forbidden: never a subset, never unscoped.
   */
  activateFromEnv(raw: string | undefined): YoloResult | { ok: false; reason: "unset" } {
    const parsed = parseYoloEnv(raw);
    if (parsed.kind === "unset") return { ok: false, reason: "unset" };
    if (this.deps.hostGateMode() !== "enforce") return { ok: false, reason: "report-mode" };
    if (parsed.kind === "invalid") return { ok: false, reason: `invalid: ${parsed.reason}` };
    const now = this.now();
    if (parsed.kind === "unscoped") {
      this.session = { source: "env", activatedAt: now, expiresAt: null, unscoped: true, roots: [] };
      return { ok: true, session: this.session };
    }
    const roots: YoloRoot[] = [];
    for (const raw of parsed.roots) {
      const real = realpathOrNull(raw);
      if (!real) return { ok: false, reason: `unresolvable root: ${raw}` };
      if (isUngrantableSubject(real)) return { ok: false, reason: `forbidden root: ${raw}` };
      if (!roots.some((r) => r.path === real)) roots.push({ path: real, addedAt: now });
    }
    this.session = { source: "env", activatedAt: now, expiresAt: null, unscoped: false, roots };
    return { ok: true, session: this.session };
  }

  /**
   * At the prompt point: `auto-allow`, `refused-by-prior-refusal`, or `null`
   * (YOLO does not apply; the ordinary ladder continues).
   */
  decide(input: {
    plane: AccessPlane;
    subject: string;
    requestHoldsCapability: boolean;
    hostGateMode: HostGateMode;
  }): "auto-allow" | "refused-by-prior-refusal" | null {
    const session = this.status();
    if (!session) return null;
    if (input.hostGateMode !== "enforce") return null;
    // Structural: only a held plane that declares eligibility (8b.1, 8b.5).
    if (input.plane.mode !== "held" || !input.plane.yoloEligible) return null;
    // The proof the prompt would have required (8b.4).
    if (!input.requestHoldsCapability) return null;
    const real = realpathOrNull(input.subject);
    if (!real || isUngrantableSubject(real)) return null;
    const inScope = session.unscoped || session.roots.some((r) => isSubjectWithin(real, r.path));
    if (!inScope) return null;
    const outcome = this.deps.isRefused(input.plane.id, input.subject) ? "refused-by-prior-refusal" : "auto-allowed";
    this.record(input.plane.id, input.subject, outcome);
    return outcome === "auto-allowed" ? "auto-allow" : "refused-by-prior-refusal";
  }

  // ---------------------------------------------------------------------------

  /** A chosen root must be an OFFERED rung; no choice means the narrowest one. */
  private async pickRoot(base: string, chosen?: string): Promise<{ ok: true; path: string } | { ok: false; reason: string }> {
    const offered = await this.offerRoots(base);
    if (chosen === undefined) {
      const first = offered[0];
      return first ? { ok: true, path: first } : { ok: false, reason: "no-legal-root" };
    }
    const real = realpathOrNull(chosen);
    if (!real) return { ok: false, reason: "unresolvable-root" };
    if (!offered.includes(real)) return { ok: false, reason: "root-not-offered" };
    return { ok: true, path: real };
  }

  private record(plane: AccessPlaneId, subject: string, outcome: YoloLogEntry["outcome"]): void {
    this.log.push({ plane, subject, at: this.now(), outcome });
    if (this.log.length > YOLO_LOG_CAPACITY) this.log.shift();
    this.emit(
      `[access-grant] yolo:${outcome} plane=${plane} subject=${JSON.stringify(subject)} (no human answered)`,
    );
  }
}
