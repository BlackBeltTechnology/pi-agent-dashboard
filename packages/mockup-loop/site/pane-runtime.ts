// GENERIC isolated-pane runtime (framework-free): runs inside one `?pane=` document.
// Installs the mock's fixtures and the pane clock BEFORE first render, then (for
// a driven side of a scripted frame) loops the script: remount with a fresh fixture
// instance + clock per loop, hold, repeat. Publishes `window.__mkHealth` and posts
// health / missing-fixture reports to the parent shell.
// An embedded live pane first pre-measures its stage (one silent fast loop, `mkStage`);
// pause / hidden / step controls go through a step gate (`mkStep` in, `mkGate` out).
// Query params: `mkLoops=N` (stop after N loops), `mkFast=1` (no pointer travel).
// See change: add-mock-site-exact-env (design D3, D4, D5), mock-player-step-controls (D2-D4).

import { clockStart, createClock, installClock } from "./clock.ts";
import { type Fixtures, installFixtures } from "./fixtures.ts";
import { originOk, postTarget } from "./frame-env.ts";
import { createOverlay, type Overlay, type RunResult, runSteps, type ScriptStep } from "./script.ts";
import { createStepGate, Rewind, type StepGate } from "./step-gate.ts";

const HOLD_MS = 1800;
const FAST_HOLD_MS = 150;
/** Pre-measure: total budget, per-step settle cap, stable-for window. */
const MEASURE_BUDGET_MS = 15_000;
const SETTLE_CAP_MS = 1000;
const SETTLE_STABLE_MS = 200;

export interface Health { completed: number; failed: number; errors: string[] }

export interface PaneRuntimeOptions {
  spec: string;
  fixtures?: () => Fixtures;
  script?: ScriptStep[];
  /** This pane runs the script (its side is driven). */
  driven: boolean;
  clockAt?: string;
  loop?: boolean;
  /** Reduced-motion step pane: run silently up to this step, then stop. */
  step?: number;
  /** Re-render the pane content (new React key); resolves after commit. */
  remount: () => Promise<void>;
  /** Fixtures + clock are in place: render the content. */
  ready: () => void;
}

const post = (msg: object) => parent.postMessage(msg, postTarget());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LoopContext {
  spec: string;
  /** 1-based loop number (health error prefix). */
  n: number;
  gate: Pick<StepGate, "wait" | "stop">;
  overlay: Overlay | null;
  fast: boolean;
  /** Finished one-shot: rest at the end instead of returning (Back still works). */
  hold: boolean;
  /** A failed loop stops the gate (live view; headless checks keep looping). */
  stopOnFail: boolean;
  /** Fresh fixtures + clock, cleared overlay, remounted content. */
  reset: () => Promise<void>;
  health: Health;
  post: (msg: object) => void;
}

/**
 * One visible loop through the gate. A step back (`Rewind`) remounts, replays silently
 * (no health, no `mkHealth`) and continues the same loop from the landing step; any other
 * throw is a failed loop. Health: completion counted once per loop, failure once (it ends
 * the loop). See change: mock-player-step-controls (design D3).
 */
export async function playLoop(doc: Document, script: ScriptStep[], c: LoopContext): Promise<RunResult> {
  let counted = false;
  const report = (r: RunResult) => {
    if (r.ok) {
      if (counted) return;
      counted = true;
      c.health.completed++;
    } else {
      c.health.failed++;
      c.health.errors.push(`loop ${c.n}: ${r.error}`);
      c.overlay?.error(r.error);
      if (c.stopOnFail) c.gate.stop();
    }
    c.post({ mkHealth: c.spec, completed: c.health.completed, failed: c.health.failed, error: r.ok ? undefined : r.error });
  };
  let from = 0;
  for (;;) {
    try {
      const r = await runSteps(doc, script, { from, fast: c.fast, overlay: c.overlay, paused: (k) => c.gate.wait(k) });
      report(r);
      if (!r.ok) return r;
      await c.gate.wait(script.length, c.hold);
      return r;
    } catch (e) {
      if (!(e instanceof Rewind)) {
        const r: RunResult = { ok: false, error: String((e as Error)?.message ?? e) };
        report(r);
        return r;
      }
      await c.reset();
      const replay = await runSteps(doc, script, { upTo: e.to, fast: true, overlay: null });
      if (!replay.ok) { report(replay); return replay; }
      from = e.to;
    }
  }
}

/** Pane height: the overflowing root, else the body content (incl. portals, never fixed UI). */
function stageHeight(doc: Document): number {
  const root = doc.documentElement;
  if (root.scrollHeight > root.clientHeight) return root.scrollHeight;
  const win = doc.defaultView!;
  let h = doc.body.scrollHeight;
  for (const el of Array.from(doc.body.children)) {
    if (win.getComputedStyle(el).position === "fixed") continue;
    h = Math.max(h, Math.ceil(el.getBoundingClientRect().bottom + win.scrollY));
  }
  return h;
}

/**
 * One silent fast loop measuring the tallest height (after mount and after each step,
 * settled), bounded by a total budget; a failing step ends it. See change:
 * mock-player-step-controls (design D4).
 */
async function measureStage(doc: Document, script: ScriptStep[]): Promise<number> {
  let max = 0;
  const sample = () => { const h = stageHeight(doc); max = Math.max(max, h); return h; };
  const ro = new ResizeObserver(() => sample());
  ro.observe(doc.body);
  const ac = new AbortController();
  // The budget runs from the pane document's start (≈ iframe mount), not from this call.
  const timer = setTimeout(() => ac.abort(), Math.max(0, MEASURE_BUDGET_MS - performance.now()));
  const settle = async () => {
    const end = Date.now() + SETTLE_CAP_MS;
    let last = sample();
    let since = Date.now();
    while (Date.now() < end && !ac.signal.aborted) {
      await sleep(50);
      const h = sample();
      if (h !== last) { last = h; since = Date.now(); } else if (Date.now() - since >= SETTLE_STABLE_MS) break;
    }
  };
  try {
    const r = await runSteps(doc, script, { fast: true, overlay: null, signal: ac.signal, paused: () => settle() });
    if (r.ok) await settle();
  } finally {
    clearTimeout(timer);
    ro.disconnect();
  }
  return max || stageHeight(doc);
}

export async function startPane(o: PaneRuntimeOptions): Promise<void> {
  const params = new URLSearchParams(location.search);
  const win = window as Window & typeof globalThis & { __mkHealth?: Health & { error?: string } };
  let fx: { reset(): void } | null = null;
  try {
    if (o.fixtures) fx = await installFixtures(o.fixtures, (m) => post({ mkMissing: o.spec, method: m.method, path: m.path }));
  } catch (e) {
    const error = `fixtures unavailable (install the optional peer @mswjs/interceptors): ${String((e as Error).message ?? e)}`;
    win.__mkHealth = { completed: 0, failed: 0, errors: [error], error };
    post({ mkHealth: o.spec, completed: 0, failed: 0, error });
  }
  const clock = o.script || o.clockAt ? createClock(clockStart(o.clockAt, performance.timeOrigin)) : null;
  if (clock) installClock(win, clock);
  o.ready();
  if (!o.script?.length || !o.driven) return;
  const script = o.script;
  const health: Health = { completed: 0, failed: 0, errors: [] };
  win.__mkHealth = health;

  if (o.step !== undefined) {
    // Reduced-motion step pane: run silently up to step k, then stop.
    post({ mkReady: o.spec });
    clock?.reset();
    const r = await runSteps(document, script, { upTo: o.step, fast: true, overlay: null });
    if (r.ok) health.completed++;
    else {
      health.failed++;
      health.errors.push(`loop 1: ${r.error}`);
      document.body.dataset.mkStepError = r.error;
    }
    post({ mkHealth: o.spec, completed: health.completed, failed: health.failed, error: r.ok ? undefined : r.error });
    return;
  }

  const fast = params.has("mkFast");
  const want = Number(params.get("mkLoops"));
  const loops = Number.isInteger(want) && want > 0 ? want : o.loop === false ? 1 : Infinity;
  const checking = params.has("mkLoops");
  const overlay = createOverlay(document);
  const reset = async () => { fx?.reset(); clock?.reset(); overlay.clear(); await o.remount(); };
  const N = script.length;
  // Paused by the reviewer, or held by the shell while the pane is off-screen (a running
  // script must never move the reviewer's page); stepped with mkStep while paused.
  const gate = createStepGate({
    steps: N,
    loop: o.loop !== false,
    onHeld: (k) => overlay.caption(k === 0 ? `0/${N} start` : `${k}/${N} ${script[k - 1].say}`),
    onChange: (state) => post({ mkGate: o.spec, state }),
  });
  addEventListener("message", (e) => {
    if (e.source !== parent || !originOk(e)) return;
    const d = e.data;
    if (typeof d?.mkPause === "boolean") gate.setPaused(d.mkPause);
    else if (typeof d?.mkHidden === "boolean") gate.setHidden(d.mkHidden);
    else if (d?.mkStep === 1 || d?.mkStep === -1) gate.step(d.mkStep);
  });
  post({ mkReady: o.spec }); // the shell answers with the current mkHidden / mkPause state

  // Embedded live pane: measure the stage behind the shell's loading cover, then start.
  const measure = parent !== window && !checking;
  if (measure) {
    document.body.dataset.mkMeasuring = "1";
    const h = await measureStage(document, script);
    post({ mkStage: o.spec, h });
    delete document.body.dataset.mkMeasuring;
  }

  for (let i = 0; i < loops; i++) {
    if (i > 0 || measure) await reset();
    else clock?.reset();
    const r = await playLoop(document, script, {
      spec: o.spec, n: i + 1, gate, overlay, fast, hold: o.loop === false && !checking,
      stopOnFail: !checking, reset, health, post,
    });
    if (!r.ok && !checking) return; // live view stops at the failing step, showing it
    if (i + 1 < loops && gate.state.kind === "playing") await sleep(fast ? FAST_HOLD_MS : HOLD_MS);
  }
}
