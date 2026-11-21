/**
 * Shared types for the ship-batch runner (pure; no I/O).
 *
 * See change: add-ship-batch-orchestrator.
 */

export type ItemState =
  | "queued"
  | "waiting_dep"
  | "starting"
  | "running"
  | "question"
  | "settled"
  | "teardown"
  | "shipped"
  | "incomplete"
  | "failed"
  | "kept"
  | "skipped";

export const TERMINAL_STATES: ReadonlySet<ItemState> = new Set<ItemState>([
  "shipped",
  "incomplete",
  "failed",
  "kept",
  "skipped",
]);

/** Slots (`--parallel`) are held by these states; `question` does not hold one. */
export const ACTIVE_STATES: ReadonlySet<ItemState> = new Set<ItemState>([
  "starting",
  "running",
  "settled",
  "teardown",
]);

export const isTerminal = (s: ItemState): boolean => TERMINAL_STATES.has(s);

/** What a settled session left behind (design D5). */
export type Outcome = "shipped" | "blocked" | "incomplete" | "unknown" | "failed";

export interface ArchiveProgress {
  /** First archive attempt (bounds the 3-minute wait). */
  startedAt: number;
  /** A `pending` reply was seen (idle session, intent queued). */
  pending: boolean;
  /** Last archive POST (spaces the 409 retries by one settle window). */
  lastAttemptAt: number;
  /** Archive confirmed (listing shows it, or an immediate 200). */
  done: boolean;
}

export interface HistoryEntry {
  at: number;
  from: ItemState | null;
  to: ItemState;
  reason?: string;
}

export interface Item {
  change: string;
  state: ItemState;
  /** Why the item is in its current (terminal / waiting) state. */
  reason?: string;
  /** Open `blockedBy` edges to OTHER batch members. */
  blockedBy: string[];
  /** Open `blockedBy` edges to non-members (ship-it will ask; informational). */
  outOfBatch: string[];
  sessionId?: string;
  spawnRequestedAt?: number;
  /** Last prompt sent to the session (initial prompt or a nudge). */
  lastPromptAt?: number;
  nudgesUsed: number;
  /** Observed `streaming` since the last prompt. */
  streamedSincePrompt: boolean;
  /** Epoch ms when the session became continuously `idle`; `null` otherwise. */
  idleSince: number | null;
  outcome?: Outcome;
  worktree?: string;
  branch?: string;
  /** The worktree was created by this run (so a failed start may remove it). */
  freshWorktree?: boolean;
  archive?: ArchiveProgress;
  history: HistoryEntry[];
}

export interface Params {
  parallel: number;
  maxLive: number;
  nudges: number;
  settleMs: number;
  startTimeoutMs: number;
  model: string;
}

export interface BatchState {
  version: 1;
  groupId: string;
  groupName: string;
  repo: string;
  params: Params;
  /** Archive directory names on `origin/develop` at plan time. */
  planArchive: string[];
  items: Item[];
  /** Scheduling halted (e.g. untrusted init hook); live items still finish. */
  halted?: string;
  /** Members that were already archived on `origin/develop` at plan time. */
  alreadyShipped: string[];
  createdAt: number;
  updatedAt: number;
  unreachableSince?: number | null;
  /** Operator-visible notes for the final report (warnings, trust hint, …). */
  notes: string[];
}

export interface SessionObs {
  id: string;
  cwd: string;
  status: "active" | "idle" | "streaming" | "ended";
  startedAt: number;
}

export interface Observations {
  /** Bus snapshot connected right now. */
  connected: boolean;
  /** Epoch ms of the current continuous connection start; `null` while down. */
  connectedSince: number | null;
  /** Resident sessions by id (bus snapshot). */
  sessions: Record<string, SessionObs>;
  /** Session ids that currently have a pending question. */
  questions: ReadonlySet<string>;
  /** Recorded session ids the archived listing knows (they left the snapshot legitimately). */
  archived: ReadonlySet<string>;
}

export type Action =
  | { kind: "start"; change: string }
  | { kind: "adopt"; change: string }
  | { kind: "classify"; change: string }
  | { kind: "nudge"; change: string; sessionId: string; text: string }
  | { kind: "teardown"; change: string }
  | { kind: "skip"; change: string; reason: string };

export const nudgeText = (change: string): string =>
  `Continue /skill:ship-it for ${change} from where you stopped.`;
