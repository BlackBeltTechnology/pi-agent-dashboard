/**
 * UI primitive registry — public contract types.
 *
 * Defines the stable string keys plugins use to look up dashboard-provided
 * UI primitives (components + helpers) at runtime via `useUiPrimitive(key)`.
 * Each key has a typed contract in `UiPrimitiveMap`; the contract is the
 * primitive's public API — adding optional props is non-breaking, renaming
 * or removing required props is breaking.
 *
 * The dashboard's main.tsx is responsible for registering an implementation
 * for every key in `UI_PRIMITIVE_KEYS`. The registry runtime itself lives in
 * `@blackbelt-technology/dashboard-plugin-runtime`; this file is just types
 * and key constants so it can be imported safely from any layer (no React
 * runtime cost for non-renderer consumers).
 *
 * See change: add-plugin-ui-primitive-registry.
 */
import type { ComponentType, ReactNode } from "react";
import type { ModelInfo } from "../types.js";

/**
 * Frozen set of stable string keys identifying registered UI primitives.
 *
 * Keys are namespaced under `ui:` so they're easy to grep and so future
 * registries (e.g. server-side or extension-specific) won't collide.
 *
 * Adding a key is non-breaking. Renaming or removing a key requires a
 * deprecation cycle (register both keys for one minor release with a
 * warning, then remove).
 */
export const UI_PRIMITIVE_KEYS = {
  /** Reusable card container with status-colored border, header, optional stats line. */
  agentCard: "ui:agent-card",
  /** Markdown renderer with code highlighting, math, mermaid, tables, lightbox. */
  markdownContent: "ui:markdown-content",
  /** Modal yes/no confirmation dialog. */
  confirmDialog: "ui:confirm-dialog",
  /** Base modal portal: renders children at `document.body` with body-scroll lock. */
  dialogPortal: "ui:dialog-portal",
  /** Typeahead-filtered selection dialog with keyboard navigation. */
  searchableSelectDialog: "ui:searchable-select-dialog",
  /** Zoom in/out/reset button group, paired with a zoom-pan controller. */
  zoomControls: "ui:zoom-controls",
  /** Format a token count as a human-readable string (e.g. 12000 → "12k"). */
  formatTokens: "ui:format-tokens",
  /** Format a duration in milliseconds as a human-readable string. */
  formatDuration: "ui:format-duration",
  /** Horizontal row of action buttons; used by intent-driven plugin contributions. */
  actionList: "ui:action-list",
  /** Status pill (badge) with state-tinted background + optional icon. */
  statusPill: "ui:status-pill",
  /** Model picker with provider filter, typeahead, keyboard navigation, pending-state. */
  modelSelector: "ui:model-selector",
  /** Floating panel anchored to a DOM element; dismisses on outside-click/Esc. */
  popover: "ui:popover",
  /** Rich tool-call card matching the main chat view (per-tool renderers,
   *  collapsible output, status icon). Used by plugin timelines that want
   *  parity with the dashboard chat tool rendering. */
  toolCallStep: "ui:tool-call-step",
  /** Reasoning / thinking block with collapsible content + elapsed-time badge.
   *  Matches the main chat view's thinking rendering. */
  thinkingBlock: "ui:thinking-block",
} as const;

/** Union of all valid UI primitive keys (literal-string narrowed). */
export type UiPrimitiveKey = (typeof UI_PRIMITIVE_KEYS)[keyof typeof UI_PRIMITIVE_KEYS];

// ── Public contract types ──────────────────────────────────────────────────

/**
 * Public prop signature for the agent-card primitive.
 *
 * Mirrors `AgentCardShell` in client-utils. Optional fields stay optional;
 * required fields stay required. Adding a new optional prop is non-breaking;
 * renaming `name` to `title` would be breaking.
 */
export interface UiAgentCardProps {
  name: string;
  status: string;
  headerRight?: ReactNode;
  stats?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  children?: ReactNode;
}

/** Public prop signature for the markdown-content primitive. */
export interface UiMarkdownContentProps {
  content: string;
}

/** Public prop signature for the confirm-dialog primitive. */
export interface UiConfirmDialogProps {
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Public prop signature for the dialog-portal primitive. */
export interface UiDialogPortalProps {
  children: ReactNode;
}

/**
 * One option in a searchable-select-dialog. Mirrors `SelectOption` in
 * client-utils so the existing component implementation is contract-compatible
 * without adapter shims.
 */
export interface UiSelectOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  badgeColor?: string;
}

/** Public prop signature for the searchable-select-dialog primitive. */
export interface UiSearchableSelectDialogProps {
  title: string;
  options: UiSelectOption[];
  onSelect: (value: string) => void;
  onCancel: () => void;
  placeholder?: string;
  emptyMessage?: string;
}

/** Public prop signature for the zoom-controls primitive. */
export interface UiZoomControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  scale: number;
}

/** A single entry in an action-list primitive. */
export interface UiActionListItem {
  /** Display label for the action button. */
  label: string;
  /** Optional MDI icon key from `@mdi/js` (e.g. `mdiPlay`). */
  icon?: string;
  /** Optional tooltip on hover. */
  tooltip?: string;
  /** Optional click handler (wired by IntentRenderer from action descriptor). */
  onClick?: () => void;
  /** Optional disabled flag. */
  disabled?: boolean;
}

/** Public prop signature for the action-list primitive. */
export interface UiActionListProps {
  actions: UiActionListItem[];
}

/** Stable state tokens for the status-pill primitive. */
export type UiStatusPillState =
  | "running"
  | "success"
  | "error"
  | "info"
  | "warn"
  | "muted";

/** Public prop signature for the status-pill primitive. */
export interface UiStatusPillProps {
  state: UiStatusPillState;
  text: string;
  /** Optional MDI icon key from `@mdi/js`. */
  icon?: string;
  /** Optional tooltip on hover. */
  tooltip?: string;
}

/**
 * Public prop signature for the model-selector primitive.
 *
 * Mirrors the existing `ModelSelector` component (`packages/client/src/
 * components/ModelSelector.tsx`) used by `StatusBar`. The primitive exposes
 * the same model-picker UX (provider filter, typeahead, keyboard navigation,
 * pending-state with 10 s timeout) to plugins without forcing them to depend
 * on the client package.
 *
 * Role/preset props that historically existed on `ModelSelector` are NOT part
 * of this contract — role management is a host concern (see
 * `BuiltInRolesSettings` in roles-plugin) layered on top.
 */
export interface UiModelSelectorProps {
  /** Currently-selected model label in `"<provider>/<id>"` form, or undefined. */
  current?: string;
  /** Available models. When undefined, the primitive renders non-interactive text. */
  models?: ModelInfo[];
  /** Invoked with the full `"<provider>/<id>"` string of the chosen model. */
  onSelect: (modelLabel: string) => void;
}

/**
 * Public prop signature for the popover primitive.
 *
 * A floating panel positioned relative to `anchorEl`. Dismisses on Esc or
 * clicks outside the popover (and outside the anchor). The host owns the
 * open/closed state; rendering the primitive at all is the "open" signal.
 *
 * Differs from `dialogPortal`: no scroll lock, no modal backdrop, position
 * is computed from the anchor's viewport rect (not centered).
 */
export interface UiPopoverProps {
  /** DOM element the popover is anchored to. */
  anchorEl: HTMLElement;
  /** Invoked when the user clicks outside or presses Esc. */
  onDismiss: () => void;
  /** Popover content (any React tree). */
  children: ReactNode;
  /** Optional gap (px) between anchor and popover edge. Default 6. */
  offset?: number;
}

// ── The map ────────────────────────────────────────────────────────────────

/**
 * Type-level mapping from each `UI_PRIMITIVE_KEYS` value to its public
 * implementation contract.
 *
 * Component contracts use `ComponentType<P>` (React functional or class
 * component); helper contracts use plain function signatures. The runtime
 * registry uses this map to type-check both registration and lookup.
 *
 * Adding a key: extend `UI_PRIMITIVE_KEYS` AND add the corresponding entry
 * here. TypeScript will fail builds that reference the new key without
 * matching registration in main.tsx.
 */
export interface UiPrimitiveMap {
  "ui:agent-card": ComponentType<UiAgentCardProps>;
  "ui:markdown-content": ComponentType<UiMarkdownContentProps>;
  "ui:confirm-dialog": ComponentType<UiConfirmDialogProps>;
  "ui:dialog-portal": ComponentType<UiDialogPortalProps>;
  "ui:searchable-select-dialog": ComponentType<UiSearchableSelectDialogProps>;
  "ui:zoom-controls": ComponentType<UiZoomControlsProps>;
  "ui:format-tokens": (n: number) => string;
  "ui:format-duration": (ms: number) => string;
  "ui:action-list": ComponentType<UiActionListProps>;
  "ui:status-pill": ComponentType<UiStatusPillProps>;
  "ui:model-selector": ComponentType<UiModelSelectorProps>;
  "ui:popover": ComponentType<UiPopoverProps>;
  "ui:tool-call-step": ComponentType<UiToolCallStepProps>;
  "ui:thinking-block": ComponentType<UiThinkingBlockProps>;
}

/**
 * Image attachment shape carried by tool-call rendering. Structurally
 * compatible with the shell's `ChatImage` and the shared
 * `ImageContent` (the `type: "image"` field is optional here so plugins
 * don't need to manufacture it).
 */
export interface UiToolCallImage {
  data: string;
  mimeType: string;
}

/**
 * Public prop signature for the rich tool-call card. The shell registers
 * an implementation backed by its `ToolCallStep` component (which fans
 * out to per-tool renderers — Bash, Read, Edit, Write, Agent, AskUser,
 * Generic). Optional fields stay optional; required fields stay required.
 */
export interface UiToolCallStepProps {
  toolName: string;
  /** Identifier used by per-tool renderers to scope click handlers; synthetic ids are fine. */
  toolCallId: string;
  args?: Record<string, unknown>;
  status: "running" | "complete" | "error";
  result?: string;
  images?: UiToolCallImage[];
  toolDetails?: Record<string, unknown>;
  startedAt?: number;
  duration?: number;
  /** Session id passed through to per-tool renderers that need session scope. */
  sessionId?: string;
}

/** Public prop signature for the thinking-block primitive. */
export interface UiThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
  startedAt?: number;
  duration?: number;
}
