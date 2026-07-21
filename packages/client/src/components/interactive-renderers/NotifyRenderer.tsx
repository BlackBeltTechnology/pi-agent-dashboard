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
 * Bridge wraps `ctx.ui.notify(message, level)` and emits a `prompt_request`
 * with this shape:
 *   prompt:    { question: <message>, type: "notify" }
 *   component: { type: "notify", props: { message, level } }
 *
 * `useMessageHandler` flattens these into reducer params as:
 *   params.title                          = msg.prompt.question  (= message)
 *   params._promptBusComponent.props.{message, level}
 *
 * Read defensively from all known shapes — `params.message` / `params.level`
 * (legacy direct emission), `params.title` (PromptBus question field), and
 * `params._promptBusComponent.props.*` (the canonical bridge wrapper output).
 *
 * See change: add-rpc-stdin-dispatch-with-keeper-sidecar — Path C made
 * extension `ctx.ui.notify` calls actually reach the dashboard for headless
 * sessions, exposing that this renderer was reading the wrong fields.
 */
export function NotifyRenderer({ params }: InteractiveRendererProps) {
  const componentProps = (params._promptBusComponent as { props?: { message?: string; level?: string } } | undefined)?.props;
  const message =
    (params.message as string | undefined) ??
    (params.title as string | undefined) ??
    componentProps?.message ??
    "";
  const level =
    (params.level as string | undefined) ??
    componentProps?.level ??
    "info";

  if (!message) return null;

  return (
    <div className={`mx-4 my-2 px-3 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] text-sm ${levelColors[level] ?? "text-[var(--text-secondary)]"}`}>
      <MarkdownContent content={message} />
    </div>
  );
}
