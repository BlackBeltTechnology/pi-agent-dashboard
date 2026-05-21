/**
 * FlowAgentPopoutPage — fullscreen route content for
 * `/session/:sid/flow/:flowId/agent/:agentId`.
 *
 * Mounts `FlowAgentDetail` in popout mode plus a chrome header. Graceful
 * empty-state ladder:
 *   1. Subscription not yet resolved → "Loading parent session…"
 *   2. Parent session not found → close-tab CTA
 *   3. Flow not present on parent session → "Flow not found"
 *   4. Agent not present in flow → "Agent not found"
 *
 * Mirrors `SubagentPopoutPage` structurally; both popouts share the same
 * four-tier empty-state contract.
 *
 * See change: add-flow-agent-popout.
 */
import React, { useEffect } from "react";
import { Icon } from "@mdi/react";
import { mdiArrowLeft, mdiClose } from "@mdi/js";
import type { FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { FlowAgentDetail } from "./FlowAgentDetail.js";

/** Minimal session-state shape this page consumes. */
export interface FlowAgentPopoutSessionLike {
  flowStates?: Map<string, FlowState>;
}

export interface FlowAgentPopoutPageProps {
  sessionId: string;
  flowId: string;
  agentId: string;
  /** Parent session state (or undefined if not yet subscribed). */
  session: FlowAgentPopoutSessionLike | undefined;
  /** True once the parent session's subscription has resolved. */
  subscriptionResolved: boolean;
  /** Optional parent-session display label (e.g. cwd basename) for the breadcrumb. */
  parentLabel?: string;
  onBack?: () => void;
}

export function FlowAgentPopoutPage({
  sessionId,
  flowId,
  agentId,
  session,
  subscriptionResolved,
  parentLabel,
  onBack,
}: FlowAgentPopoutPageProps) {
  const flow = session?.flowStates?.get(flowId);
  const agent = flow?.agents.get(agentId);
  const agentName = agent?.label || agent?.agentName || agentId;

  useEffect(() => {
    document.title = `${agentName} · ${flowId} · ${parentLabel ?? sessionId} · pi`;
    return () => {
      document.title = "pi";
    };
  }, [agentName, flowId, parentLabel, sessionId]);

  // (1) Loading: subscription has not resolved yet.
  if (!subscriptionResolved) {
    return (
      <div
        data-testid="flow-agent-popout-loading"
        className="flex flex-col h-full items-center justify-center text-sm text-[var(--text-muted)] gap-2"
      >
        <div>Loading parent session…</div>
      </div>
    );
  }

  // (2) Parent session not found.
  if (!session) {
    return (
      <div
        data-testid="flow-agent-popout-no-session"
        className="flex flex-col h-full items-center justify-center text-sm text-[var(--text-muted)] gap-3 px-6 text-center"
      >
        <div className="text-base text-[var(--text-primary)]">Parent session not found</div>
        <div className="max-w-md">
          It may have been archived or deleted. Close this tab — the session
          this flow was launched from is no longer available in the dashboard.
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

  // (3) Flow not found on parent session.
  if (!flow) {
    return (
      <div data-testid="flow-agent-popout-no-flow" className="flex flex-col h-full overflow-hidden">
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
            Flow · {parentLabel ?? sessionId}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-muted)] px-6 text-center">
          Flow “{flowId}” is no longer active on this session.
        </div>
      </div>
    );
  }

  // (4) Agent not found in flow.
  if (!agent) {
    return (
      <div data-testid="flow-agent-popout-no-agent" className="flex flex-col h-full overflow-hidden">
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
            {parentLabel ?? sessionId} › {flowId}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-muted)] px-6 text-center">
          Agent “{agentId}” not found in this flow — it may have been cleared.
        </div>
      </div>
    );
  }

  // (5) Found — render the detail view with a chrome header.
  return (
    <div data-testid="flow-agent-popout" className="flex flex-col h-full overflow-hidden">
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
          {parentLabel ?? sessionId} › {flowId} ›
        </span>
        <span className="text-sm font-medium text-[var(--text-primary)] truncate flex-1 min-w-0">
          {agentName}
        </span>
      </div>
      {/* `min-h-0` required so body scrolls instead of overflowing.
          See change: fix-flows-plugin-polish (scrollbar fix). */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {/* FlowAgentDetail's own header carries status/model/tokens; the chrome
            above carries breadcrumb + back nav. We omit `onBack` so the inner
            header does not render a duplicate back arrow. */}
        <FlowAgentDetail agent={agent} sessionId={sessionId} />
      </div>
    </div>
  );
}
