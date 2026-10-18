/**
 * Active-YOLO signals (changes: add-access-grant-dialog 8b.7; fix-yolo-indicator-overflow).
 *
 * No inline header indicator (it wrapped and grew its row, issue #898). Three
 * signals instead, none of them a live region:
 * - `useYoloAppBar` / `YoloBarLink`: orange tint on the sidebar's app-level
 *   row (no visible control, no ticking) + a focus-revealed out-of-flow link.
 * - `YoloComposerStrip`: one single-line strip directly above each dashboard
 *   prompt composer whose `cwd` is in scope; carries the remaining time.
 *
 * None can be dismissed. All lead to the Access page, where the session is
 * ended. Unscoped reads more severe (heavier border, "everywhere") than scoped.
 */
import { mdiShieldAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type MouseEvent, useEffect, useState } from "react";
import { useLocation } from "wouter";
import type { YoloSessionView } from "../../lib/access-grants/access-prompts-types.js";
import {
  formatRemaining,
  isCwdInYoloScope,
  remainingMs,
  useNow,
  useYoloStatus,
  type YoloStatusStore,
} from "../../lib/access-grants/yolo-status.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/** Where the session is ended. */
const ACCESS_PAGE = "/settings/access";

const TONE_SCOPED =
  "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]";
// Unscoped stays WARNING (ui-plan S6: a deliberate operator state, never an
// error) and is distinguished by weight, a heavier border and the "everywhere" label.
const TONE_UNSCOPED =
  "border-2 border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)] font-bold";

export const yoloTone = (unscoped: boolean) => (unscoped ? TONE_UNSCOPED : TONE_SCOPED);

/** The live session, or `null` once none is live or its expiry has passed. */
export function useLiveYoloSession(store?: YoloStatusStore): { session: YoloSessionView | null; now: number } {
  const session = useYoloStatus(store)?.session ?? null;
  const now = useNow(session !== null);
  const live = session && remainingMs(session, now) !== 0 ? session : null;
  return { session: live, now };
}

/** Remaining time as shown to the operator (env sessions never expire). */
export function yoloRemainingLabel(session: YoloSessionView, now: number): string {
  const ms = remainingMs(session, now);
  return ms === null
    ? i18nT("yolo.untilServerStops", undefined, "until the server stops")
    : i18nT("yolo.left", { time: formatRemaining(ms) }, "{time} left");
}

/** Longest delay `setTimeout` accepts (2^31 - 1 ms); longer waits re-arm. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * The live session without a 1 Hz tick: one `setTimeout` at the expiry instant
 * drops it. For surfaces that must not re-render every second (the sidebar bar).
 */
function useLiveYoloSessionNoTick(store?: YoloStatusStore): YoloSessionView | null {
  const session = useYoloStatus(store)?.session ?? null;
  const expiresAt = session?.expiresAt ?? null;
  const [, rearm] = useState(0);
  useEffect(() => {
    if (expiresAt === null) return;
    const delay = expiresAt - Date.now();
    if (delay <= 0) return;
    const id = setTimeout(() => rearm((n) => n + 1), Math.min(delay, MAX_TIMEOUT_MS));
    return () => clearTimeout(id);
  }, [expiresAt]);
  return session && (expiresAt === null || expiresAt > Date.now()) ? session : null;
}

/** Static coverage sentence: scope x expiry selects one of four keys (no time in it). */
function yoloCoverageSentence(session: YoloSessionView): string {
  const forever = session.expiresAt === null;
  if (session.unscoped) {
    return forever
      ? i18nT(
          "yolo.coverageUnscopedForever",
          undefined,
          "YOLO is on everywhere until the server stops: agent and dashboard file access is auto-allowed in every folder. Open Access to end it.",
        )
      : i18nT(
          "yolo.coverageUnscoped",
          undefined,
          "YOLO is on everywhere: agent and dashboard file access is auto-allowed in every folder. Open Access to end it.",
        );
  }
  return forever
    ? i18nT(
        "yolo.coverageForever",
        undefined,
        "YOLO is on until the server stops: agent and dashboard file access in its folders is auto-allowed. Open Access to end it.",
      )
    : i18nT(
        "yolo.coverage",
        undefined,
        "YOLO is on: agent and dashboard file access in its folders is auto-allowed. Open Access to end it.",
      );
}

/** Plain primary click navigates in-app; modified / non-primary clicks keep the browser default (new tab). */
function useOpenAccess() {
  const [, navigate] = useLocation();
  return (e: MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(ACCESS_PAGE);
  };
}

/**
 * Props for the sidebar `header-app-bar` while YOLO is live (else `{}`): orange
 * tint + inset underline (no box change), static `title`, `data-yolo`. No click
 * handler and no ticking: re-renders only on status change or at expiry.
 */
export function useYoloAppBar(store?: YoloStatusStore): {
  className?: string;
  title?: string;
  "data-yolo"?: "scoped" | "unscoped";
} {
  const session = useLiveYoloSessionNoTick(store);
  if (!session) return {};
  return {
    className:
      "bg-[var(--severity-warning-bg)] shadow-[inset_0_-2px_0_var(--accent-orange-text)]",
    title: yoloCoverageSentence(session),
    "data-yolo": session.unscoped ? "unscoped" : "scoped",
  };
}

/**
 * First child of the app bar: out of flow, invisible until focused (keyboard +
 * assistive-technology path to Access). `opacity-0` keeps it in the a11y tree;
 * focus reveals it below the bar without reflowing row 1.
 */
export function YoloBarLink({ store }: { store?: YoloStatusStore }) {
  const session = useLiveYoloSessionNoTick(store);
  const open = useOpenAccess();
  if (!session) return null;
  return (
    <a
      href={ACCESS_PAGE}
      onClick={open}
      data-testid="yolo-bar-link"
      className="absolute left-2 top-full z-popover max-w-[20rem] rounded border border-[var(--severity-warning-border)] px-2 py-1 text-xs bg-[var(--bg-secondary)] text-[var(--text-secondary)] opacity-0 pointer-events-none focus:opacity-100 focus:pointer-events-auto focus-ring"
    >
      {yoloCoverageSentence(session)}
    </a>
  );
}

/**
 * Single-line strip directly above a prompt composer (outside its card).
 * Link (shield + static sentence) and time are siblings, so the link's
 * accessible name never changes per tick. Absent unless live and `cwd` in scope.
 */
export function YoloComposerStrip({ cwd, store }: { cwd: string | undefined; store?: YoloStatusStore }) {
  const { session, now } = useLiveYoloSession(store);
  const open = useOpenAccess();
  if (!session || !isCwdInYoloScope(cwd, session)) return null;
  const sentence = yoloCoverageSentence(session);
  const ms = remainingMs(session, now);
  return (
    <div className="shrink-0 px-3 pt-2">
      <div
        data-testid="yolo-composer-strip"
        data-scope={session.unscoped ? "unscoped" : "scoped"}
        className={`flex items-center gap-1.5 w-full min-w-0 whitespace-nowrap overflow-hidden rounded-lg border px-2.5 py-1 text-xs ${yoloTone(session.unscoped)}`}
      >
        <a href={ACCESS_PAGE} onClick={open} title={sentence} className="flex items-center gap-1.5 flex-1 min-w-0 focus-ring">
          <Icon path={mdiShieldAlertOutline} size={0.5} className="shrink-0" aria-hidden="true" />
          <span className="truncate min-w-0">{sentence}</span>
        </a>
        <span className="shrink-0 tabular-nums font-semibold">
          {ms === null ? (
            <>
              <span aria-hidden="true">{"\u221e"}</span>
              <span className="sr-only">{i18nT("yolo.noExpiry", undefined, "no expiry")}</span>
            </>
          ) : (
            formatRemaining(ms)
          )}
        </span>
      </div>
    </div>
  );
}
