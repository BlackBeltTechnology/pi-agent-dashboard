/**
 * Append-only command log for the team-controls layer.
 *
 * One entry per action-bearing request, permitted or refused; each refusal
 * records its specific reason. The interface deliberately exposes NO edit or
 * delete operation — an audit trail a caller can rewrite is not an audit trail.
 * Retention is a ring buffer bounded by an operator-configurable limit
 * (default 10,000), oldest discarded first.
 *
 * Persisted to a plugin-owned JSON file (0600) so entries survive a restart.
 *
 * See change: add-chat-gateway-team-controls (D6).
 */
import fs from "node:fs";
import path from "node:path";
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";

export interface CommandLogEntry {
  /** Epoch ms. */
  at: number;
  /** Stable platform identifier (Discord snowflake). */
  principal: string;
  channelId: string;
  threadId?: string;
  workspaceId?: string;
  tier?: Tier;
  verb: string;
  /** Session id or cwd the verb targeted, when known. */
  target?: string;
  outcome: "permitted" | "refused";
  /** Specific refusal reason; present iff `outcome === "refused"`. */
  reason?: string;
}

export interface CommandLogDeps {
  /** Omit for an in-memory log (tests). */
  filePath?: string;
  limit: number;
  /**
   * Report a failed write. The write happens on the MESSAGE path, so the failure
   * cannot be thrown at the caller (it would silence the bot) and must not be
   * dropped either — the operator needs to know the trail has a hole in it.
   */
  onPersistFailure?: (message: string) => void;
  now?: () => number;
}

export interface CommandLog {
  append(entry: Omit<CommandLogEntry, "at"> & { at?: number }): void;
  /** Oldest → newest. */
  entries(): CommandLogEntry[];
  /** Newest → oldest, for the dashboard view. */
  recent(limit?: number): CommandLogEntry[];
  size(): number;
  load(): void;
}

function isEntry(v: unknown): v is CommandLogEntry {
  if (typeof v !== "object" || v === null) return false;
  const e = v as Record<string, unknown>;
  // `outcome` is part of the check on purpose. The panel and the reason summary
  // treat anything that is not "refused" as permitted, so loading an entry with
  // no outcome would manufacture evidence of an authorization that never
  // happened. An entry with no usable outcome is not evidence — drop it.
  return (
    typeof e.principal === "string" &&
    typeof e.verb === "string" &&
    typeof e.channelId === "string" &&
    (e.outcome === "permitted" || e.outcome === "refused")
  );
}

export function createCommandLog(deps: CommandLogDeps): CommandLog {
  const limit = Math.max(1, Math.floor(deps.limit));
  const now = deps.now ?? Date.now;
  let entries: CommandLogEntry[] = [];

  function persist(): void {
    if (!deps.filePath) return;
    try {
      const dir = path.dirname(deps.filePath);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try {
        fs.chmodSync(dir, 0o700);
      } catch {
        // best effort — non-POSIX filesystems ignore mode
      }
      const tmp = path.join(dir, `.${path.basename(deps.filePath)}.${process.pid}.tmp`);
      fs.writeFileSync(tmp, `${JSON.stringify({ entries }, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, deps.filePath);
      fs.chmodSync(deps.filePath, 0o600);
    } catch (err) {
      // `append` runs for EVERY authorized action, inside `authorizeRequest`. A
      // throw here propagated to the adapter's catch (which only logs), so a full
      // disk or a read-only state dir became a bot that stopped answering every
      // message — a worse failure than a lost write. Reported, not swallowed: a
      // missing write means the trail no longer matches what happened.
      deps.onPersistFailure?.(`command log write failed: ${String(err)}`);
    }
  }

  function load(): void {
    if (!deps.filePath) return;
    let raw: string;
    try {
      raw = fs.readFileSync(deps.filePath, "utf8");
    } catch {
      return; // missing -> empty
    }
    try {
      const parsed = JSON.parse(raw);
      const list: unknown = Array.isArray(parsed) ? parsed : parsed?.entries;
      if (!Array.isArray(list)) return;
      const valid = (list as unknown[]).filter(isEntry);
      // Apply the CURRENT limit on load, so lowering retention takes effect.
      entries = valid.length > limit ? valid.slice(valid.length - limit) : valid;
    } catch {
      // corrupt JSON -> empty, never throws
    }
  }

  return {
    append(entry) {
      const full: CommandLogEntry = { at: now(), ...entry };
      entries.push(full);
      if (entries.length > limit) entries.splice(0, entries.length - limit);
      persist();
    },
    entries: () => entries.map((e) => ({ ...e })),
    recent(limitN) {
      const newestFirst = [...entries].reverse().map((e) => ({ ...e }));
      return limitN === undefined ? newestFirst : newestFirst.slice(0, limitN);
    },
    size: () => entries.length,
    load,
  };
}
