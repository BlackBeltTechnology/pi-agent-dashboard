// GENERIC script runner (framework-free): drives a frame's `script` on the REAL
// rendered DOM of one pane document with Testing Library user-event, behind a
// visible pointer + caption overlay. Bounded waits; `unless` skips a step whose
// goal already holds, `expect` must hold after the act.
// See change: add-mock-site-exact-env (design D4, D5).

export interface ScriptStep {
  /** Caption shown while the step runs. */
  say: string;
  /** Test id (tried first) or CSS selector. Required except for a plain `wait` with `expect`. */
  target?: string;
  act: "click" | "type" | "clear" | "hover" | "press" | "wait";
  /** Text for `type`. */
  text?: string;
  /** Key for `press`, e.g. "Enter" or "{Control>}a{/Control}". */
  key?: string;
  /** Skip the step when this holds (selector present, or a check). */
  unless?: string | ((doc: Document) => boolean);
  /** Must hold within the timeout after the act. */
  expect?: string | ((doc: Document) => boolean);
  /** Per-step wait budget in ms (default 4000). */
  timeout?: number;
}

const DEFAULT_STEP_TIMEOUT = 4000;
const POLL_MS = 50;
const MOVE_MS = 450;
const TYPE_DELAY_MS = 70;
/** A visible step lasts at least this long, so its caption can be read. */
const MIN_STEP_MS = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** First element for a target: `[data-testid=…]` first, then as a CSS selector. */
function findTarget(doc: Document, target: string): Element | null {
  const byId = doc.querySelector(`[data-testid="${CSS.escape(target)}"]`);
  if (byId) return byId;
  try { return doc.querySelector(target); } catch { return null; }
}

const holds = (doc: Document, c: string | ((d: Document) => boolean)) => (typeof c === "string" ? !!findTarget(doc, c) : !!c(doc));
const describe = (c: string | ((d: Document) => boolean)) => (typeof c === "string" ? `\`${c}\`` : "check");

async function waitFor<T>(fn: () => T | null | false, timeout: number): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(POLL_MS);
  }
}

export interface Overlay { readonly x: number; readonly y: number; move(x: number, y: number, instant: boolean): Promise<void>; press(on: boolean): void; caption(text: string): void; error(text: string): void; clear(): void }

/** Pointer + caption painted with `--mk-*` tokens; `pointer-events: none`; inside this document. */
export function createOverlay(doc: Document): Overlay {
  const cursor = doc.createElement("div");
  cursor.className = "mk-cursor";
  cursor.setAttribute("aria-hidden", "true");
  const cap = doc.createElement("div");
  cap.className = "mk-caption";
  cap.setAttribute("role", "status");
  doc.body.append(cursor, cap);
  doc.body.classList.add("mk-scripted"); // room for the caption under the content
  let at = { x: -1, y: -1 };
  return {
    get x() { return at.x; },
    get y() { return at.y; },
    async move(x, y, instant) {
      at = { x, y };
      cursor.style.transitionDuration = instant ? "0ms" : `${MOVE_MS}ms`;
      cursor.style.transform = `translate(${x}px, ${y}px)`;
      cursor.dataset.x = String(x);
      cursor.dataset.y = String(y);
      cursor.classList.add("on");
      if (!instant) await sleep(MOVE_MS + 30);
    },
    press(on) { cursor.classList.toggle("mk-down", on); },
    caption(text) { cap.textContent = text; cap.classList.toggle("on", !!text); },
    error(text) { cap.textContent = text; cap.classList.add("on", "mk-cap-err"); },
    clear() { cap.classList.remove("on", "mk-cap-err"); cursor.classList.remove("on", "mk-down"); },
  };
}

export type RunResult = { ok: true } | { ok: false; error: string };

/**
 * Run steps 1..`upTo` (all when absent) on `doc`. `fast` = no pointer travel or
 * typing delay (reduced-motion step panes, headless checks).
 */
export async function runSteps(
  doc: Document,
  steps: ScriptStep[],
  o: { upTo?: number; fast?: boolean; overlay?: Overlay | null; paused?: () => Promise<void> } = {},
): Promise<RunResult> {
  const { default: userEvent } = await import("@testing-library/user-event");
  // No internal delay: each user-event call completes in microtasks, so another pane on
  // the same page cannot steal focus mid-action. Pacing is explicit sleeps between actions.
  const user = userEvent.setup({ document: doc, delay: null, pointerEventsCheck: 0 });
  const last = Math.min(o.upTo ?? steps.length, steps.length);
  for (let i = 0; i < last; i++) {
    await o.paused?.();
    const started = Date.now();
    const s = steps[i];
    const tag = `Step ${i + 1}/${steps.length} "${s.say}"`;
    const timeout = s.timeout ?? DEFAULT_STEP_TIMEOUT;
    o.overlay?.caption(`${i + 1}/${steps.length} ${s.say}`);
    if (s.unless !== undefined && holds(doc, s.unless)) continue;
    let el: Element | null = null;
    if (s.target) {
      el = await waitFor(() => findTarget(doc, s.target!), timeout);
      if (!el) return { ok: false, error: `${tag} failed: no element matches \`${s.target}\` within ${timeout} ms` };
    } else if (s.act !== "wait" && s.act !== "press") {
      return { ok: false, error: `${tag} failed: act "${s.act}" needs a target` };
    }
    if (el && s.act !== "wait" && o.overlay) {
      // No scrollIntoView: the pane document is sized to its content, and scrolling
      // here would scroll the reviewer's page (the parent) too. Aim, then re-aim while the target still moves (late data reflows it during travel).
      let instant = !!o.fast;
      for (let k = 0; k < 4; k++) {
        const b = el.getBoundingClientRect();
        const x = b.left + b.width / 2, y = b.top + b.height / 2;
        if (k > 0 && Math.abs(x - o.overlay.x) < 1 && Math.abs(y - o.overlay.y) < 1) break;
        await o.overlay.move(x, y, instant);
        instant = true;
      }
    }
    switch (s.act) {
      case "click":
        o.overlay?.press(true);
        await user.click(el!);
        o.overlay?.press(false);
        break;
      case "type":
        await user.click(el!);
        for (const ch of s.text ?? "") {
          (el as HTMLElement).focus({ preventScroll: true });
          await user.keyboard(ch === "{" || ch === "[" ? ch + ch : ch);
          if (!o.fast) await sleep(TYPE_DELAY_MS);
        }
        break;
      case "clear": (el as HTMLElement).focus({ preventScroll: true }); await user.clear(el!); break;
      case "hover": await user.hover(el!); break;
      case "press":
        if (el) (el as HTMLElement).focus({ preventScroll: true });
        await user.keyboard(s.key?.startsWith("{") ? s.key : `{${s.key ?? "Enter"}}`);
        break;
      case "wait": break;
    }
    if (s.expect !== undefined && !(await waitFor(() => holds(doc, s.expect!), timeout)))
      return { ok: false, error: `${tag} failed: expect ${describe(s.expect)} did not hold within ${timeout} ms` };
    if (!o.fast) await sleep(MIN_STEP_MS - (Date.now() - started));
  }
  return { ok: true };
}
