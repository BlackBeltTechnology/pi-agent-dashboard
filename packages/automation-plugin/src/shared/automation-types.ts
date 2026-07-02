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
 *  `skill` is a `$skill-name` token.
 *
 *  `kind` accepts any registered action id of the form `<source>.<verb>`
 *  (e.g. `flows.run`). The built-ins `core.prompt` / `core.skill` keep their
 *  `prompt` / `skill` companion fields; bare `prompt` / `skill` in existing
 *  files normalize to the `core.*` ids. Plugin-registered actions carry their
 *  values in `payload`. See change: register-plugin-automation-events. */
export interface AutomationAction {
  kind: string;
  prompt?: string;
  skill?: string;
  /** Schema-driven values for plugin-registered actions. */
  payload?: Record<string, unknown>;
}

/** Bare `action.kind` aliases that map to the built-in `core.*` actions.
 *  Single source of truth for read-path + write-path validation and the
 *  registry's `normalizeActionKind`. See change: register-plugin-automation-events. */
export const BUILTIN_ACTION_ALIASES = { prompt: "core.prompt", skill: "core.skill" } as const;

/** One field in an action's payload schema. `enum` options are resolved
 *  per-cwd server-side and sent to the client already-populated.
 *  `type` is a CLOSED, versioned primitive set: the client renders one
 *  control per known type and falls back to a text input for an unrecognized
 *  type (forward-compat with a newer contributor). Adding a type = one
 *  versioned extension here + one client renderer.
 *  See change: register-plugin-automation-events, decouple-automation-action-registry. */
export interface ActionPayloadField {
  key: string;
  label: string;
  type: "string" | "multiline" | "text" | "enum";
  help?: string;
  /** Populated for `enum` fields in the client-facing descriptor. */
  options?: string[];
}

/** Serializable action descriptor sent to the create-automation dialog.
 *  Function members (available/buildPrompt) stay server-side.
 *  See change: register-plugin-automation-events. */
export interface ActionDescriptor {
  /** Namespaced id `<source>.<verb>`, e.g. `flows.run`. */
  id: string;
  /** Owning plugin/source, e.g. `flows` | `core`. */
  source: string;
  label: string;
  description?: string;
  /** False when the action's source is not usable in the current cwd. */
  available: boolean;
  /** Reason shown when `available` is false. */
  unavailableReason?: string;
  payloadSchema: ActionPayloadField[];
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
  /** Findings count derived from `result.md` on finish (top-level bullet
   *  lines). `0` for an auto-archived empty run. Absent on old records.
   *  See change: automation-ui-mockup-parity. */
  findings?: number;
}
