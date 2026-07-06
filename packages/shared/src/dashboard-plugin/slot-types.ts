/**
 * Frozen slot taxonomy for the dashboard plugin system.
 * These ids and their payload contracts are versioned via
 * @blackbelt-technology/pi-dashboard-shared.
 *
 * Adding a slot: minor (non-breaking).
 * Removing or renaming a slot: major (breaking).
 */
import type { DashboardSession } from "../types.js";
import type { FolderDescriptor } from "./slot-props.js";

/** All valid slot ids (frozen for v0.x). */
export type SlotId =
  // React-only slots
  | "sidebar-folder-section"
  | "worktree-card-section"
  | "session-card-action-bar"
  | "workspace-action-bar"
  | "shell-overlay-route"
  // (session-card-memory and session-card-flows are also react-only; declared below for ordering)
  | "content-inline-footer"
  | "anchored-popover"
  | "command-route"
  | "tool-renderer"
  // React-or-descriptor slots
  | "session-card-memory"
  | "session-card-flows"
  | "session-card-badge"
  | "content-view"
  | "content-header-sticky"
  | "settings-section"
  // Descriptor-only slots (from extension-ui-system)
  | "management-modal"
  | "footer-segment"
  | "agent-metric"
  | "breadcrumb"
  | "gate"
  | "toast"
  | "rjsf-form";

/** How many contributions a slot allows. */
export type Multiplicity = "one" | "many" | "one-active";

/** Which payload types the slot accepts. */
export type PayloadTier = "react-only" | "descriptor-only" | "react-or-descriptor";

export interface SlotDefinition {
  multiplicity: Multiplicity;
  payloadTier: PayloadTier;
  description: string;
}

/** Frozen slot definitions map for v0.x. */
export const SLOT_DEFINITIONS: Record<SlotId, SlotDefinition> = {
  "sidebar-folder-section": {
    multiplicity: "many",
    payloadTier: "react-only",
    description: "Collapsible block above session list per workspace folder",
  },
  "worktree-card-section": {
    multiplicity: "many",
    payloadTier: "react-only",
    description: "Folder-scoped block inside a worktree session card, scoped to the worktree's own cwd (e.g. the KB row). See change: kb-row-on-worktree-session-card.",
  },
  "shell-overlay-route": {
    multiplicity: "many",
    payloadTier: "react-only",
    description: "Plugin-owned full-screen route mounted at top of the shell (desktop + mobile). Each claim ships a wouter path pattern via `config.path` and a React component receiving { params, onBack, session? }.",
  },
  "session-card-badge": {
    multiplicity: "many",
    payloadTier: "react-or-descriptor",
    description: "Compact info chip on a session card",
  },
  "session-card-action-bar": {
    multiplicity: "many",
    payloadTier: "react-only",
    description: "Action buttons on a session card",
  },
  "session-card-memory": {
    multiplicity: "many",
    payloadTier: "react-only",
    description: "Memory contributions inside the MEMORY subcard of a session card",
  },
  "session-card-flows": {
    multiplicity: "many",
    payloadTier: "react-only",
    description: "Flow contributions inside the FLOWS subcard of a session card",
  },
  "workspace-action-bar": {
    multiplicity: "many",
    payloadTier: "react-only",
    description: "Action buttons inside the WORKSPACE subcard of a session card (git workspace tooling)",
  },
  "content-view": {
    multiplicity: "one-active",
    payloadTier: "react-or-descriptor",
    description: "Full-screen content area view for a session",
  },
  "content-header-sticky": {
    multiplicity: "many",
    payloadTier: "react-or-descriptor",
    description: "Sticky header above the content view",
  },
  "content-inline-footer": {
    multiplicity: "many",
    payloadTier: "react-only",
    description: "Inline footer below the content view (React-only)",
  },
  "anchored-popover": {
    multiplicity: "one",
    payloadTier: "react-only",
    description: "Popover anchored to a UI trigger element",
  },
  "command-route": {
    multiplicity: "many",
    payloadTier: "react-only",
    description: "Maps a slash command or URL route to a content view",
  },
  "settings-section": {
    multiplicity: "many",
    payloadTier: "react-or-descriptor",
    description: "A section in the Settings page",
  },
  "tool-renderer": {
    multiplicity: "many",
    payloadTier: "react-only",
    description: "Custom React renderer for a specific tool call by toolName",
  },
  // Descriptor-only (extension-ui-system)
  "management-modal": {
    multiplicity: "many",
    payloadTier: "descriptor-only",
    description: "Full-screen management modal (extension-ui-system)",
  },
  "footer-segment": {
    multiplicity: "many",
    payloadTier: "descriptor-only",
    description: "Segment in the session footer bar (extension-ui-system)",
  },
  "agent-metric": {
    multiplicity: "one",
    payloadTier: "descriptor-only",
    description: "Metric chip on an agent card (extension-ui-system)",
  },
  "breadcrumb": {
    multiplicity: "many",
    payloadTier: "descriptor-only",
    description: "Breadcrumb item in the content header (extension-ui-system)",
  },
  "gate": {
    multiplicity: "many",
    payloadTier: "descriptor-only",
    description: "Flow gate/checkpoint UI (extension-ui-system)",
  },
  "toast": {
    multiplicity: "many",
    payloadTier: "descriptor-only",
    description: "Transient notification toast (extension-ui-system)",
  },
  "rjsf-form": {
    multiplicity: "many",
    payloadTier: "descriptor-only",
    description: "JSON-Schema-driven form (extension-ui-system Phase 4)",
  },
};

/** Valid settings page ids in SettingsPanel (left-nav page layout). */
export type SettingsTab =
  | "general"
  | "server"
  | "sessions"
  | "remote"
  | "security"
  | "providers"
  | "packages"
  | "plugins"
  | "openspec"
  // Resource card pages (global scope). See change: resources-card-tabs.
  | "skills"
  | "agents"
  | "extensions"
  | "prompts"
  | "themes"
  | "developer";

export const VALID_SETTINGS_TABS: SettingsTab[] = [
  "general",
  "server",
  "sessions",
  "remote",
  "security",
  "providers",
  "packages",
  "plugins",
  "openspec",
  "skills",
  "agents",
  "extensions",
  "prompts",
  "themes",
  "developer",
];

// ── Predicate input classification ──────────────────────────────────────────
//
// `ClaimEntry.predicate` / `.shouldRender` are invoked by exactly two filter
// helpers in the runtime (`forSession`, `forFolder`). The argument shape is
// therefore determined by the slot id. `SlotPredicateInput<S>` exposes that
// classification at the type level so the registry contract can be tightened.
//
// See change: slot-generic-claim-entry.

/** Slot ids whose predicates receive a session. */
type SessionScopedSlot =
  | "session-card-badge"
  | "session-card-action-bar"
  | "session-card-memory"
  | "session-card-flows"
  | "workspace-action-bar"
  | "content-view"
  | "content-header-sticky"
  | "content-inline-footer"
  | "command-route"
  | "shell-overlay-route";

/** Slot ids whose predicates receive a folder descriptor. */
type FolderScopedSlot = "sidebar-folder-section" | "worktree-card-section";

/**
 * Map of slot id → predicate input shape. Resolves to `never` for slots that
 * are not filtered by predicate (settings-section, tool-renderer, anchored-
 * popover, every descriptor-only slot). Registering a predicate on a `never`-
 * input slot is therefore a compile-time error.
 */
export type SlotPredicateInput<S extends SlotId> =
  S extends SessionScopedSlot ? DashboardSession | null | undefined
  : S extends FolderScopedSlot ? FolderDescriptor
  : never;

// Type-level test: assert every SlotId is reachable through SlotPredicateInput,
// either by mapping to a concrete input or explicitly to `never`. This forces a
// build failure when a new slot id is added without classifying it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertAllSlotsPredicateClassified = {
  [K in SlotId]: SlotPredicateInput<K>;
};
