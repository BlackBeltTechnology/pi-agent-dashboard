/**
 * Trajectory segmentation into task episodes (task 2.4).
 * Boundaries: a new top-level user message (a fresh task, NOT a correction),
 * a session_info.name change, or a time gap beyond a threshold.
 */
import type { Episode, Trajectory, Turn } from "./types.js";

export const DEFAULT_GAP_MS = 30 * 60 * 1000; // 30 minutes

/** Correction lexicon — user messages that steer, not start, a task. */
const CORRECTION_RE =
  /\b(no|nope|actually|don['’]?t|do not|instead|wrong|not quite|stop|rather)\b/i;

export function isCorrection(text: string | undefined): boolean {
  return !!text && CORRECTION_RE.test(text);
}

function plainUserText(turn: Turn): string | undefined {
  if (turn.role !== "user") return undefined;
  return turn.text;
}

/** Is this user turn a fresh task boundary (not a correction follow-up)? */
function startsNewTask(turn: Turn, prev: Turn | undefined): boolean {
  const text = plainUserText(turn);
  if (text === undefined) return false;
  if (isCorrection(text)) return false;
  // A user message right after another user message with no assistant action
  // between is still a boundary; corrections are excluded above.
  void prev;
  return true;
}

function gapMs(a?: string, b?: string): number {
  if (!a || !b) return 0;
  return Math.abs(Date.parse(b) - Date.parse(a));
}

export function segment(
  traj: Trajectory,
  gapThresholdMs = DEFAULT_GAP_MS,
): Episode[] {
  const episodes: Episode[] = [];
  let current: Turn[] = [];
  let lastTs: string | undefined;
  let prev: Turn | undefined;

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0];
    const userTurn = current.find((t) => t.role === "user");
    episodes.push({
      sessionId: traj.sessionId,
      index: episodes.length,
      name: traj.name,
      userPrompt: userTurn?.text,
      startedAt: first.timestamp,
      turns: current,
    });
    current = [];
  };

  for (const turn of traj.turns) {
    const timeBoundary =
      lastTs !== undefined && gapMs(lastTs, turn.timestamp) > gapThresholdMs;
    const taskBoundary = startsNewTask(turn, prev);
    const nameBoundary = prev !== undefined && turn.name !== prev.name;

    if (current.length > 0 && (timeBoundary || taskBoundary || nameBoundary)) flush();

    current.push(turn);
    lastTs = turn.timestamp;
    prev = turn;
  }
  flush();
  return episodes;
}
