// GENERIC isolated-pane runtime (framework-free): runs inside one `?pane=` document.
// Installs the mock's fixtures and the pane clock BEFORE first render, then (for
// a driven side of a scripted frame) loops the script: remount with a fresh fixture
// instance + clock per loop, hold, repeat. Publishes `window.__mkHealth` and posts
// health / missing-fixture reports to the parent shell.
// Query params: `mkLoops=N` (stop after N loops), `mkFast=1` (no pointer travel).
// See change: add-mock-site-exact-env (design D3, D4, D5).
import { clockStart, createClock, installClock } from "./clock.ts";
import { type Fixtures, installFixtures } from "./fixtures.ts";
import { createOverlay, runSteps, type ScriptStep } from "./script.ts";

const HOLD_MS = 1800;
const FAST_HOLD_MS = 150;

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

const post = (msg: object) => parent.postMessage(msg, location.origin);

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

  const fast = params.has("mkFast") || o.step !== undefined;
  const want = Number(params.get("mkLoops"));
  const loops = o.step !== undefined ? 1 : Number.isInteger(want) && want > 0 ? want : o.loop === false ? 1 : Infinity;
  const checking = params.has("mkLoops");
  const overlay = o.step !== undefined ? null : createOverlay(document);
  const health: Health = { completed: 0, failed: 0, errors: [] };
  win.__mkHealth = health;
  // Paused by the Pause button, or by the shell while the pane is off-screen (a running
  // script must never move the reviewer's page).
  let userPaused = false;
  let hidden = false;
  let resume: (() => void) | null = null;
  addEventListener("message", (e) => {
    if (e.source !== parent || e.origin !== location.origin) return;
    if (typeof e.data?.mkPause === "boolean") userPaused = e.data.mkPause;
    else if (typeof e.data?.mkHidden === "boolean") hidden = e.data.mkHidden;
    else return;
    if (!userPaused && !hidden) { resume?.(); resume = null; }
  });
  const waitIfPaused = () => (userPaused || hidden ? new Promise<void>((r) => { resume = r; }) : Promise.resolve());
  post({ mkReady: o.spec }); // the shell answers with the current mkHidden / mkPause state

  for (let i = 0; i < loops; i++) {
    if (i > 0) {
      fx?.reset();
      clock?.reset();
      overlay?.clear();
      await o.remount();
    } else clock?.reset();
    const r = await runSteps(document, o.script, { upTo: o.step, fast, overlay, paused: waitIfPaused });
    if (r.ok) health.completed++;
    else {
      health.failed++;
      health.errors.push(`loop ${i + 1}: ${r.error}`);
      overlay?.error(r.error);
      if (o.step !== undefined) document.body.dataset.mkStepError = r.error;
    }
    post({ mkHealth: o.spec, completed: health.completed, failed: health.failed, error: r.ok ? undefined : r.error });
    if (!r.ok && !checking) return; // live view stops at the failing step, showing it
    if (o.step !== undefined) return; // paused after step k
    if (i + 1 < loops) {
      await new Promise((res) => setTimeout(res, fast ? FAST_HOLD_MS : HOLD_MS));
      await waitIfPaused();
    }
  }
}
