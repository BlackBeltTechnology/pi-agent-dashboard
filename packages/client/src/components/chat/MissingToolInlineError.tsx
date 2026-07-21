/**
 * MissingToolInlineError — one-line in-chat error for a missing tool.
 *
 * Rendered when a `!`/`!!` shell-escape resolves no shell binary (the
 * bridge emits a `bash_output` event carrying a `missingTool` payload).
 * The `[Install <tool> →]` action deep-links into Settings → Tools,
 * scrolls the matching row into view, and opens its `[Install ▾]`
 * dropdown.
 *
 * See change: register-bash-and-tool-install-help.
 */
import React from "react";
import { useLocation } from "wouter";
import { Icon } from "@mdi/react";
import { mdiAlertCircleOutline, mdiArrowRight } from "@mdi/js";
import { requestToolInstall } from "../../lib/package/tool-install-deeplink.js";

export function MissingToolInlineError({ toolName }: { toolName: string }) {
  const [, navigate] = useLocation();

  const onInstall = () => {
    // Flag the target BEFORE navigating so ToolsSection picks it up on
    // mount even if it is not yet listening for the window event.
    requestToolInstall(toolName);
    navigate("/settings/developer");
  };

  return (
    <div
      data-testid="missing-tool-inline-error"
      className="flex items-center gap-2 text-xs text-amber-500 border border-amber-500/40 rounded px-2 py-1 my-1"
    >
      <Icon path={mdiAlertCircleOutline} size={0.6} />
      <span className="text-[var(--text-secondary)]">
        <span className="font-mono">{toolName}</span> not found.
      </span>
      <button
        onClick={onInstall}
        className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 border border-amber-500/40 rounded hover:bg-amber-500/10"
        title={`Install ${toolName} via Settings → Tools`}
      >
        Install {toolName} <Icon path={mdiArrowRight} size={0.5} />
      </button>
    </div>
  );
}
