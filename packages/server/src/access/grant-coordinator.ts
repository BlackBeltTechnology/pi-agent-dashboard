/**
 * Joins a denial to the registry, the planes, and the operator's browsers
 * (design D3, D6, D7, D8; tasks 6.1-6.3).
 *
 * The denial sites call `onDenial` with the live request's facts (D6: eligibility
 * is computed THERE, never re-derived later). The coordinator records the denial,
 * broadcasts a `grant_request` when the registry prompts, and, for a held
 * request, returns a pending `Hold` that settles on the first verdict, on expiry,
 * or on client abort. Every path that is not an explicit allow verdict resolves to
 * `deny`, so the caller returns the denial the guard would have returned today.
 *
 * An allow verdict is NOT an allow. It authorises the caller to RE-RUN its guard
 * (spec: "A resumed request re-runs the guard it was denied by"); the caller owns
 * that re-evaluation, because only the caller knows its guard.
 *
 * See change: add-access-grant-dialog.
 */
import type {
  AccessPlaneId,
  ServerToBrowserMessage,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import {
  type AccessPlane,
  type AccessPlaneRegistry,
  holdsRequest,
  persistVerdict,
  promptPrecondition,
} from "./access-plane.js";
import { type GrantTransition, type PendingGrant, PendingGrantRegistry } from "./pending-grant-registry.js";
import type { HostGateMode } from "./prompt-channel.js";

/** What YOLO needs to decide, all from the live request (design D6). */
export interface YoloDecisionInput {
  plane: AccessPlane;
  subject: string;
  requestHoldsCapability: boolean;
  hostGateMode: HostGateMode;
}

/** What a denial site knows about one denial, from the live request. */
export interface DenialContext {
  plane: AccessPlaneId;
  /** The denied subject as the site saw it; the plane normalises it. */
  rawSubject: string;
  /** Offered ancestor rungs (filesystem ladder), exactly as the denial carried them. */
  ancestors?: readonly string[];
  /** Which session's denial this is, for the grant's audit trail. */
  origin: string;
  /** Requester key: capability socket id (held) or remote source (deferred). */
  channel: string;
  /** Held planes: the request carries a valid prompt capability. */
  requestHoldsCapability: boolean;
}

/** How a denial ends for the request that raised it. */
export type Resolution =
  | { kind: "deny"; reason: string }
  | { kind: "allow"; verdict: "allow-once" | "allow-always"; subject: string };

export interface Hold {
  /** True when the request is suspended awaiting a verdict. */
  held: boolean;
  result: Promise<Resolution>;
  /** Client went away: release this request (resolves `result` as a deny). */
  abort(): void;
}

export interface GrantCoordinatorDeps {
  planes: AccessPlaneRegistry;
  broadcast(msg: ServerToBrowserMessage): void;
  hostGateMode(): HostGateMode;
  promptEnabled(): boolean;
  killSwitch(): boolean;
  /** Live capability-holding operator sockets (deferred planes' audience). */
  operatorChannels(): number;
  onTransition?(t: GrantTransition): void;
  /** YOLO, consulted at the prompt point (design D13). Absent = never auto-answers. */
  yolo?: { decide(input: YoloDecisionInput): "auto-allow" | "refused-by-prior-refusal" | null };
  /** Remember an operator's explicit deny on a YOLO-eligible plane (task 8b.4a). */
  recordRefusal?(plane: AccessPlaneId, subject: string): void;
  now?(): number;
  schedule?(fn: () => void, ms: number): { cancel(): void };
}

const defaultSchedule = (fn: () => void, ms: number): { cancel(): void } => {
  const t = setTimeout(fn, ms);
  t.unref?.();
  return { cancel: () => clearTimeout(t) };
};

/**
 * Most requests that may wait on one entry at once. Coalesced requests beyond
 * this are recorded but not held, so a burst cannot pin unbounded connections.
 */
export const GRANT_MAX_WAITERS_PER_ENTRY = 8;

const immediate = (reason: string): Hold => ({
  held: false,
  result: Promise.resolve({ kind: "deny", reason }),
  abort: () => {},
});

export class GrantCoordinator {
  readonly registry: PendingGrantRegistry;
  /** promptId -> held requests in arrival order; the first one raised the entry. */
  private readonly waiters = new Map<string, Array<(r: Resolution) => void>>();
  private readonly timers = new Map<string, { cancel(): void }>();
  /** promptId -> the session whose denial created the entry (grant audit trail). */
  private readonly origins = new Map<string, string>();
  private readonly now: () => number;
  private readonly schedule: NonNullable<GrantCoordinatorDeps["schedule"]>;

  constructor(private readonly deps: GrantCoordinatorDeps) {
    this.now = deps.now ?? Date.now;
    this.schedule = deps.schedule ?? defaultSchedule;
    this.registry = new PendingGrantRegistry({
      onTransition: deps.onTransition,
      onExpire: (entry) => this.finish(entry, { kind: "deny", reason: "expired" }, "expired"),
    });
  }

  /**
   * Record a denial and, if the precondition and volume controls allow, prompt.
   * `holdable` says the site CAN suspend (it passed its request/reply); whether
   * it DOES is decided here, from the plane's mode and the live precondition.
   */
  onDenial(ctx: DenialContext, holdable: boolean): Hold {
    const plane = this.deps.planes.get(ctx.plane);
    if (!plane) return immediate("unknown-plane");
    const subject = plane.subjectOf(ctx.rawSubject);
    if (subject === null) return immediate("not-promptable");

    // YOLO answers at the exact point a dialog would be raised, with exactly the
    // proof the dialog would have required (it checks plane, mode, capability
    // and scope itself). An auto-allow persists nothing and records no entry; the
    // caller still RE-EVALUATES it like any allow. Prompt suppression (prompting
    // disabled, the kill switch) does not stop it: YOLO is itself the explicit
    // opt-in that removes the interruption (task 8b.6).
    const auto = this.deps.yolo?.decide({
      plane,
      subject,
      requestHoldsCapability: ctx.requestHoldsCapability,
      hostGateMode: this.deps.hostGateMode(),
    });
    if (auto === "auto-allow") {
      return { held: false, result: Promise.resolve({ kind: "allow", verdict: "allow-once", subject }), abort: () => {} };
    }
    if (auto === "refused-by-prior-refusal") return immediate("refused-by-prior-refusal");

    const precondition = promptPrecondition({
      plane,
      hostGateMode: this.deps.hostGateMode(),
      promptEnabled: this.deps.promptEnabled(),
      killSwitch: this.deps.killSwitch(),
      requestHoldsCapability: ctx.requestHoldsCapability,
      operatorChannels: this.deps.operatorChannels(),
    });
    const ancestors = [...(ctx.ancestors ?? [])];
    const out = this.registry.record(
      { plane: plane.id, subject, mode: plane.mode, channel: ctx.channel, store: plane.store, ancestors },
      precondition,
      this.now(),
    );
    if (out.kind === "refused") return immediate(out.reason);

    const entry = out.entry;
    if (!this.origins.has(entry.promptId)) this.origins.set(entry.promptId, ctx.origin);
    this.armExpiry(entry);
    // A prompt that cannot be delivered degrades like any other rung: the
    // denial stands and stays answerable on the Access surface; it is never
    // held, since nobody was actually asked (test-plan #X5).
    if (out.kind === "prompt") {
      const delivered = this.send({
        type: "grant_request",
        promptId: entry.promptId,
        plane: entry.plane,
        subject: entry.subject,
        expiresAt: entry.expiresAt,
        copy: plane.describe(entry.subject, entry.ancestors),
      });
      if (!delivered) return immediate("broadcast-failed");
    }

    // Suspend only a held plane whose precondition passed AND whose entry is
    // actually in front of the operator: holding a request on an unprompted
    // (flooded / degraded) entry would pin a connection nobody is asked about.
    if (!holdable || !holdsRequest(plane, precondition) || !entry.prompted) {
      return immediate(out.kind === "recorded" ? out.reason : "not-held");
    }
    return this.wait(entry.promptId);
  }

  /**
   * A `grant_response` from any operator socket. First well-formed answer wins.
   * The WebSocket answers only an entry that was actually PROMPTED, and only
   * while the host gate is live `enforce`: an entry recorded in report mode (or
   * suppressed by flood control) was never put in front of a dialog, so a socket
   * answering it is not answering a question anyone was asked. Such entries are
   * settled from the Access surface instead (`settle`).
   */
  async onResponse(msg: unknown): Promise<void> {
    const id = (msg as { promptId?: unknown } | null)?.promptId;
    const pending = typeof id === "string" ? this.registry.get(id) : undefined;
    if (pending && (!pending.prompted || this.deps.hostGateMode() !== "enforce")) return;
    await this.settle(msg);
  }

  /** Settle an entry from any authorised surface; never throws, always releases. */
  async settle(msg: unknown): Promise<void> {
    const out = this.registry.settle(msg, this.now());
    if (!out.ok) return;
    const entry = out.entry;
    let resolution: Resolution;
    try {
      resolution = await this.resolve(entry, out.verdict, out.subject);
    } catch (err) {
      // A throwing store or refusal writer must never leave a held request
      // hanging with its socket timeout disabled: fail closed and release.
      console.error(`[access-grant] settle failed: ${String((err as Error)?.message ?? err)}`);
      resolution = { kind: "deny", reason: "settle-failed" };
    }
    this.finish(entry, resolution, "settled");
  }

  private async resolve(
    entry: PendingGrant,
    verdict: "allow-once" | "allow-always" | "deny",
    subject: string,
  ): Promise<Resolution> {
    const plane = this.deps.planes.get(entry.plane);
    if (verdict === "deny" || !plane) {
      // An explicit deny is remembered so a later YOLO session cannot reverse it.
      if (verdict === "deny" && plane?.mode === "held" && plane.yoloEligible) {
        this.deps.recordRefusal?.(plane.id, entry.subject);
      }
      return { kind: "deny", reason: verdict === "deny" ? "denied" : "unknown-plane" };
    }
    const persisted = await persistVerdict(plane, {
        verdict,
        subject,
        deniedSubject: entry.subject,
        ancestors: entry.ancestors,
        origin: this.origins.get(entry.promptId) ?? "unknown",
      });
      // An allow-always whose store write failed did not stick: fail closed
      // rather than admit a request the operator's persistent answer never
      // actually recorded (design D11: the admitted set never widens on failure).
    if (persisted.persisted && !persisted.ok) return { kind: "deny", reason: `persist-failed:${persisted.reason}` };
    // Audit trail for every plane: only the filesystem store records an origin
    // itself, so a pin / trusted network / CORS origin would otherwise not say
    // whose denial it answered.
    if (persisted.persisted) {
      console.error(
        `[access-grant] persisted plane=${plane.id} subject=${JSON.stringify(subject)} store=${plane.store} origin=${JSON.stringify(this.origins.get(entry.promptId) ?? "unknown")}`,
      );
    }
    return { kind: "allow", verdict, subject };
  }

  // ---------------------------------------------------------------------------

  private wait(promptId: string): Hold {
    let resolveFn!: (r: Resolution) => void;
    const result = new Promise<Resolution>((resolve) => {
      resolveFn = resolve;
    });
    const list = this.waiters.get(promptId) ?? [];
    if (list.length >= GRANT_MAX_WAITERS_PER_ENTRY) return immediate("waiters-full");
    list.push(resolveFn);
    this.waiters.set(promptId, list);
    return {
      held: true,
      result,
      abort: () => {
        const current = this.waiters.get(promptId);
        const at = current?.indexOf(resolveFn) ?? -1;
        if (!current || at < 0) return;
        current.splice(at, 1);
        resolveFn({ kind: "deny", reason: "aborted" });
        // The last waiter leaving releases the entry: nothing is left to resume.
        if (current.length === 0) {
          const entry = this.registry.forget(promptId);
          if (entry) this.finish(entry, { kind: "deny", reason: "aborted" }, "expired");
        }
      },
    };
  }

  private armExpiry(entry: PendingGrant): void {
    if (this.timers.has(entry.promptId)) return;
    const delay = Math.max(0, entry.expiresAt - this.now() + 1);
    this.timers.set(
      entry.promptId,
      this.schedule(() => this.registry.expire(this.now()), delay),
    );
  }

  /** Tear down an entry: cancel its timer, dismiss its dialogs, resolve its waiters. */
  private finish(entry: PendingGrant, resolution: Resolution, reason: "settled" | "expired"): void {
    this.timers.get(entry.promptId)?.cancel();
    this.timers.delete(entry.promptId);
    this.origins.delete(entry.promptId);
    // Waiters are resolved FIRST: a dismissal that cannot be delivered must
    // never leave a held request waiting forever.
    const list = this.waiters.get(entry.promptId) ?? [];
    this.waiters.delete(entry.promptId);
    // Allow-once permits ONLY the suspended request that raised the prompt
    // (spec); requests that coalesced onto it are denied, not admitted.
    list.forEach((resolve, i) =>
      resolve(
        i > 0 && resolution.kind === "allow" && resolution.verdict === "allow-once"
          ? { kind: "deny", reason: "allow-once-not-shared" }
          : resolution,
      ),
    );
    if (entry.prompted) {
      this.send({
        type: "grant_dismiss",
        promptId: entry.promptId,
        plane: entry.plane,
        subject: entry.subject,
        reason,
      });
    }
  }

  /** Broadcast, reporting failure instead of throwing into a denial path. */
  private send(msg: ServerToBrowserMessage): boolean {
    try {
      this.deps.broadcast(msg);
      return true;
    } catch (err) {
      console.error(`[access-grant] broadcast failed type=${msg.type}: ${String((err as Error)?.message ?? err)}`);
      return false;
    }
  }
}
