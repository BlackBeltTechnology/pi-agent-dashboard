/**
 * Trajectory normalization (task 2.2).
 * Turns raw events into a trajectory model: turns carrying role/text/thinking/
 * toolCalls/toolResults, plus toolCall.id <-> toolResult.toolCallId pairing.
 */
import type {
  RawEvent,
  RawMessage,
  ToolCall,
  ToolPair,
  ToolResult,
  Trajectory,
  Turn,
} from "./types.js";
import { sessionHeader } from "./jsonl-reader.js";

function blocksOf(content: unknown): any[] {
  if (Array.isArray(content)) return content;
  return [];
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content)
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return blocksOf(content)
    .filter((b) => b && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

function toTurn(ev: RawEvent): Turn | undefined {
  const m = ev.message as RawMessage | undefined;
  if (!m) return undefined;
  const turn: Turn = {
    role: m.role,
    timestamp: ev.timestamp,
    toolCalls: [],
    toolResults: [],
  };

  if (m.role === "toolResult") {
    turn.toolResults.push({
      toolCallId: m.toolCallId ?? "",
      toolName: m.toolName,
      text: resultText(m.content),
      isError: m.isError === true,
      timestamp: ev.timestamp,
    });
    return turn;
  }

  const blocks = blocksOf(m.content);
  const thinking = blocks
    .filter((b) => b && b.type === "thinking" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
  if (thinking) turn.thinking = thinking;

  const text = textFromContent(m.content);
  if (text) turn.text = text;

  for (const b of blocks) {
    if (b && b.type === "toolCall" && typeof b.id === "string" && typeof b.name === "string") {
      turn.toolCalls.push({ id: b.id, name: b.name, arguments: b.arguments });
    }
  }
  return turn;
}

/** Build the normalized trajectory from ordered raw events. */
export function buildTrajectory(events: RawEvent[]): Trajectory {
  const header = sessionHeader(events);
  const turns: Turn[] = [];
  let model: string | undefined;
  let name: string | undefined;

  for (const ev of events) {
    if (ev.type === "model_change" && ev.modelId) model = ev.modelId;
    if (ev.type === "session_info" && ev.name) name = ev.name;
    if (ev.type === "message") {
      const turn = toTurn(ev);
      if (turn) {
        turn.name = name; // session_info.name in effect at this turn
        turns.push(turn);
      }
    }
  }

  return {
    sessionId: header?.id ?? "unknown",
    cwd: header?.cwd ?? "",
    startedAt: header?.timestamp ?? turns[0]?.timestamp ?? "",
    model,
    name,
    turns,
    pairs: pairToolCalls(turns),
  };
}

/** Pair every toolCall with its toolResult by id (result undefined => unpaired). */
export function pairToolCalls(turns: Turn[]): ToolPair[] {
  const results = new Map<string, ToolResult>();
  for (const t of turns) {
    for (const r of t.toolResults) {
      if (r.toolCallId) results.set(r.toolCallId, r);
    }
  }
  const pairs: ToolPair[] = [];
  for (const t of turns) {
    for (const c of t.toolCalls) {
      pairs.push({ call: c, result: results.get(c.id) });
    }
  }
  return pairs;
}
