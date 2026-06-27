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
import { t as i18nT } from "../lib/i18n";
import { countNeedsYou } from "../lib/session-status-visuals.js";

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
  onActivate: () => void;
}) {
  const candidates = sessions.filter((s) => s.currentTool === "ask_user" && s.status !== "ended");
  const [widgetBarIds, setWidgetBarIds] = useState<Set<string>>(() => new Set());

  const onResult = useCallback((sessionId: string, isWidgetBar: boolean) => {
    setWidgetBarIds((prev) => {
      const has = prev.has(sessionId);
      if (isWidgetBar === has) return prev;
      const next = new Set(prev);
      if (isWidgetBar) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  }, []);

  const count = countNeedsYou(candidates, (id) => widgetBarIds.has(id));

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
            onActivate();
          }}
          data-testid="folder-needs-you-pill"
          data-needs-you-count={count}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium text-[var(--status-needs-you)] border border-[color-mix(in_srgb,var(--status-needs-you)_45%,transparent)] bg-[color-mix(in_srgb,var(--status-needs-you)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--status-needs-you)_20%,transparent)] cursor-pointer shrink-0"
          title={i18nT("auto.n_need_you", { count }, `${count} need you`)}
          aria-label={i18nT("auto.n_need_you", { count }, `${count} need you`)}
        >
          <Icon path={mdiCommentQuestion} size={0.5} />
          <span>{count}</span>
          <span className="hidden sm:inline">{i18nT("auto.need_you", undefined, "need you")}</span>
        </button>
      )}
    </>
  );
}
