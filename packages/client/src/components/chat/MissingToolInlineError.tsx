/**
 * MissingToolInlineError — one-line in-chat error for a missing tool.
 *
 * Rendered when a `!`/`!!` shell-escape resolves no shell binary (the
 * bridge emits a `bash_output` event carrying a `missingTool` payload).
 * The `[Install <tool> →]` action deep-links into Settings → Tools,
 * scrolls the matching row into view, and opens its `[Install ▾]`
 * dropdown.
 *
 * Rendered via the shared `InlineMessage` compact/warning variant.
 * See change: register-bash-and-tool-install-help; redesign-directory-card.
 */
import { mdiAlertCircleOutline, mdiArrowRight } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useLocation } from "wouter";
import { requestToolInstall } from "../../lib/package/tool-install-deeplink.js";
import { InlineMessage } from "../primitives/InlineMessage.js";

export function MissingToolInlineError({ toolName }: { toolName: string }) {
  const [, navigate] = useLocation();

  const onInstall = () => {
    // Flag the target BEFORE navigating so ToolsSection picks it up on
    // mount even if it is not yet listening for the window event.
    requestToolInstall(toolName);
    navigate("/settings/developer");
  };

  return (
    <div className="my-1">
      <InlineMessage
        severity="warning"
        variant="compact"
        icon={mdiAlertCircleOutline}
        testId="missing-tool-inline-error"
        title={
          <>
            <span className="font-mono">{toolName}</span> not found
          </>
        }
        actions={
          <button
            type="button"
            onClick={onInstall}
            className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border border-current"
            title={`Install ${toolName} via Settings → Tools`}
          >
            Install {toolName} <Icon path={mdiArrowRight} size={0.5} />
          </button>
        }
      />
    </div>
  );
}
