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
 * Load entries from a JSONL session file.
 * Returns entries in branch order (leaf→root reversed) if tree structure is present,
 * otherwise returns linear order (excluding the session header).
 */
export function loadSessionEntries(filePath: string): SessionEntry[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, "utf-8");
  const entries: SessionEntry[] = [];

  for (const line of content.trim().split("\n")) {
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
    let current = byId.get(leafId);
    while (current) {
      branch.unshift(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    if (branch.length > 0) return branch;
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
