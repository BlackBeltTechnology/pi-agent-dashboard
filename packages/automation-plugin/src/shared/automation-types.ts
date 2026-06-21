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

/** The `on:` trigger block. `kind` selects the registered TriggerType; the
 *  remaining fields are kind-specific (e.g. `cron` for `schedule`). */
export interface AutomationTrigger {
  kind: string;
  [field: string]: unknown;
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
