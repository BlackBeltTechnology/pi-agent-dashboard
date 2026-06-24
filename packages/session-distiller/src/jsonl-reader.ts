/**
 * Standalone JSONL session reader (task 2.1).
 * Parses one session file into ordered raw events. Malformed lines are skipped
 * and counted, never aborting the run.
 */
import { readFileSync, existsSync } from "node:fs";
import type { RawEvent, ReadResult } from "./types.js";

/** A parsed line is a usable event only if it is an object with a string `type`. */
function isRawEvent(o: unknown): o is RawEvent {
  return !!o && typeof o === "object" && typeof (o as { type?: unknown }).type === "string";
}

/** Parse JSONL text into ordered events + a malformed-line count. */
export function parseSessionText(content: string): ReadResult {
  const events: RawEvent[] = [];
  let malformed = 0;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj: unknown = JSON.parse(trimmed);
      if (isRawEvent(obj)) events.push(obj);
      else malformed++; // parseable JSON but not a valid event shape
    } catch {
      malformed++;
    }
  }
  return { events, malformed };
}

/** Read + parse a session file from disk. Missing file => empty result. */
export function readSession(filePath: string): ReadResult {
  if (!existsSync(filePath)) return { events: [], malformed: 0 };
  return parseSessionText(readFileSync(filePath, "utf-8"));
}

/** The session header event (type=session), if present and well-formed. */
export function sessionHeader(events: RawEvent[]): RawEvent | undefined {
  const h = events[0];
  if (h && h.type === "session" && typeof h.id === "string") return h;
  return undefined;
}
