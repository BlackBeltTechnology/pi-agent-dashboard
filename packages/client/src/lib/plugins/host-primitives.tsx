/**
 * `createHostPrimitiveRegistry()` — the dashboard's full UI primitive registry
 * (one registration per `UI_PRIMITIVE_KEYS` entry), built with no parameters.
 *
 * Single source for `main.tsx` (the app) and `chat-embed` (a standalone embed
 * such as team-app wraps its tree in `<UiPrimitiveProvider value={...}>`), so
 * embeds stop copying the registration list. Shell-bound wrappers keep their
 * optional-context form (no `<App>` needed): `ui:model-selector` reads
 * `useModelConfigOptional()`, so an embed (which provides no
 * `ModelConfigContext`) gets no favorites / refresh / provider-settings link
 * while the caller's list still renders.
 *
 * See change: decouple-plugins-from-core (D8).
 */
import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  type UiPrimitiveRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { ActionList } from "@blackbelt-technology/pi-dashboard-client-utils/ActionList";
import { AgentCardShell } from "@blackbelt-technology/pi-dashboard-client-utils/AgentCardShell";
import {
  formatDuration,
  formatTokens,
} from "@blackbelt-technology/pi-dashboard-client-utils/agent-card-utils";
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { DialogPortal } from "@blackbelt-technology/pi-dashboard-client-utils/DialogPortal";
import { Popover } from "@blackbelt-technology/pi-dashboard-client-utils/Popover";
import { SearchableSelectDialog } from "@blackbelt-technology/pi-dashboard-client-utils/SearchableSelectDialog";
import { StatusPill } from "@blackbelt-technology/pi-dashboard-client-utils/StatusPill";
import { ZoomControls } from "@blackbelt-technology/pi-dashboard-client-utils/ZoomControls";
import type {
  UiConfirmDialogProps,
  UiThinkingBlockProps,
  UiToolCallStepProps,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
// Adding a key in shared/ui-primitives.ts requires adding a registration here.
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type React from "react";
import { ThinkingBlock } from "../../components/chat/ThinkingBlock.js";
import { ToolCallStep } from "../../components/chat/ToolCallStep.js";
import { MarkdownContent } from "../../components/preview/MarkdownContent.js";
import { LogBlock } from "../../components/primitives/LogBlock.js";
import { PathPickerDialog } from "../../components/primitives/PathPickerDialog.js";
import { ElapsedBadge } from "../../components/session/ElapsedBadge.js";
import { OAuthFlowView } from "../../components/settings/OAuthFlowView.js";
import { makeToolContext } from "../../components/tool-renderers/make-tool-context.js";
import { ChatViewPrimitive } from "./chat-view-primitive.js";
import { ModelSelectorPrimitive, ThinkingLevelSelectorPrimitive } from "./shell-primitives.js";

// `confirmDialog` primitive — re-skinned over the unified `Confirm`/`Dialog`
// without changing the narrow contract plugins depend on. Maps the registry's
// `onCancel` to `Confirm`'s `onClose`, supplies no title (always open while
// rendered), and lets `Confirm`'s default primary intent apply.
// See change: unify-dialog-system.
const ConfirmDialogPrimitive: React.FC<UiConfirmDialogProps> = ({ message, confirmLabel, onConfirm, onCancel }) => (
  <Confirm
    open
    onClose={onCancel}
    onConfirm={onConfirm}
    title=""
    message={message}
    confirmLabel={confirmLabel}
    testId="confirm-dialog"
  />
);

// `toolCallStep` primitive — plugin timelines (e.g. flow-plugin's
// MinimalChatView) render tool calls with the same per-tool renderers as the
// main chat. The shell's `ToolCallStep` needs a `ToolContext` plus
// `onAbort` / `onForceKill`; popout/inline views cannot abort tools, so the
// primitive omits those and supplies a minimal context.
// See change: fix-flows-plugin-polish (chat-view parity).
const ToolCallStepPrimitive: React.FC<UiToolCallStepProps> = (props) => (
  <ToolCallStep
    toolName={props.toolName}
    toolCallId={props.toolCallId}
    args={props.args}
    status={props.status}
    result={props.result}
    images={props.images}
    toolDetails={props.toolDetails}
    startedAt={props.startedAt}
    duration={props.duration}
    context={makeToolContext({ sessionId: props.sessionId })}
  />
);

const ThinkingBlockPrimitive: React.FC<UiThinkingBlockProps> = (props) => (
  <ThinkingBlock
    content={props.content}
    isStreaming={props.isStreaming}
    defaultExpanded={props.defaultExpanded}
    startedAt={props.startedAt}
    duration={props.duration}
  />
);

/** Build the registry with every `UI_PRIMITIVE_KEYS` entry registered. No parameters. */
export function createHostPrimitiveRegistry(): UiPrimitiveRegistry {
  const registry = createUiPrimitiveRegistry();
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.agentCard, AgentCardShell);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.markdownContent, MarkdownContent);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.confirmDialog, ConfirmDialogPrimitive);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.dialog, Dialog);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.dialogPortal, DialogPortal);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.searchableSelectDialog, SearchableSelectDialog);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.zoomControls, ZoomControls);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatTokens, formatTokens);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatDuration, formatDuration);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.actionList, ActionList);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.statusPill, StatusPill);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.popover, Popover);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.logBlock, LogBlock);
  // Generic OAuth sign-in flow body for plugin settings sections.
  // See change: expose-plugin-credential-and-oauth-seams (D6).
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.oauthFlow, OAuthFlowView);
  // Folder picker for plugin settings (transient input; soft hook only).
  // See change: improve-kb-settings-sources-and-search.
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.pathPicker, PathPickerDialog);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.toolCallStep, ToolCallStepPrimitive);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.modelSelector, ModelSelectorPrimitive);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.thinkingLevelSelector, ThinkingLevelSelectorPrimitive);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.thinkingBlock, ThinkingBlockPrimitive);
  // Self-providing primitives (no second UiPrimitiveProvider).
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.chatView, ChatViewPrimitive);
  registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.elapsedBadge, ElapsedBadge);
  return registry;
}
