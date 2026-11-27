// GENERIC step gate (framework-free): the pause / hidden / step-forward / step-back state
// machine of one scripted pane. Indices count COMPLETED steps `k` (0..N). The runner calls
// `wait(k)` before step k+1 and `wait(N)` at the end of a loop; a held wait resolves when a
// step is released and rejects with `Rewind(to)` when the reviewer steps back.
// States: playing | held(k) | running(k, q) | rewinding | stopped.
// See change: mock-player-step-controls (design D2).

/** Thrown into the runner by a step back: remount, replay `to` steps silently, hold. */
export class Rewind extends Error {
  constructor(readonly to: number) {
    super(`rewind to step ${to}`);
    this.name = "Rewind";
  }
}

export type GateState =
  | { kind: "playing" }
  | { kind: "held"; k: number }
  | { kind: "running"; k: number; q: number }
  | { kind: "rewinding" }
  | { kind: "stopped" };

/** What the shell sees (`mkGate`): running and rewinding are both `busy`. */
export type GateView = "playing" | "held" | "busy" | "stopped";

export interface StepGate {
  readonly state: GateState;
  readonly view: GateView;
  /** Before step k+1 (or at the loop end, k = N). `hold` = rest even when playing (finished one-shot). */
  wait(k: number, hold?: boolean): Promise<void>;
  /** Reviewer input (`mkStep`). */
  step(dir: 1 | -1): void;
  setPaused(on: boolean): void;
  setHidden(on: boolean): void;
  /** After a failed loop: every input is dropped. */
  stop(): void;
}

export interface StepGateOptions {
  /** Script length N. */
  steps: number;
  /** Forward at N starts the next loop (else a no-op). */
  loop: boolean;
  /** Entered `held(k)`. */
  onHeld?: (k: number) => void;
  onChange?: (view: GateView) => void;
}

const viewOf = (s: GateState): GateView =>
  s.kind === "running" || s.kind === "rewinding" ? "busy" : s.kind;

export function createStepGate(o: StepGateOptions): StepGate {
  let paused = false;
  let hidden = false;
  let st: GateState = { kind: "playing" };
  let view: GateView = "playing";
  let pending: { resolve: () => void; reject: (e: Rewind) => void } | null = null;
  /** Holding a finished one-shot: unpause does not release it. */
  let forced = false;
  /** A step released (or queued) while hidden: runs once visible. */
  let credit = false;
  /** Back pressed while a step ran: rewind when it ends. */
  let back = false;
  let lastK = 0;

  const set = (s: GateState) => {
    st = s;
    const v = viewOf(s);
    if (v !== view) { view = v; o.onChange?.(v); }
  };
  const take = () => { const p = pending; pending = null; credit = false; return p; };
  /** Release the held step k+1 (or the next loop at k = N). */
  const go = (k: number) => { const p = take(); set({ kind: "running", k, q: 0 }); p?.resolve(); };
  const play = () => { const p = take(); set({ kind: "playing" }); p?.resolve(); };
  /** Forward while held(k): one step (at N: next loop when looping), or a credit while hidden. */
  const forward = (k: number) => {
    if (credit || (k >= o.steps && (!o.loop || forced))) return;
    if (hidden) credit = true;
    else go(k);
  };
  /** Back while held(k): rewind to the step before. */
  const backward = (k: number) => {
    const p = take();
    set({ kind: "rewinding" });
    p?.reject(new Rewind(Math.max(0, k - 1)));
  };

  return {
    get state() { return st; },
    get view() { return view; },
    wait(k, hold = false) {
      lastK = k;
      forced = hold;
      if (st.kind === "stopped") return Promise.resolve();
      if (st.kind === "running" && back) {
        back = false;
        set({ kind: "rewinding" });
        return Promise.reject(new Rewind(Math.max(0, k - 1)));
      }
      const queued = st.kind === "running" && st.q > 0 && (k < o.steps || o.loop) && !forced;
      if (!forced && !paused && !hidden) { set({ kind: "playing" }); return Promise.resolve(); }
      if (queued && !hidden) { set({ kind: "running", k, q: 0 }); return Promise.resolve(); }
      return new Promise<void>((resolve, reject) => {
        pending = { resolve, reject };
        credit = queued;
        set({ kind: "held", k });
        o.onHeld?.(k);
      });
    },
    step(dir) {
      if (st.kind === "held") (dir === 1 ? forward : backward)(st.k);
      else if (st.kind === "running") {
        if (dir === 1) set({ ...st, q: 1 });
        else { back = true; set({ ...st, q: 0 }); }
      }
    },
    setPaused(on) {
      paused = on;
      if (on) {
        if (st.kind === "playing") set({ kind: "running", k: lastK, q: 0 });
        return;
      }
      back = false;
      if (st.kind === "running") set({ kind: "playing" });
      else if (st.kind === "held") {
        credit = false;
        if (!hidden && !forced) play();
      }
    },
    setHidden(on) {
      hidden = on;
      if (on || st.kind !== "held") return;
      if (credit) go(st.k);
      else if (!paused && !forced) play();
    },
    stop() { pending = null; back = false; credit = false; set({ kind: "stopped" }); },
  };
}
