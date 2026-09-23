/**
 * Active-YOLO indicators (change: add-access-grant-dialog, task 8b.7; spec
 * access-grant-yolo "unmissable", sidebar-header row 1).
 *
 * - `YoloPill`: compact pill for the sidebar header's app-level row, beside
 *   `TunnelButton`. Absent when no session is live.
 * - `YoloSessionIndicator`: remaining time on a session surface whose `cwd`
 *   is in scope (every surface when unscoped). A PEER of the pill, not a
 *   fallback: it renders wherever the session surface does, so YOLO stays
 *   visible when the sidebar header is not rendered (mobile).
 *
 * Neither can be dismissed (no close control, no local hide state). Both lead
 * to the Access page, where the session is ended. Unscoped reads more severe
 * (error tokens + "everywhere") than scoped (warning tokens).
 */
import { mdiShieldAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type { MouseEvent } from "react";
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

function useOpenAccess() {
  const [, navigate] = useLocation();
  return (e: MouseEvent) => {
    e.preventDefault();
    navigate(ACCESS_PAGE);
  };
}

export function YoloPill({ store }: { store?: YoloStatusStore }) {
  const { session, now } = useLiveYoloSession(store);
  const open = useOpenAccess();
  if (!session) return null;
  const ms = remainingMs(session, now);
  const time = ms === null ? "\u221e" : formatRemaining(ms);
  const title = session.unscoped
    ? i18nT(
        "yolo.pillTitleUnscoped",
        { remaining: yoloRemainingLabel(session, now) },
        "YOLO is on EVERYWHERE: file access is auto-allowed on every folder ({remaining}). Open Access to end it.",
      )
    : i18nT(
        "yolo.pillTitle",
        { remaining: yoloRemainingLabel(session, now) },
        "YOLO is on: file access in its folders is auto-allowed ({remaining}). Open Access to end it.",
      );
  return (
    <a
      href={ACCESS_PAGE}
      onClick={open}
      data-testid="yolo-pill"
      data-scope={session.unscoped ? "unscoped" : "scoped"}
      title={title}
      aria-label={title}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border text-[10px] leading-none tabular-nums ${yoloTone(session.unscoped)}`}
    >
      <Icon path={mdiShieldAlertOutline} size={0.45} />
      {session.unscoped
        ? i18nT("yolo.pillUnscoped", { time }, "YOLO everywhere {time}")
        : i18nT("yolo.pill", { time }, "YOLO {time}")}
    </a>
  );
}

export function YoloSessionIndicator({ cwd, store }: { cwd: string | undefined; store?: YoloStatusStore }) {
  const { session, now } = useLiveYoloSession(store);
  const open = useOpenAccess();
  if (!session || !isCwdInYoloScope(cwd, session)) return null;
  const remaining = yoloRemainingLabel(session, now);
  return (
    <a
      href={ACCESS_PAGE}
      onClick={open}
      role="status"
      data-testid="yolo-session-indicator"
      data-scope={session.unscoped ? "unscoped" : "scoped"}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] tabular-nums self-start ${yoloTone(session.unscoped)}`}
    >
      <Icon path={mdiShieldAlertOutline} size={0.5} />
      {session.unscoped
        ? i18nT(
            "yolo.sessionUnscoped",
            { remaining },
            "YOLO everywhere: file access auto-allowed on every folder · {remaining}",
          )
        : i18nT("yolo.sessionScoped", { remaining }, "YOLO: file access here auto-allowed · {remaining}")}
    </a>
  );
}
