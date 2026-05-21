/**
 * FlowArchitectPopoutPage — fullscreen route content for
 * `/session/:sid/architect`.
 *
 * Mounts `FlowArchitectDetail` in popout mode plus a chrome header.
 * Graceful empty-state ladder mirrors `FlowAgentPopoutPage`:
 *   1. Subscription not yet resolved → "Loading parent session…"
 *   2. Parent session not found → close-tab CTA
 *   3. No architect active → "No architect active"
 *   4. Resolved → FlowArchitectDetail render
 *
 * See change: fix-flows-plugin-polish (A4).
 */
import React, { useEffect } from "react";
import { Icon } from "@mdi/react";
import { mdiArrowLeft, mdiClose } from "@mdi/js";
import type { ArchitectState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { FlowArchitectDetail } from "./FlowArchitect.js";

export interface FlowArchitectPopoutPageProps {
  sessionId: string;
  /** The resolved architect state (or undefined if not yet subscribed / not active). */
  architectState: ArchitectState | undefined;
  /** True once the parent session's subscription has resolved. */
  subscriptionResolved: boolean;
  /** Optional parent-session display label (e.g. cwd) for the breadcrumb. */
  parentLabel?: string;
  onBack?: () => void;
}

export function FlowArchitectPopoutPage({
  sessionId,
  architectState,
  subscriptionResolved,
  parentLabel,
  onBack,
}: FlowArchitectPopoutPageProps) {
  useEffect(() => {
    document.title = `Flow Architect · ${parentLabel ?? sessionId} · pi`;
    return () => {
      document.title = "pi";
    };
  }, [parentLabel, sessionId]);

  // (1) Loading
  if (!subscriptionResolved) {
    return (
      <div
        data-testid="flow-architect-popout-loading"
        className="flex flex-col h-full items-center justify-center text-sm text-[var(--text-muted)] gap-2"
      >
        <div>Loading parent session…</div>
      </div>
    );
  }

  // (2) Parent session not found (cannot derive parentLabel and architect is
  // absent — best heuristic available since the runtime DashboardSession is
  // not threaded down).
  if (!parentLabel && !architectState) {
    return (
      <div
        data-testid="flow-architect-popout-no-session"
        className="flex flex-col h-full items-center justify-center text-sm text-[var(--text-muted)] gap-3 px-6 text-center"
      >
        <div className="text-base text-[var(--text-primary)]">Parent session not found</div>
        <div className="max-w-md">
          It may have been archived or deleted. Close this tab — the session
          this architect was launched from is no longer available.
        </div>
        <button
          onClick={() => window.close()}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1 mt-2 px-3 py-1 border border-[var(--border-primary)] rounded"
        >
          <Icon path={mdiClose} size={0.5} /> Close tab
        </button>
      </div>
    );
  }

  // (3) No architect active
  if (!architectState) {
    return (
      <div data-testid="flow-architect-popout-no-architect" className="flex flex-col h-full overflow-hidden">
        <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex items-center gap-2 flex-shrink-0">
          {onBack && (
            <button
              onClick={onBack}
              className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              title="Back"
            >
              <Icon path={mdiArrowLeft} size={0.7} />
            </button>
          )}
          <span className="text-sm text-[var(--text-primary)]">
            Flow Architect · {parentLabel ?? sessionId}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-muted)] px-6 text-center">
          No architect active on this session.
        </div>
      </div>
    );
  }

  // (4) Found
  return (
    <div data-testid="flow-architect-popout" className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center gap-2 flex-shrink-0">
        {onBack && (
          <button
            onClick={onBack}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            title="Back"
          >
            <Icon path={mdiArrowLeft} size={0.7} />
          </button>
        )}
        <span className="text-[11px] text-[var(--text-tertiary)] truncate flex-shrink-0">
          {parentLabel ?? sessionId} ›
        </span>
        <span className="text-sm font-medium text-[var(--text-primary)] truncate flex-1 min-w-0">
          Flow Architect
        </span>
      </div>
      {/* `min-h-0` required so body scrolls instead of overflowing.
          See change: fix-flows-plugin-polish (scrollbar fix). */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <FlowArchitectDetail state={architectState} sessionId={sessionId} />
      </div>
    </div>
  );
}
