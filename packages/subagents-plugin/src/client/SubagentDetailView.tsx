/**
 * SubagentDetailView — thin adapter shim over `MinimalChatView`.
 *
 * Maps `SubagentState` → `MinimalChatViewProps`. Preserves the existing
 * public API (`session`, `agentId`, `mode`, `onBack`) so the call sites
 * (`AgentToolRenderer`, `SubagentPopoutPage`, `BackgroundSubagentsPanel`)
 * do not move.
 *
 * Four-tier rendering precedence preserved at the shim:
 *   Tier 1: `entries[]` present — full timeline (entries passed through)
 *   Tier 3: completed/failed, no entries — result/error block (rendered as
 *           a one-line text entry plus the result-block footer)
 *   Tier 4: neither — empty state ("No detail available yet.")
 *
 * Tier 2 (running, no entries) was removed in `add-subagent-inspector` §14.
 *
 * See change: extract-minimal-chat-view (shim over MinimalChatView);
 * see change: add-subagent-inspector (tier structure).
 */

import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  type MinimalChatEntry,
  type MinimalChatStatus,
  MinimalChatView,
} from "@blackbelt-technology/pi-dashboard-client-utils/minimal-chat";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type React from "react";
import { type MutableRefObject, useRef } from "react";
import type { SubagentState, SubagentTimelineEntry } from "./types.js";

/** Minimal session-state shape this component cares about. */
export interface SessionStateLike {
  // Read-only: detail view only calls `.get(agentId)`. ReadonlyMap allows
  // passing the shell's frozen / upcast map without an extra clone.
  subagents: ReadonlyMap<string, SubagentState>;
}

export type SubagentDetailMode = "inline" | "popout" | "row";

export interface SubagentDetailViewProps {
  session: SessionStateLike;
  agentId: string;
  /** Default: "inline". `row` collapses to a single-line summary (no body). */
  mode?: SubagentDetailMode;
  /** Optional back-button handler (used in inline-popover-style usage). */
  onBack?: () => void;
  /** Forwarded to MinimalChatView so per-tool renderers can build session-scoped links. */
  sessionId?: string;
}

// ---- Adapters ----

function mapSubagentStatus(status: SubagentState["status"]): MinimalChatStatus {
  switch (status) {
    case "created":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "complete";
    case "failed":
      return "error";
    default: {
      const _exhaustive: never = status;
      void _exhaustive;
      return "pending";
    }
  }
}

function mapSubagentEntries(entries?: SubagentTimelineEntry[]): MinimalChatEntry[] {
  if (!entries) return [];
  // A streamed timeline can be sparse until every step has arrived (steps are
  // placed by index). See change: add-plugin-bridge-contributions (D7).
  return entries.filter(Boolean).map((e) => {
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

interface HeldTail {
  agentId: string;
  kind: "thinking" | "text";
  text: string;
  entryCount: number;
}

/**
 * Live tail, or the last one held until its finished entry has arrived.
 * The hold lives in the mounted view's ref, so it goes away with the view
 * (PR #831 review: a module-global map outlived closed inspectors).
 */
function heldLiveEntry(
  sub: SubagentState,
  isComplete: boolean,
  heldRef: MutableRefObject<HeldTail | undefined>,
): { kind: "thinking" | "text"; text: string } | undefined {
  const count = sub.entries?.length ?? 0;
  const tail = sub.liveTail;
  if (tail && tail.kind !== "none" && tail.text) {
    heldRef.current = { agentId: sub.id, kind: tail.kind, text: tail.text, entryCount: count };
    return { kind: tail.kind, text: tail.text };
  }
  const held = heldRef.current;
  if (!held || held.agentId !== sub.id) return undefined;
  if (isComplete || count > held.entryCount) {
    heldRef.current = undefined;
    return undefined;
  }
  return { kind: held.kind, text: held.text };
}

export function SubagentDetailView({
  session,
  agentId,
  mode = "inline",
  onBack,
  sessionId,
}: SubagentDetailViewProps) {
  const t = useT();
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  const heldTail = useRef<HeldTail | undefined>(undefined);
  const sub = session.subagents.get(agentId);
  if (!sub) {
    return (
      <div className="text-sm text-[var(--text-muted)] py-4 px-3 text-center">
        {t("subagentNotFound", undefined, "Subagent not found in this session.")}
      </div>
    );
  }

  const status = mapSubagentStatus(sub.status);
  const title = sub.displayName || sub.type;
  const hasEntries = Array.isArray(sub.entries) && sub.entries.length > 0;
  const isComplete = sub.status === "completed" || sub.status === "failed";

  // Row mode passthrough — MinimalChatView handles it.
  if (mode === "row") {
    return (
      <MinimalChatView
        title={title}
        status={status}
        entries={[]}
        mode="row"
        activity={sub.activity}
      />
    );
  }

  // In-progress streaming block (producer ≥ 0.2.7). `kind: "none"` / empty
  // text = nothing streaming. See change: stream-subagent-reasoning-and-stable-card.
  // The finished entry reaches the client only on the next resync, while the
  // tail clears at block end. Hold the last tail until the timeline grows so
  // the block never blinks out. Held per mounted view (ref keyed by agent id);
  // dropped on completion or once the timeline grows.
  // Delta stream (producer ≥ 0.4.0): the FULL in-progress block, growing like
  // the main chat; its finished entry arrives right after its final piece, so
  // no hold is needed. Otherwise fall back to the bounded tail.
  // See change: add-plugin-bridge-contributions (D8).
  const liveEntry =
    sub.liveBlock && !isComplete
      ? { kind: sub.liveBlock.kind, text: sub.liveBlock.text, growing: true }
      : heldLiveEntry(sub, isComplete, heldTail);

  // Tier resolution — pick entries / synthesized fallback / empty placeholder.
  let entries: MinimalChatEntry[];
  let emptyMessage: string | undefined;
  let footer: React.ReactNode = undefined;

  if (hasEntries) {
    // Tier 1
    entries = mapSubagentEntries(sub.entries);
    if (isComplete && sub.result) {
      footer = (
        <div className="mt-3 pt-2 border-t border-[var(--border-subtle)]">
          <div className="text-[11px] text-[var(--text-muted)] mb-1">{t("result", undefined, "Result")}</div>
          <MarkdownContent content={sub.result} />
        </div>
      );
    }
  } else if (isComplete && (sub.result || sub.error)) {
    // Tier 3 — no entries; synthesize body from description / error / result.
    entries = [];
    footer = (
      <div className="space-y-2">
        {sub.description && (
          <div className="text-[11px] text-[var(--text-secondary)]">"{sub.description}"</div>
        )}
        {sub.error && <div className="text-sm text-red-400">{sub.error}</div>}
        {sub.result && (
          <div>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
              {t("result", undefined, "Result")}
            </div>
            <MarkdownContent content={sub.result} />
          </div>
        )}
      </div>
    );
    // Suppress the default "No activity yet" — the footer carries the content.
    emptyMessage = "";
  } else {
    // Tier 4
    entries = [];
    emptyMessage = t("noDetailYet", undefined, "No detail available yet.");
  }

  return (
    <MinimalChatView
      title={title}
      subtitle={sub.agentMdPath}
      status={status}
      entries={entries}
      mode={mode === "popout" ? "popout" : "inline"}
      onBack={onBack}
      sessionId={sessionId}
      meta={{
        modelName:
          sub.modelName && sub.thinkingLevel
            ? `${sub.modelName} · thinking ${sub.thinkingLevel}`
            : sub.modelName,
        tokens: sub.tokens ? { input: sub.tokens.input, output: sub.tokens.output } : undefined,
        durationMs: isComplete ? sub.durationMs : undefined,
      }}
      emptyMessage={emptyMessage}
      footer={footer}
      activity={sub.activity}
      liveEntry={liveEntry}
      expandLastThinking={!isComplete}
    />
  );
}
