/**
 * Activation routing for a question-stack entry (design D10).
 *
 * A session is VISIBLE when it is a board session that is not hidden (same
 * predicate the session list uses, `filterSessions(..., showHidden=false)`).
 *
 * - visible, chat-placed prompt   → open the session (reveal through filters /
 *   collapsed folder), then scroll the pending ask into view and focus it.
 * - visible, widget-bar prompt    → open the session, then bring the OWNING
 *   SLOT into view and focus it; never focus the chat.
 * - hidden / headless / unknown   → open the question dialog.
 *
 * The DOM contract with the render sites (poll-until-mounted, because
 * selecting a session mounts its chat asynchronously):
 *   `[data-pending-ask]`        pending inline ask card (ChatView)
 *   `[data-testid="multi-ask-panel"]`  grouped pending asks (MultiAskPanel)
 *   `[data-widget-bar-slot]`    a widget-bar slot that owns a pending prompt
 * See change: add-pending-question-stack.
 */
import type { QuestionRow } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { filterSessions } from "../session/session-grouping.js";

export type QuestionRoute = "chat" | "slot" | "dialog";

const CHAT_PROMPT_SELECTOR = '[data-pending-ask], [data-testid="multi-ask-panel"]';
const WIDGET_SLOT_SELECTOR = "[data-widget-bar-slot]";

const POLL_MS = 100;
const POLL_MAX_MS = 3000;

/** Board session that is not hidden (an unknown id is not visible). */
function isQuestionSessionVisible(session: DashboardSession | undefined): boolean {
  return session !== undefined && filterSessions([session], false, false).length === 1;
}

export function decideQuestionRoute(row: QuestionRow, session: DashboardSession | undefined): QuestionRoute {
  if (!isQuestionSessionVisible(session)) return "dialog";
  return row.origin === "widget-bar" ? "slot" : "chat";
}

/** Scroll `el` into view and move focus to it without a second scroll. */
function bringIntoView(el: HTMLElement): void {
  el.scrollIntoView?.({ behavior: "smooth", block: "center" });
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

/**
 * Poll for `selector` until it mounts (≤ 3 s), then `bringIntoView`. Returns a
 * canceller. Gives up silently: the session is already selected, so the user
 * lands on the right surface either way.
 */
function focusWhenMounted(selector: string, root: ParentNode = document): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waited = 0;
  const tick = () => {
    timer = null;
    const el = root.querySelector<HTMLElement>(selector);
    if (el) {
      bringIntoView(el);
      return;
    }
    waited += POLL_MS;
    if (waited <= POLL_MAX_MS) timer = setTimeout(tick, POLL_MS);
  };
  timer = setTimeout(tick, POLL_MS);
  return () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

export interface RouteQuestionDeps {
  session: DashboardSession | undefined;
  /** Select the session, revealing it through filters / collapsed folders, and open its chat. */
  openSession(sessionId: string): void;
  openDialog(row: QuestionRow): void;
}

/** Activate an entry. Returns the route taken. */
export function routeQuestion(row: QuestionRow, deps: RouteQuestionDeps): QuestionRoute {
  const route = decideQuestionRoute(row, deps.session);
  if (route === "dialog") {
    deps.openDialog(row);
    return route;
  }
  deps.openSession(row.sessionId);
  focusWhenMounted(route === "slot" ? WIDGET_SLOT_SELECTOR : CHAT_PROMPT_SELECTOR);
  return route;
}
