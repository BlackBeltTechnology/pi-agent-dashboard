/**
 * Follow-glide: a short, frame-rate-independent exponential chase of the live
 * bottom (design D6), replacing the instant `scrollTop` snap while the user is
 * following a live session.
 *
 *   scrollTop += Δ · (1 − e^(−dt/τ))   τ = 60 ms, snap at |Δ| < 2 px
 *
 * `Δ` is re-read from the DOM every frame, so there is no native-smooth race
 * with arriving chunks and a growing target simply extends the chase. Settle
 * time ≈ τ·ln(Δ/2): ≈ 140 ms for 20 px, ≈ 360 ms for 800 px.
 *
 * The controller owns NO attribution policy. Each step calls `beforeWrite` (the
 * caller stamps `"pin-bottom"`) and `afterWrite` (the caller records the
 * achieved position as `pinnedSnapshotRef`), so a glide step is an ordinary
 * attributed bottom-pin write under the `chat-scroll-lock` contract: events
 * matching the achieved position keep follow, any foreign scroll falls through.
 * rAF is scheduled only while a chase is in flight — a settled glide costs
 * nothing.
 *
 * See change: add-fluid-chat-motion.
 */

export const GLIDE_TAU_MS = 60;
export const GLIDE_SNAP_PX = 2;
/** Longest frame delta counted, so a throttled/background frame cannot teleport. */
const MAX_DT_MS = 100;

export interface FollowGlideDeps {
  getEl: () => HTMLElement | null;
  /** True when a step must not run (selection held, motion inactive, …): cancels the glide. */
  isBlocked: () => boolean;
  /** Called immediately before each `scrollTop` write (stamp `"pin-bottom"`). */
  beforeWrite: () => void;
  /** Called after each write with the ACHIEVED position (record the snapshot). */
  afterWrite: (achieved: { top: number; height: number }) => void;
  /** Called when the glide starts or stops (drives `data-chat-motion-busy`). */
  onBusyChange?: (busy: boolean) => void;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

export class FollowGlide {
  private raf: number | null = null;
  private last = 0;
  private achievedTop = Number.NaN;

  private readonly deps: FollowGlideDeps;

  constructor(deps: FollowGlideDeps) {
    this.deps = deps;
  }

  isActive(): boolean {
    return this.raf !== null;
  }

  /**
   * True while chasing and `top` is where the last step left the view (±1 px).
   * Position-only on purpose: content that shrinks or re-measures between the
   * write and its scroll event changes the extent but not where WE put the view,
   * and a foreign scroll (drag, keyboard, find-in-page) always moves it off this.
   */
  matches(top: number): boolean {
    return this.raf !== null && Math.abs(top - this.achievedTop) <= 1;
  }

  /** Remaining distance to the live bottom (0 when the element is gone). */
  remaining(): number {
    const el = this.deps.getEl();
    return el ? el.scrollHeight - el.clientHeight - el.scrollTop : 0;
  }

  /** Start chasing (or keep chasing: the target is re-read every frame). */
  start(): void {
    if (this.raf !== null) return;
    this.last = now(); // the first step's dt is the real time since start
    this.raf = requestAnimationFrame(this.step);
    this.deps.onBusyChange?.(true);
  }

  cancel(): void {
    if (this.raf === null) return;
    cancelAnimationFrame(this.raf);
    this.raf = null;
    this.deps.onBusyChange?.(false);
  }

  private stop(): void {
    this.raf = null;
    this.deps.onBusyChange?.(false);
  }

  private step = (): void => {
    this.raf = null;
    const el = this.deps.getEl();
    if (!el || this.deps.isBlocked()) return this.stop();
    const t = now();
    const dt = Math.max(1, Math.min(t - this.last, MAX_DT_MS));
    this.last = t;
    const target = el.scrollHeight - el.clientHeight;
    const delta = target - el.scrollTop;
    if (delta <= 0) return this.stop(); // already at/below the bottom (content shrank)
    this.deps.beforeWrite();
    // Land on the bottom in the SAME step that comes within the snap distance, so
    // the settle frame does not depend on the frame rate beyond one frame.
    const next = delta < GLIDE_SNAP_PX ? target : el.scrollTop + delta * (1 - Math.exp(-dt / GLIDE_TAU_MS));
    if (target - next < GLIDE_SNAP_PX) {
      el.scrollTop = target;
      this.deps.afterWrite({ top: el.scrollTop, height: el.scrollHeight });
      return this.stop();
    }
    el.scrollTop = next;
    this.achievedTop = el.scrollTop;
    this.deps.afterWrite({ top: el.scrollTop, height: el.scrollHeight });
    this.raf = requestAnimationFrame(this.step);
  };
}

export type PinPlan =
  /** Begin (or keep) the glide; no write now. */
  | "glide"
  /** Cancel any glide, then today's instant bottom-pin write. */
  | "instant";

export interface PinPlanInput {
  kind: "live" | "measure";
  /**
   * The commit is a live, non-bulk growth in a followed session (motion, same
   * session, ¬replay/loading/splice/ascent/descent). For `measure` it lets the
   * row's own measurement start the glide in that commit.
   */
  glideAllowed: boolean;
  /** `measure` only: every existing `onChange` guard passed (follow, no selection, no splice suppression). */
  guardsPass: boolean;
  glideActive: boolean;
  /** Distance still to travel to the live bottom, px. */
  remaining: number;
  clientHeight: number;
}

/**
 * The single decision behind `pinBottom(kind)` (design D6), pure so the matrix is
 * unit-testable without a DOM.
 *  - `live`: glide only when allowed and the remaining distance ≤ clientHeight
 *    (and there is something to chase, or a glide already runs); else instant.
 *  - `measure`: re-target an in-flight glide (no write) only when the guards pass
 *    AND remaining ≤ clientHeight; otherwise cancel it and write instantly.
 *    With no glide in flight it is today's instant write — except inside a live
 *    growth commit (`glideAllowed`), where it starts the glide.
 */
export function planBottomPin(i: PinPlanInput): PinPlan {
  if (i.kind === "measure") {
    if (!i.guardsPass || i.remaining > i.clientHeight) return "instant";
    if (i.glideActive) return "glide";
    // A row mounting in a LIVE growth commit is measured before the content
    // effect runs; it must start the glide rather than snap past it.
    return i.glideAllowed && i.remaining >= GLIDE_SNAP_PX ? "glide" : "instant";
  }
  if (i.glideAllowed && i.remaining <= i.clientHeight && (i.remaining >= GLIDE_SNAP_PX || i.glideActive)) {
    return "glide";
  }
  return "instant";
}
