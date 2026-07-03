/**
 * Typed prop contracts for each slot id.
 *
 * Every slot consumer passes exactly the props defined here to each contribution
 * component. Plugins receive only the props for the slot they claim.
 *
 * NOTE: PluginContext is imported as a type-only forward reference so this
 * shared package doesn't depend on the runtime package. The runtime package
 * will re-export this map with the concrete PluginContext type filled in.
 */
import type { DashboardSession } from "../types.js";
import type { SlotId } from "./slot-types.js";

/**
 * Opaque marker type for PluginContext.
 * The concrete type is defined in @blackbelt-technology/dashboard-plugin-runtime/context.
 * Using `unknown` here keeps this shared types-only package free of runtime deps.
 */
export type AnyPluginContext = unknown;

/** Folder descriptor passed to sidebar-folder-section slot. */
export interface FolderDescriptor {
  cwd: string;
  label?: string;
}

/**
 * Image payload forwarded to `tool-renderer` plugins. Structural mirror of the
 * client's `ChatImage` (kept inline so this types-only package stays free of a
 * client dependency). See change: wire-tool-renderer-slot.
 */
export interface ToolRendererImage {
  data: string;
  mimeType: string;
}

/**
 * Tool execution context forwarded to `tool-renderer` plugins. Structural
 * mirror of the client's `ToolContext`. `editors` / `session` are intentionally
 * loose (`unknown[]` / `unknown`) so the shared package avoids importing client
 * types. See change: wire-tool-renderer-slot.
 */
export interface ToolRendererContext {
  cwd?: string;
  editors?: unknown[];
  sessionId?: string;
  session?: unknown;
}

/** Map of slot id → props type for that slot's contributions. */
export interface SlotPropsMap {
  "sidebar-folder-section": {
    folder: FolderDescriptor;
    pluginContext: AnyPluginContext;
  };
  "worktree-card-section": {
    folder: FolderDescriptor;
    pluginContext: AnyPluginContext;
  };
  "session-card-badge": {
    session: DashboardSession;
    pluginContext: AnyPluginContext;
  };
  "session-card-action-bar": {
    session: DashboardSession;
    pluginContext: AnyPluginContext;
  };
  "session-card-memory": {
    session: DashboardSession;
    pluginContext: AnyPluginContext;
  };
  "session-card-flows": {
    session: DashboardSession;
    pluginContext: AnyPluginContext;
  };
  "workspace-action-bar": {
    session: DashboardSession;
    pluginContext: AnyPluginContext;
  };
  "content-view": {
    session: DashboardSession;
    routeParams: Record<string, string>;
    onClose: () => void;
    pluginContext: AnyPluginContext;
  };
  "content-header-sticky": {
    session: DashboardSession;
    pluginContext: AnyPluginContext;
  };
  "content-inline-footer": {
    session: DashboardSession;
    pluginContext: AnyPluginContext;
  };
  "anchored-popover": {
    anchorEl: HTMLElement;
    onDismiss: () => void;
    pluginContext: AnyPluginContext;
  };
  "command-route": {
    session: DashboardSession;
    routeParams: Record<string, string>;
    onClose: () => void;
    pluginContext: AnyPluginContext;
  };
  "shell-overlay-route": {
    params: Record<string, string>;
    /** DashboardSession metadata resolved from the URL’s session param (`config.sessionParam`, default `"sid"`). Undefined when the URL has no session id or no matching session. */
    session?: DashboardSession;
    onBack: () => void;
    pluginContext: AnyPluginContext;
  };
  "settings-section": {
    pluginContext: AnyPluginContext;
  };
  "tool-renderer": {
    toolName: string;
    toolInput: Record<string, unknown>;
    sessionId: string;
    pluginContext: AnyPluginContext;
    // ─── newly optional (mirror built-in ToolRendererProps) ───
    // See change: wire-tool-renderer-slot.
    status?: "running" | "complete" | "error";
    result?: string;
    toolDetails?: Record<string, unknown>;
    images?: ToolRendererImage[];
    context?: ToolRendererContext;
  };
  // Descriptor-only slots don't have React props (consumed by extension-ui-system)
  "management-modal": Record<string, unknown>;
  "footer-segment": Record<string, unknown>;
  "agent-metric": Record<string, unknown>;
  "breadcrumb": Record<string, unknown>;
  "gate": Record<string, unknown>;
  "toast": Record<string, unknown>;
  "rjsf-form": Record<string, unknown>;
}

/** Get the props type for a specific slot id. */
export type SlotProps<S extends SlotId> = SlotPropsMap[S];

// Type-level test: assert SlotPropsMap covers every SlotId.
// This will produce a TS error if any SlotId is not in SlotPropsMap.
type _AssertAllSlotsCovered = {
  [K in SlotId]: SlotPropsMap[K];
};
