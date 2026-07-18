/**
 * Folder-header "N need you" rollup. Renders a compact, clickable pill showing
 * the count of the folder's chat-routed `ask_user` (blocked-on-you) child
 * sessions. Hidden when the count is 0. Activating it brings the blocked
 * sessions into view (delegated to `onActivate`).
 *
 * Widget-bar-placed prompts are excluded: each `ask_user` candidate mounts a
 * hidden `WidgetBarProbe` that reports its widget-bar state up, so the count
 * stays rules-of-hooks-safe (one hook per stable, session-id-keyed child).
 *
 * Mobile (375px): the "need you" label is hidden (`hidden sm:inline`); only the
 * comment-question icon + count render.
 *
 * See change: improve-dashboard-attention-routing.
 */

import { useHasWidgetBarPrompt } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiCommentQuestion } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

function WidgetBarProbe({
  sessionId,
  onResult,
}: {
  sessionId: string;
  onResult: (sessionId: string, isWidgetBar: boolean) => void;
}) {
  const isWidgetBar = useHasWidgetBarPrompt(sessionId);
  React.useEffect(() => {
    onResult(sessionId, isWidgetBar);
  }, [sessionId, isWidgetBar, onResult]);
  return null;
}

export function FolderNeedsYouPill({
  sessions,
  onActivate,
}: {
  sessions: DashboardSession[];
  /** Invoked with the first chat-routed (non-widget-bar) blocked session id. */
  onActivate: (sessionId: string) => void;
}) {
  const candidates = sessions.filter((s) => s.currentTool === "ask_user" && s.status !== "ended");
  // Per-candidate widget-bar classification once its probe reports. Absent =
  // not yet classified (excluded from the count until known) so the pill never
  // flashes an over-count before the probes resolve.
  const [classified, setClassified] = useState<Map<string, boolean>>(() => new Map());

  const onResult = useCallback((sessionId: string, isWidgetBar: boolean) => {
    setClassified((prev) => {
      if (prev.get(sessionId) === isWidgetBar) return prev;
      const next = new Map(prev);
      next.set(sessionId, isWidgetBar);
      return next;
    });
  }, []);

  // Blocked = candidate whose probe reported NOT widget-bar.
  const blockedIds = candidates.filter((s) => classified.get(s.id) === false).map((s) => s.id);
  const count = blockedIds.length;

  return (
    <>
      {candidates.map((s) => (
        <WidgetBarProbe key={s.id} sessionId={s.id} onResult={onResult} />
      ))}
      {count > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onActivate(blockedIds[0]);
          }}
          data-testid="folder-needs-you-pill"
          data-needs-you-count={count}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium text-[var(--status-needs-you)] border border-[color-mix(in_srgb,var(--status-needs-you)_45%,transparent)] bg-[color-mix(in_srgb,var(--status-needs-you)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--status-needs-you)_20%,transparent)] cursor-pointer shrink-0"
          title={i18nT("common.nNeedYou", { count }, `${count} need you`)}
          aria-label={i18nT("common.nNeedYou", { count }, `${count} need you`)}
        >
          <Icon path={mdiCommentQuestion} size={0.5} />
          <span>{count}</span>
          <span className="hidden sm:inline">{i18nT("common.needYou", undefined, "need you")}</span>
        </button>
      )}
    </>
  );
}
