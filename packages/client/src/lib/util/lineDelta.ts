/**
 * Per-turn line-delta derivation for the change-summary block.
 *
 * Deterministic, client-side, no network, no LLM: counts `+`/`−` lines from
 * the Edit/Write tool-call payloads already on the client. Numbers here are
 * "what this turn did" and intentionally differ from the git-net roll-up (a
 * line added then removed later nets 0 but each turn shows activity).
 *
 * See change: add-change-summary-table.
 */
import { structuredPatch } from "diff";
import type { ChatMessage } from "../chat/event-reducer.js";

export interface LineDelta {
  additions: number;
  deletions: number;
}

const EMPTY: LineDelta = { additions: 0, deletions: 0 };

function add(a: LineDelta, b: LineDelta): LineDelta {
  return { additions: a.additions + b.additions, deletions: a.deletions + b.deletions };
}

/** Non-empty text → its line count (a trailing newline does not add a line). */
function lineCount(text: string): number {
  if (text === "") return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

/**
 * Count `+`/`−` lines between two texts via a zero-context structured patch.
 * Unchanged inner lines are NOT counted (a naive `oldLines` vs `newLines`
 * over-counts). Identical texts → `{0,0}`.
 */
export function editDelta(oldText: string, newText: string): LineDelta {
  if (oldText === newText) return { ...EMPTY };
  const patch = structuredPatch("f", "f", oldText, newText, "", "", { context: 0 });
  let additions = 0;
  let deletions = 0;
  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      // Prefixes: ' ' context, '+' add, '−' del, '\' no-newline marker.
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }
  }
  return { additions, deletions };
}

/** Count `+`/`−` lines of a pre-computed unified diff string (hashline `toolDetails.diff`). */
function unifiedDiffDelta(diff: string): LineDelta {
  let additions = 0;
  let deletions = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue; // file headers
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

interface HashlineEditOp {
  op?: string;
  lines?: string[];
  oldText?: string;
  newText?: string;
}

/**
 * Delta for one Edit/Write tool call across every payload shape the events
 * carry (verified in `EditToolRenderer`), in the same precedence order:
 *   1. Write `content` → all additions (no prior known content client-side).
 *   2. `toolDetails.diff` (pre-computed hashline unified diff).
 *   3. top-level `oldText`/`newText`.
 *   4. `edits[]` — sum each op: text op → `editDelta`; hashline op → its
 *      `lines[]` counted as additions.
 */
/** Sum an `edits[]` array: text op → `editDelta`; hashline op → `lines[]` as additions. */
function editsArrayDelta(edits: HashlineEditOp[]): LineDelta {
  let total: LineDelta = { ...EMPTY };
  for (const op of edits) {
    if (typeof op.oldText === "string" && typeof op.newText === "string") {
      total = add(total, editDelta(op.oldText, op.newText));
    } else if (Array.isArray(op.lines)) {
      total = add(total, { additions: op.lines.length, deletions: 0 });
    }
  }
  return total;
}

export function toolCallDelta(msg: ChatMessage): LineDelta {
  const args = msg.args ?? {};

  if ((msg.toolName ?? "").toLowerCase() === "write") {
    const content = typeof args.content === "string" ? args.content : "";
    return { additions: lineCount(content), deletions: 0 };
  }
  const diff = msg.toolDetails?.diff;
  if (typeof diff === "string" && diff.length > 0) return unifiedDiffDelta(diff);
  if (typeof args.oldText === "string" && typeof args.newText === "string") {
    return editDelta(args.oldText, args.newText);
  }
  if (Array.isArray(args.edits)) return editsArrayDelta(args.edits as HashlineEditOp[]);
  return { ...EMPTY };
}

function isEditOrWrite(toolName: string | undefined): boolean {
  const t = (toolName ?? "").toLowerCase();
  return t === "edit" || t === "write";
}

/** Rel-path of an Edit/Write tool event, or `undefined`. */
function toolPath(msg: ChatMessage): string | undefined {
  return typeof msg.args?.path === "string" ? (msg.args.path as string) : undefined;
}

/**
 * Walk the flat message list attributing each Edit/Write `toolResult` to the
 * running turn of the nearest preceding user message (tool events carry no
 * `turnIndex`). `onTool(turn, msg)` fires per edit/write; `onBoundary(turn,
 * userMessageId)` fires when a new user message closes a prior turn. Single
 * O(n) pass shared by `turnFileDeltas` + `buildTurnSummaries`.
 */
function walkTurns(
  messages: ChatMessage[],
  onTool: (turn: number, msg: ChatMessage) => void,
  onBoundary?: (turn: number, userMessageId: string) => void,
): void {
  let currentTurn = 0;
  let sawUser = false;
  for (const msg of messages) {
    if (msg.role === "user") {
      if (sawUser) onBoundary?.(currentTurn, msg.id);
      if (typeof msg.turnIndex === "number") currentTurn = msg.turnIndex;
      else if (sawUser) currentTurn += 1;
      sawUser = true;
    } else if (msg.role === "toolResult" && isEditOrWrite(msg.toolName)) {
      onTool(currentTurn, msg);
    }
  }
}

export interface TurnFileSummary {
  path: string;
  additions: number;
  deletions: number;
  /** `added` when this turn holds the file's first-ever event and it was a Write. */
  status: "added" | "modified";
}

export interface TurnSummary {
  /** Running turn number (turnIndex when stamped, else ordinal). */
  turn: number;
  files: TurnFileSummary[];
  totalAdditions: number;
  totalDeletions: number;
  /**
   * Id of the user message that STARTS the following turn — the render anchor
   * (the block draws above that bubble, at the end of this turn). `null` for
   * the last / in-progress turn, which the caller renders at the stream tail.
   */
  boundaryUserMessageId: string | null;
}

/**
 * Build per-turn change summaries for the chat stream: one entry per turn that
 * changed ≥ 1 file, in stream order, each carrying its files (path-sorted),
 * aggregate counts, and the render anchor. Single O(n) walk; memoize on
 * `messages` identity at the call site (per the performance-optimization
 * discipline). See change: add-change-summary-table.
 */
interface TurnAcc {
  files: Map<string, LineDelta>;
  boundaryUserMessageId: string | null;
}

/** Assemble one turn's `TurnSummary` (path-sorted files + totals), or null when empty. */
function assembleTurnSummary(
  turn: number,
  acc: TurnAcc,
  isAdded: (path: string, turn: number) => boolean,
): TurnSummary | null {
  if (acc.files.size === 0) return null;
  const files: TurnFileSummary[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const [path, delta] of acc.files) {
    totalAdditions += delta.additions;
    totalDeletions += delta.deletions;
    files.push({
      path,
      additions: delta.additions,
      deletions: delta.deletions,
      status: isAdded(path, turn) ? "added" : "modified",
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { turn, files, totalAdditions, totalDeletions, boundaryUserMessageId: acc.boundaryUserMessageId };
}

export function buildTurnSummaries(messages: ChatMessage[]): TurnSummary[] {
  const turnData = new Map<number, TurnAcc>();
  const order: number[] = [];
  const firstSeenTurn = new Map<string, number>();
  const originIsWrite = new Map<string, boolean>();

  const ensure = (t: number): TurnAcc => {
    let acc = turnData.get(t);
    if (!acc) {
      acc = { files: new Map(), boundaryUserMessageId: null };
      turnData.set(t, acc);
      order.push(t);
    }
    return acc;
  };

  walkTurns(
    messages,
    (turn, msg) => {
      const path = toolPath(msg);
      if (!path) return;
      const acc = ensure(turn);
      acc.files.set(path, add(acc.files.get(path) ?? { ...EMPTY }, toolCallDelta(msg)));
      if (!firstSeenTurn.has(path)) {
        firstSeenTurn.set(path, turn);
        originIsWrite.set(path, (msg.toolName ?? "").toLowerCase() === "write");
      }
    },
    (turn, userMessageId) => {
      // Anchor the closing turn's block above this user message (skip empty turns).
      const acc = turnData.get(turn);
      if (acc) acc.boundaryUserMessageId = userMessageId;
    },
  );

  const isAdded = (path: string, turn: number): boolean =>
    firstSeenTurn.get(path) === turn && (originIsWrite.get(path) ?? false);

  const summaries: TurnSummary[] = [];
  for (const turn of order) {
    const summary = assembleTurnSummary(turn, turnData.get(turn)!, isAdded);
    if (summary) summaries.push(summary);
  }
  return summaries;
}

/**
 * Group per-turn file deltas from the flat message list.
 *
 * Tool events carry NO `turnIndex` (only user messages do), so attribute each
 * Edit/Write `toolResult` to the running turn of the nearest preceding user
 * message: a user message with a stamped `turnIndex` sets the current turn; an
 * unstamped in-progress user message advances to the next turn. Returns
 * `turn → (path → summed LineDelta)`; a path changed twice in a turn is summed.
 */
export function turnFileDeltas(messages: ChatMessage[]): Map<number, Map<string, LineDelta>> {
  const byTurn = new Map<number, Map<string, LineDelta>>();
  walkTurns(messages, (turn, msg) => {
    const path = toolPath(msg);
    if (!path) return;
    let turnMap = byTurn.get(turn);
    if (!turnMap) {
      turnMap = new Map<string, LineDelta>();
      byTurn.set(turn, turnMap);
    }
    turnMap.set(path, add(turnMap.get(path) ?? { ...EMPTY }, toolCallDelta(msg)));
  });
  return byTurn;
}
