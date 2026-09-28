/**
 * Standalone JSONL session file reader.
 * Reads pi session files without requiring @earendil-works/pi-coding-agent.
 * Falls back to linear entry order (no tree branching support).
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface SessionEntry {
  type: string;
  id?: string;
  parentId?: string;
  timestamp?: string;
  message?: any;
  [key: string]: unknown;
}

/**
 * The ONE line splitter both session-load arms share — the file arm and the
 * worker's raw-transcript arm — so text-fed and file-fed produce identical
 * entries, and therefore identical events, by CONSTRUCTION rather than by
 * assertion.
 *
 * `String.prototype.trim` also strips a leading U+FEFF. That is why the two
 * arms diverged before this was shared: the file arm silently dropped a BOM,
 * while the retained path's store splitter (`split("\n").filter(len > 0)`)
 * kept it, and `JSON.parse` then threw on entry 0 — failing the header check
 * and yielding ZERO events for the whole transcript.
 * See change: offload-retained-transcript-replay (D1).
 */
export function splitTranscriptLines(raw: string): string[] {
  return raw.trim().split("\n");
}

/**
 * Load entries from a JSONL session file.
 * Returns entries in branch order (leaf→root reversed) if tree structure is present,
 * otherwise returns linear order (excluding the session header).
 */
export function loadSessionEntries(filePath: string): SessionEntry[] {
  if (!existsSync(filePath)) return [];
  return parseSessionEntries(splitTranscriptLines(readFileSync(filePath, "utf-8")));
}

/**
 * The parse half of `loadSessionEntries`, over LINES rather than a path.
 *
 * A retained REMOTE transcript is the same `.jsonl` content with no local file
 * to read it from, and it must resolve the same branch as the local path would
 * — a second, simpler ordering rule would make a remote session render a
 * different conversation than the machine it came from.
 *
 * Those lines are UNTRUSTED. A retained remote transcript is verbatim
 * bridge-controlled input, so the leaf→root walk below is bounded: see the
 * comment on `seen`.
 * See change: serve-retained-remote-transcripts.
 */
export function parseSessionEntries(lines: string[]): SessionEntry[] {
  const entries: SessionEntry[] = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  if (entries.length === 0) return [];

  // Validate session header
  const header = entries[0];
  if (header.type !== "session" || typeof header.id !== "string") return [];

  // Build entry index for tree traversal
  const byId = new Map<string, SessionEntry>();
  let leafId: string | undefined;

  for (const entry of entries) {
    if (entry.type === "session") continue; // skip header
    if (entry.id) {
      byId.set(entry.id, entry);
      leafId = entry.id; // last entry with an id is the leaf
    }
  }

  // Check for leaf pointer in header or metadata
  for (const entry of entries) {
    if (entry.type === "leaf" && typeof entry.entryId === "string") {
      leafId = entry.entryId;
    }
  }

  // If entries have tree structure (parentId), walk from leaf to root
  if (leafId && byId.size > 0) {
    const branch: SessionEntry[] = [];
    // A `parentId` cycle (`a→b→a`, or `a→a`) is two well-formed lines. pi never
    // writes one, but a REMOTE transcript is bytes a bridge sent, and this walk
    // runs on the event loop — unbounded, it hangs the whole dashboard, HTTP and
    // WebSocket alike, including the hydration heartbeat that shares the loop.
    // Revisiting an id means the chain is not a branch, so stop and let the
    // linear fallback below serve an order that can be defended.
    // See change: serve-retained-remote-transcripts.
    const seen = new Set<string>();
    let cyclic = false;
    let current = byId.get(leafId);
    while (current) {
      const id = current.id;
      if (id !== undefined) {
        if (seen.has(id)) {
          cyclic = true;
          break;
        }
        seen.add(id);
      }
      branch.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    // The flag is load-bearing: `break` alone leaves a NON-EMPTY partial branch,
    // which the length check below would happily return as if it were a
    // resolved chain. A cycle means the parentage is not a branch at all, so
    // the honest answer is the linear fallback — not an arbitrary prefix of a
    // walk that never terminated on its own.
    if (!cyclic && branch.length > 0) return branch;
  }

  // Fallback: return all entries except header in order
  return entries.filter(e => e.type !== "session");
}

/**
 * Resolve the FULL, untruncated Write/Edit payload for a `(sessionFile,
 * toolCallId)` pair by scanning the on-disk session JSONL. This is the durable
 * source that survives the in-memory event store's ~4 KB string cap and >20-op
 * `edits` collapse.
 *
 * SECURITY (opt-in-out-of-cwd-session-diffs): the ONLY inputs are a session
 * transcript path (resolved by the caller via `sessionManager`, never built from
 * the `sessionId` string) and a `toolCallId` used solely for equality against
 * `message.content[].id`. No filesystem path is ever taken from the request; no
 * traversal, realpath, or arbitrary read is possible. A missing file, unknown
 * id, or unparseable transcript all yield `null` (the caller returns not-found)
 * — there is NO path fallback of any kind.
 *
 * The JSONL correlation key is the tool call's nested `id` at
 * `message.content[].id` (NOT the entry top-level id). Write payload rides on
 * `arguments.content`; Edit on `arguments.edits` (older transcripts: `args`).
 */
export function findSessionToolCallPayload(
  filePath: string,
  toolCallId: string,
): { content?: string; edits?: unknown[] } | null {
  if (!toolCallId) return null;
  const entries = loadSessionEntries(filePath);
  for (const entry of entries) {
    const msg = entry.message as { content?: unknown } | undefined;
    if (!msg || !Array.isArray(msg.content)) continue;
    for (const c of msg.content as Array<Record<string, unknown>>) {
      if (!c || c.type !== "toolCall" || c.id !== toolCallId) continue;
      const a = ((c.arguments ?? c.args) ?? {}) as Record<string, unknown>;
      const out: { content?: string; edits?: unknown[] } = {};
      if (typeof a.content === "string") out.content = a.content;
      if (Array.isArray(a.edits)) out.edits = a.edits;
      return out;
    }
  }
  return null;
}

/**
 * Resolve a persisted custom entry's FULL payload by scanning the on-disk
 * session JSONL — the same rationale as `findSessionToolCallPayload`: the
 * in-memory event store caps strings at ~4 KB and drops arrays >20 at ingest,
 * so it cannot serve the untruncated payload this exists for.
 *
 * SECURITY (add-custom-entry-renderer-slot): the ONLY inputs are a session
 * transcript path (resolved by the caller via `sessionManager`, never built
 * from the `sessionId` string) and an `entryId` used solely for equality
 * against `entry.id`. No filesystem path is ever taken from the request; a
 * missing file, unknown id, or an id outside the active leaf→root branch all
 * yield `null` (the caller returns 404).
 */
export function findSessionCustomEntry(
  filePath: string,
  entryId: string,
): { customType?: unknown; data?: unknown } | null {
  if (!entryId) return null;
  const entries = loadSessionEntries(filePath);
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.id !== entryId) continue;
    return { customType: entry.customType, data: entry.data };
  }
  return null;
}

/**
 * Create a new session file containing only the path from root to the given entry.
 * This is used for "fork from message" — the new file is then passed to `pi --fork`.
 * Returns the path of the new session file, or throws if entryId is not found.
 */
export function createBranchedSessionFile(sessionFilePath: string, targetEntryId: string): string {
  if (!existsSync(sessionFilePath)) {
    throw new Error(`Session file not found: ${sessionFilePath}`);
  }

  const content = readFileSync(sessionFilePath, "utf-8");
  const allLines: string[] = content.trim().split("\n").filter(l => l.trim());
  const allEntries: SessionEntry[] = [];
  for (const line of allLines) {
    try { allEntries.push(JSON.parse(line)); } catch { /* skip */ }
  }

  if (allEntries.length === 0) throw new Error("Empty session file");

  const header = allEntries[0];
  if (header.type !== "session") throw new Error("Invalid session file: missing header");

  // Build index
  const byId = new Map<string, SessionEntry>();
  for (const entry of allEntries) {
    if (entry.type === "session") continue;
    if (entry.id) byId.set(entry.id, entry);
  }

  if (!byId.has(targetEntryId)) {
    throw new Error(`Entry ID not found in session: ${targetEntryId}`);
  }

  // Walk from target to root
  const branch: SessionEntry[] = [];
  let current = byId.get(targetEntryId);
  while (current) {
    branch.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  // Write new session file: header + branch entries (with linearized parentId chain)
  const newHeader = { ...header, id: randomUUID(), parentSession: sessionFilePath };
  const lines: string[] = [JSON.stringify(newHeader)];
  for (let i = 0; i < branch.length; i++) {
    const entry = { ...branch[i], parentId: i === 0 ? null : branch[i - 1].id };
    lines.push(JSON.stringify(entry));
  }

  // Write to same directory as original session
  const dir = dirname(sessionFilePath);
  mkdirSync(dir, { recursive: true });
  const newPath = join(dir, `${newHeader.id}.jsonl`);
  writeFileSync(newPath, lines.join("\n") + "\n", "utf-8");

  return newPath;
}
