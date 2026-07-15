/**
 * FlowAgentDetail — thin adapter shim over `MinimalChatView`.
 *
 * Maps `FlowAgentState` → `MinimalChatViewProps`. Preserves the existing
 * public API (`agent`, `onBack`) so `FlowAgentCard`'s eye-button detail
 * dialog keeps working without change.
 *
 * See change: extract-minimal-chat-view.
 */

import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  type MinimalChatEntry,
  type MinimalChatStatus,
  MinimalChatView,
} from "@blackbelt-technology/pi-dashboard-client-utils/minimal-chat";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type {
  FlowAgentState,
  FlowAgentStatus,
  FlowDetailEntry,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React from "react";
import { formatCost } from "./FlowAgentCard.js";

function mapFlowStatus(status: FlowAgentStatus): MinimalChatStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "complete":
      return "complete";
    case "error":
      return "error";
    case "blocked":
      return "blocked";
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return "pending";
    }
  }
}

function mapFlowEntries(detailHistory: FlowDetailEntry[]): MinimalChatEntry[] {
  return detailHistory.map((e) => {
    switch (e.kind) {
      case "tool":
        return {
          kind: "tool",
          toolName: e.toolName,
          input: e.input,
          output: e.output,
          isError: e.isError,
        };
      case "text":
        return { kind: "text", text: e.text };
      case "thinking":
        return { kind: "thinking", text: e.text };
      case "error":
        return { kind: "error", text: e.text };
      default: {
        const _exhaustive: never = e;
        void _exhaustive;
        return { kind: "error", text: "(unknown entry)" };
      }
    }
  });
}

export function FlowAgentDetail({
  agent,
  onBack,
  sessionId,
}: {
  agent: FlowAgentState;
  onBack?: () => void;
  /** Forwarded to MinimalChatView so per-tool renderers can build session-scoped links. */
  sessionId?: string;
}) {
  const t = useT();
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  const title = agent.label || agent.agentName;
  const status = mapFlowStatus(agent.status);
  const isComplete =
    agent.status === "complete" || agent.status === "error" || agent.status === "blocked";

  const entries = mapFlowEntries(agent.detailHistory);

  const footer = agent.summary ? (
    <div className="mt-3 pt-2 border-t border-[var(--border-subtle)]">
      <div className="text-[11px] text-[var(--text-muted)] mb-1">{t("summary", undefined, "Summary")}</div>
      <MarkdownContent content={agent.summary} />
    </div>
  ) : undefined;

  const emptyMessage =
    agent.status === "pending"
      ? t("waitingToStart", undefined, "Waiting to start...")
      : t("noActivityYet", undefined, "No activity yet");

  return (
    <MinimalChatView
      title={title}
      status={status}
      entries={entries}
      mode="popout"
      onBack={onBack}
      sessionId={sessionId}
      hideToolStatusIcon
      meta={{
        modelName: agent.model,
        tokens: agent.tokens,
        cost: agent.cost != null && agent.cost > 0 ? formatCost(agent.cost) : undefined,
        durationMs: isComplete ? agent.duration : undefined,
      }}
      emptyMessage={emptyMessage}
      footer={footer}
    />
  );
}
