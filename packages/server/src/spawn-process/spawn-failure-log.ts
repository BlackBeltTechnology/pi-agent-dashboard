/**
 * Rolling NDJSON log of failed pi session spawn attempts.
 *
 * Location: ~/.pi/dashboard/sessions/spawn-failures.log
 * Rotation: single-shot at 10 MB (renames to .log.1, overwrites any prior .log.1).
 * Format:   one JSON object per line, terminated by \n.
 *
 * See change: spawn-failure-diagnostics.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import type { PreflightReason } from "./spawn-preflight.js";

export interface SpawnFailureEntry {
  /** ISO 8601 UTC timestamp. */
  ts: string;
  cwd: string;
  strategy: string;
  code: string;
  message: string;
  stderrTail?: string;
  pid?: number;
  reasons?: PreflightReason[];
}

const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

let _logDirOverride: string | null = null;

/** Override the log directory — for tests only. See change: spawn-failure-diagnostics. */
export function _setLogDirForTests(dir: string | null): void {
  _logDirOverride = dir;
}

function logDir(): string {
  return _logDirOverride ?? path.join(os.homedir(), ".pi", "dashboard", "sessions");
}

function logPath(): string {
  return path.join(logDir(), "spawn-failures.log");
}

function logPath1(): string {
  return path.join(logDir(), "spawn-failures.log.1");
}

/**
 * Append a failure entry to the rolling log.
 * Never throws — errors are caught and reported via `console.error`.
 */
export function appendSpawnFailure(entry: SpawnFailureEntry): void {
  try {
    const dir = logDir();
    mkdirSync(dir, { recursive: true });

    const filePath = logPath();
    const line = JSON.stringify(entry) + "\n";

    // Rotate if file exceeds threshold.
    if (existsSync(filePath)) {
      try {
        const { size } = statSync(filePath);
        if (size > LOG_MAX_BYTES) {
          renameSync(filePath, logPath1());
        }
      } catch {
        // If stat/rename fails, just write anyway.
      }
    }

    appendFileSync(filePath, line, "utf-8");
  } catch (err) {
    console.error("[spawn-failure-log] Failed to append entry:", err);
  }
}

/**
 * Read the last `limit` entries from the rolling log (both .log.1 and .log).
 * Skips malformed lines. Returns [] when no log exists.
 */
export function readSpawnFailures(limit: number = DEFAULT_LIMIT): SpawnFailureEntry[] {
  const effectiveLimit = Number.isNaN(limit) ? DEFAULT_LIMIT : Math.max(0, Math.min(limit, MAX_LIMIT));
  if (effectiveLimit === 0) return [];

  const lines: string[] = [];

  // Read older log first, then newer.
  for (const filePath of [logPath1(), logPath()]) {
    if (!existsSync(filePath)) continue;
    try {
      const content = readFileSync(filePath, "utf-8");
      lines.push(...content.split("\n").filter((l) => l.trim()));
    } catch {
      // Skip unreadable file.
    }
  }

  // Parse, skipping malformed lines.
  const entries: SpawnFailureEntry[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      // Require the minimum fields.
      if (
        typeof obj.ts === "string" &&
        typeof obj.cwd === "string" &&
        typeof obj.strategy === "string" &&
        typeof obj.code === "string" &&
        typeof obj.message === "string"
      ) {
        entries.push(obj as unknown as SpawnFailureEntry);
      }
    } catch {
      // Skip malformed line.
    }
  }

  // Return last N in file order.
  return entries.length <= effectiveLimit ? entries : entries.slice(entries.length - effectiveLimit);
}
