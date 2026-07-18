import React from "react";
import ReactDOM from "react-dom/client";
import { Router } from "wouter";
import App from "./App.js";
import { ThemeProvider } from "./components/settings/ThemeProvider.js";
import { MobileProvider } from "./hooks/useMobile.js";
import { I18nProvider } from "./lib/i18n/i18n.js";
import "./index.css";
// KaTeX styles for LaTeX math rendering in MarkdownContent.
// See change: chat-markdown-local-images-and-math.
import "katex/dist/katex.min.css";

import {
  createUiPrimitiveRegistry,
  registerUiPrimitive,
  UiPrimitiveProvider,
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
// UI primitive registry — see change: add-plugin-ui-primitive-registry.
// The dashboard registers each declared primitive synchronously at startup;
// plugin slot contributions look them up via `useUiPrimitive(key)`. Adding
// a key in shared/ui-primitives.ts requires adding a registration here.
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { MarkdownContent } from "./components/preview/MarkdownContent.js";
import { ModelSelector } from "./components/settings/ModelSelector.js";
import { PairLanding } from "./components/connectivity/PairLanding.js";
import { ThinkingBlock } from "./components/chat/ThinkingBlock.js";
import { ToolCallStep } from "./components/chat/ToolCallStep.js";
import { installDeviceAuthFetch } from "./lib/pairing/device-auth.js";

const primitiveRegistry = createUiPrimitiveRegistry();
registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.agentCard, AgentCardShell);
registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.markdownContent, MarkdownContent);
// `confirmDialog` primitive — re-skinned over the unified `Confirm`/`Dialog`
// without changing the narrow contract plugins depend on. Maps the registry's
// `onCancel` to `Confirm`'s `onClose`, supplies no title (always open while
// rendered), and lets `Confirm`'s default primary intent apply.
// See change: unify-dialog-system.
const ConfirmDialogPrimitive: React.FC<UiConfirmDialogProps> = ({
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}) => (
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
registerUiPrimitive(
  primitiveRegistry,
  UI_PRIMITIVE_KEYS.confirmDialog,
  ConfirmDialogPrimitive,
);
registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.dialog, Dialog);
registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.dialogPortal, DialogPortal);
registerUiPrimitive(
  primitiveRegistry,
  UI_PRIMITIVE_KEYS.searchableSelectDialog,
  SearchableSelectDialog,
);
registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.zoomControls, ZoomControls);
registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.formatTokens, formatTokens);
registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.formatDuration, formatDuration);
registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.actionList, ActionList);
registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.statusPill, StatusPill);
registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.modelSelector, ModelSelector);
registerUiPrimitive(primitiveRegistry, UI_PRIMITIVE_KEYS.popover, Popover);

// `toolCallStep` primitive — plugin timelines (e.g. flow-plugin's
// MinimalChatView) consume this to render tool calls with the same
// per-tool renderers and visual style as the main chat view. The
// shell's `ToolCallStep` requires a `ToolContext` (editors list, cwd,
// session) plus `onAbort` / `onForceKill`; popout/inline views can't
// abort tools, so we adapt the primitive to omit those and supply a
// minimal context. See change: fix-flows-plugin-polish (chat-view parity).
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
    context={{ sessionId: props.sessionId }}
  />
);
registerUiPrimitive(
  primitiveRegistry,
  UI_PRIMITIVE_KEYS.toolCallStep,
  ToolCallStepPrimitive,
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
registerUiPrimitive(
  primitiveRegistry,
  UI_PRIMITIVE_KEYS.thinkingBlock,
  ThinkingBlockPrimitive,
);

// Teach the dashboard's HTTP layer to present a paired-device bearer (if this
// browser paired via `/pair`). Installed before any fetch fires so every
// same-origin `/api/*` request carries the bearer.
// See change: make-pairing-qr-camera-scannable.
installDeviceAuthFetch();

// `/pair` — the phone-camera pairing landing. A scanned pairing QR opens
// `https://<tls-endpoint>/pair#<payload>`; this route decodes the fragment and
// runs the challenge→redeem→confirm→poll handshake standalone (no dashboard WS
// connection needed). Rendered instead of <App/> so it works pre-auth.
const isPairRoute = window.location.pathname === "/pair";

// Register service worker for PWA installability
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UiPrimitiveProvider value={primitiveRegistry}>
      <Router>
        <ThemeProvider>
          <I18nProvider>
            <MobileProvider>
              {isPairRoute ? <PairLanding /> : <App />}
            </MobileProvider>
          </I18nProvider>
        </ThemeProvider>
      </Router>
    </UiPrimitiveProvider>
  </React.StrictMode>
);
