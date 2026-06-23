/**
 * Shared automation types — used by the server scheduler/scanner/run-store
 * and the client board/editor.
 *
 * See change: add-automation-plugin.
 */

export type AutomationScope = "folder" | "global";
export type Visibility = "hidden" | "shown";
export type RunMode = "worktree" | "local";
export type Sandbox = "read-only" | "workspace-write" | "full-access";
export type Concurrency = "skip" | "queue" | "parallel";

/** The `on:` trigger block. `kind` selects the registered TriggerType (the
 *  event *category*); the remaining fields are kind-specific (e.g. `cron` for
 *  `schedule`). For multi-type categories, `events` lists the selected event
 *  types (e.g. `openspec` → [`change.archived`, `change.validated`]). */
export interface AutomationTrigger {
  kind: string;
  /** Selected event types for multi-type categories. Absent for `scheduled`. */
  events?: string[];
  [field: string]: unknown;
}

/** Read-only descriptor for one event *type* within a category, exposed to the
 *  client so the editor can render a level-2 multi-select checklist. */
export interface TriggerEventDescriptor {
  /** Machine event id, e.g. "change.archived". */
  event: string;
  /** Human label, e.g. "Change archived". */
  label: string;
  /** "enabled" when wired/handled; "planned" when advertised but not yet wired. */
  status: "enabled" | "planned";
}

/** Read-only descriptor for one event *category* (level-1 trigger taxonomy),
 *  exposed to the client so the editor can render a category tab strip. */
export interface TriggerCategoryDescriptor {
  /** Machine category id, e.g. "scheduled" | "openspec". */
  category: string;
  /** Human label, e.g. "Scheduled" | "OpenSpec". */
  label: string;
  /** "enabled" when at least the category itself is wired; "planned" otherwise. */
  status: "enabled" | "planned";
  /** Selectable event types within this category (empty for `scheduled`). */
  events: TriggerEventDescriptor[];
}

/** The `action:` block. `prompt` is a path (relative to the automation dir);
 *  `skill` is a `$skill-name` token. */
export interface AutomationAction {
  kind: "prompt" | "skill";
  prompt?: string;
  skill?: string;
}

/** A fully-parsed, valid `automation.yaml`. */
export interface AutomationConfig {
  on: AutomationTrigger;
  action: AutomationAction;
  model: string;
  mode: RunMode;
  sandbox: Sandbox;
  concurrency: Concurrency;
  visibility?: Visibility;
  /** When true the automation is parsed/valid but NOT armed (Enable/Disable
   *  toggle on the board). Absent = enabled. See change:
   *  redesign-automation-editor-and-board. */
  disabled?: boolean;
}

/** A discovered automation on disk — valid or invalid (isolated failure). */
export interface DiscoveredAutomation {
  /** Folder name (the `<name>` directory). */
  name: string;
  scope: AutomationScope;
  /** Absolute path to the automation's directory. */
  dir: string;
  /** Parsed config when `valid`; undefined when invalid. */
  config?: AutomationConfig;
  valid: boolean;
  /** Human-readable validation error when `!valid`. */
  error?: string;
}

/** Run status surfaced in the Triage list. */
export type RunStatus = "running" | "done" | "error";

/** A run record persisted under `<scope>/.pi/automation/runs/<runId>/`. */
export interface RunRecord {
  /** `<date>-<name>` store key, unique per occurrence. */
  runId: string;
  /** Automation folder name. */
  name: string;
  status: RunStatus;
  /** Absolute path to the run dir. */
  dir: string;
  /** Epoch ms. */
  startedAt: number;
  endedAt?: number;
  /** True when the run produced no findings and was auto-archived. */
  archived?: boolean;
  /** Session id of the spawned run (for ChatView monitoring). */
  sessionId?: string;
  /** Last error message when `status==="error"`. */
  error?: string;
}
