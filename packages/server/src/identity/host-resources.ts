/**
 * Non-session host-road classification taxonomy (openspec §7.3 / design D9,
 * D10). Every non-session host road carries a stable `{ action, resource }`
 * so the OPTIONAL host access policy can decide it. Session roads are NOT
 * classified here — they are owner-gated (D11).
 *
 * Actions are stable host constants grouped by resource family; the policy
 * plugin interprets them. Resource descriptors are bounded plain data that
 * name the target WITHOUT secrets (no tokens, no file contents).
 */

import type { HostAction, HostResource } from "@blackbelt-technology/pi-dashboard-shared/identity.js";

/** Stable host action constants, grouped by resource family. */
export const HostActions = {
  workspaceRead: "workspace.read",
  workspaceWrite: "workspace.write",
  openspecRead: "openspec.read",
  openspecWrite: "openspec.write",
  branchRead: "branch.read",
  branchWrite: "branch.write",
  terminalRead: "terminal.read",
  terminalCreate: "terminal.create",
  terminalWrite: "terminal.write",
  systemRead: "system.read",
  systemWrite: "system.write",
  /** A plugin-emitted global domain event (fan-out road, §10). */
  domainEvent: "domain.event",
} as const satisfies Record<string, HostAction>;

/** Bounded, secret-free resource descriptors per non-session road family. */
export const hostResource = {
  workspace: (path?: string): HostResource => ({ kind: "workspace", ...(path ? { path } : {}) }),
  openspec: (cwd?: string): HostResource => ({ kind: "openspec", ...(cwd ? { cwd } : {}) }),
  branch: (cwd?: string): HostResource => ({ kind: "branch", ...(cwd ? { cwd } : {}) }),
  terminal: (id?: string): HostResource => ({ kind: "terminal", ...(id ? { id } : {}) }),
  system: (): HostResource => ({ kind: "system" }),
  /** A plugin domain event; identifies the emitter + event type, never payload. */
  domain: (pluginId: string, eventType: string): HostResource => ({
    kind: "domain",
    pluginId,
    eventType,
  }),
} as const;
