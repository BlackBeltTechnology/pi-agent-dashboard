/**
 * The provider stack `ChatView` requires (docs/embedding-chat-view.md). Mounted
 * ONLY standalone: an embedded host already provides the dashboard's own.
 * See change: add-team-plugin (D10/D16).
 */
import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { ActionList } from "@blackbelt-technology/pi-dashboard-client-utils/ActionList";
import { AgentCardShell } from "@blackbelt-technology/pi-dashboard-client-utils/AgentCardShell";
import { formatDuration, formatTokens } from "@blackbelt-technology/pi-dashboard-client-utils/agent-card-utils";
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { DialogPortal } from "@blackbelt-technology/pi-dashboard-client-utils/DialogPortal";
import { Popover } from "@blackbelt-technology/pi-dashboard-client-utils/Popover";
import { SearchableSelectDialog } from "@blackbelt-technology/pi-dashboard-client-utils/SearchableSelectDialog";
import { StatusPill } from "@blackbelt-technology/pi-dashboard-client-utils/StatusPill";
import { ZoomControls } from "@blackbelt-technology/pi-dashboard-client-utils/ZoomControls";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import {
  ApiContext,
  DisplayPrefsProvider,
  MobileProvider,
  SessionAssetsProvider,
  ThemeProvider,
  UiPrimitiveProvider,
} from "@blackbelt-technology/pi-dashboard-web/chat-embed";
// biome-ignore lint/correctness/noUndeclaredDependencies: vite/tsconfig alias to packages/client/src (vite.aliases.ts)
import { ThinkingBlock } from "@dash/components/chat/ThinkingBlock";
// biome-ignore lint/correctness/noUndeclaredDependencies: vite/tsconfig alias to packages/client/src (vite.aliases.ts)
import { ToolCallStep } from "@dash/components/chat/ToolCallStep";
// biome-ignore lint/correctness/noUndeclaredDependencies: vite/tsconfig alias to packages/client/src (vite.aliases.ts)
import { MarkdownContent } from "@dash/components/preview/MarkdownContent";
import type { FC, ReactNode } from "react";
import { Router } from "wouter";

const registry = createUiPrimitiveRegistry();
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.agentCard, AgentCardShell);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.markdownContent, MarkdownContent);
const ConfirmPrimitive: FC<{ message: string; confirmLabel?: string; onConfirm(): void; onCancel(): void }> = (p) => (
  <Confirm open onClose={p.onCancel} onConfirm={p.onConfirm} title="" message={p.message} confirmLabel={p.confirmLabel} testId="confirm-dialog" />
);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.confirmDialog, ConfirmPrimitive as never);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.dialog, Dialog);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.dialogPortal, DialogPortal);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.searchableSelectDialog, SearchableSelectDialog);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.zoomControls, ZoomControls);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatTokens, formatTokens);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.formatDuration, formatDuration);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.actionList, ActionList);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.statusPill, StatusPill);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.popover, Popover);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.toolCallStep, ((p: Record<string, unknown>) => (
  <ToolCallStep
    toolName={p.toolName as string}
    toolCallId={p.toolCallId as string}
    args={p.args as never}
    status={p.status as never}
    result={p.result as never}
    images={p.images as never}
    toolDetails={p.toolDetails as never}
    startedAt={p.startedAt as never}
    duration={p.duration as never}
    context={{ sessionId: p.sessionId as string }}
  />
)) as never);
registerUiPrimitive(registry, UI_PRIMITIVE_KEYS.thinkingBlock, ((p: Record<string, unknown>) => (
  <ThinkingBlock
    content={p.content as string}
    isStreaming={p.isStreaming as boolean}
    defaultExpanded={p.defaultExpanded as boolean}
    startedAt={p.startedAt as never}
    duration={p.duration as never}
  />
)) as never);

const DISPLAY_PREFS = { global: undefined, getSessionOverride: () => undefined };

export function ChatProviders({ apiBase, children }: { apiBase: string; children: ReactNode }) {
  return (
    <ApiContext.Provider value={apiBase}>
      <UiPrimitiveProvider value={registry}>
        <Router>
          <ThemeProvider>
            <MobileProvider>
              <SessionAssetsProvider assets={undefined}>
                <DisplayPrefsProvider value={DISPLAY_PREFS as never}>{children}</DisplayPrefsProvider>
              </SessionAssetsProvider>
            </MobileProvider>
          </ThemeProvider>
        </Router>
      </UiPrimitiveProvider>
    </ApiContext.Provider>
  );
}
