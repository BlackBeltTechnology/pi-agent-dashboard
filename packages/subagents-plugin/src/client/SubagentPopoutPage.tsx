/**
 * SubagentPopoutPage — fullscreen route content for /session/:sid/subagent/:aid.
 *
 * Renders the SubagentDetailView in `popout` mode plus a chrome header.
 * Shows graceful empty states for:
 *   - subscription not yet resolved (loading)
 *   - parent session not found in client state
 *   - subagent not present in parent session's `subagents` map
 *
 * See change: add-subagent-inspector.
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiArrowLeft, mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect } from "react";
import { type SessionStateLike, SubagentDetailView } from "./SubagentDetailView.js";

export interface SubagentPopoutPageProps {
  sessionId: string;
  agentId: string;
  /** SessionState-like (just needs the subagents map) for the parent session, or undefined if not (yet) subscribed. */
  session: SessionStateLike | undefined;
  /** True once the parent session's subscription has resolved (either with state or not-found). */
  subscriptionResolved: boolean;
  /** Optional parent-session display label (e.g. cwd basename) for the breadcrumb. */
  parentLabel?: string;
  onBack?: () => void;
  /** Forwarded to SubagentDetailView → MinimalChatView so per-tool renderers can build session-scoped links. */
  forwardSessionId?: string;
}

export function SubagentPopoutPage({
  sessionId,
  agentId,
  session,
  subscriptionResolved,
  parentLabel,
  onBack,
  forwardSessionId,
}: SubagentPopoutPageProps) {
  const t = useT();
  const sub = session?.subagents.get(agentId);

  // Page title: subagent display name · parent · pi
  useEffect(() => {
    const displayName = sub?.displayName || sub?.type || agentId;
    document.title = `${displayName} · ${parentLabel ?? sessionId} · pi`;
    return () => {
      document.title = "pi";
    };
  }, [sub?.displayName, sub?.type, agentId, parentLabel, sessionId]);

  // Loading: subscription has not resolved yet.
  if (!subscriptionResolved) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-sm text-[var(--text-muted)] gap-2">
        <div>{t("loadingParentSession", undefined, "Loading parent session…")}</div>
      </div>
    );
  }

  // Parent session not found in client state.
  if (!session) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-sm text-[var(--text-muted)] gap-3 px-6 text-center">
        <div className="text-base text-[var(--text-primary)]">{t("parentSessionNotFound", undefined, "Parent session not found")}</div>
        <div className="max-w-md">
          {t(
            "parentSessionNotFoundBody",
            undefined,
            "It may have been archived or deleted. Close this tab — the session this subagent was launched from is no longer available in the dashboard.",
          )}
        </div>
        <button
          onClick={() => window.close()}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 mt-2 px-3 py-1 border border-[var(--border-primary)] rounded"
        >
          <Icon path={mdiClose} size={0.5} /> {t("closeTab", undefined, "Close tab")}
        </button>
      </div>
    );
  }

  // Subagent not in parent's subagents map.
  if (!sub) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex items-center gap-2 flex-shrink-0">
          {onBack && (
            <button
              onClick={onBack}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              title={t("back", undefined, "Back")}
            >
              <Icon path={mdiArrowLeft} size={0.7} />
            </button>
          )}
          <span className="text-sm text-[var(--text-primary)]">
            {t("subagentBreadcrumb", { label: parentLabel ?? sessionId }, "Subagent · {label}")}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-muted)] px-6 text-center">
          {t(
            "subagentNotFoundCleared",
            undefined,
            "Subagent not found — it may have been cleared from the parent session's history.",
          )}
        </div>
      </div>
    );
  }

  // Found: render the detail view in popout mode with a chrome header.
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center gap-2 flex-shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            title={t("back", undefined, "Back")}
          >
            <Icon path={mdiArrowLeft} size={0.7} />
          </button>
        )}
        <span className="text-[11px] text-[var(--text-tertiary)] truncate flex-shrink-0">
          {parentLabel ?? sessionId} ›
        </span>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
            {sub.displayName || sub.type}
          </span>
          {sub.agentMdPath && (
            <span
              className="text-[10px] font-mono text-[var(--text-tertiary)] truncate"
              title={sub.agentMdPath}
            >
              {sub.agentMdPath}
            </span>
          )}
        </div>
      </div>
      {/* `min-h-0` is required so the body scrolls instead of overflowing.
          See change: fix-flows-plugin-polish (scrollbar fix). */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SubagentDetailView session={session} agentId={agentId} mode="popout" sessionId={forwardSessionId ?? sessionId} />
      </div>
    </div>
  );
}
