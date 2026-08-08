import React from "react";
import type { InteractiveRendererProps } from "./types.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";

const levelColors: Record<string, string> = {
  info: "text-blue-400",
  success: "text-green-400",
  warning: "text-yellow-400",
  error: "text-red-400",
};

/**
 * Renders `ctx.ui.notify(...)` calls forwarded by the bridge as a chat row.
 *
 * Reached through the interactive-renderer registry from the `interactiveUi`
 * row the notify reducer appends. Notify no longer rides the prompt envelope,
 * so the canonical shape is `params.message` / `params.level`.
 * `params.title` remains as the fallback for a row reduced from a pre-split
 * `prompt_request { prompt.type: "notify" }` that is still in a client's state.
 *
 * See change: split-notify-from-prompt-request.
 */
export function NotifyRenderer({ params }: InteractiveRendererProps) {
  // Validate rather than cast: params cross the wire, and a non-string message
  // would reach MarkdownContent. See change: split-notify-from-prompt-request.
  const message =
    typeof params.message === "string"
      ? params.message
      : typeof params.title === "string"
        ? params.title
        : "";
  const level = typeof params.level === "string" && params.level in levelColors
    ? params.level
    : "info";

  if (!message) return null;

  return (
    <div className={`mx-4 my-2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-sm ${levelColors[level] ?? "text-[var(--text-secondary)]"}`}>
      <MarkdownContent content={message} />
    </div>
  );
}
