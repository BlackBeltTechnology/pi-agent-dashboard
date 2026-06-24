/**
 * Watermark store (task 2.3).
 * Records the newest processed session timestamp per cwd so each run processes
 * only newer sessions. Stored at
 * ~/.pi/agent/distill-session-knowledge/<cwd-hash>/watermark.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

export interface Watermark {
  lastTimestamp: string; // ISO; "" means never run
  updatedAt: string;
}

const EMPTY: Watermark = { lastTimestamp: "", updatedAt: "" };

export function cwdHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

export function watermarkPath(cwd: string, root = defaultRoot()): string {
  return join(root, cwdHash(cwd), "watermark.json");
}

export function defaultRoot(): string {
  return join(homedir(), ".pi", "agent", "distill-session-knowledge");
}

export function readWatermark(cwd: string, root = defaultRoot()): Watermark {
  const p = watermarkPath(cwd, root);
  if (!existsSync(p)) return { ...EMPTY };
  try {
    return { ...EMPTY, ...JSON.parse(readFileSync(p, "utf-8")) };
  } catch {
    return { ...EMPTY };
  }
}

export function writeWatermark(cwd: string, lastTimestamp: string, root = defaultRoot()): void {
  const p = watermarkPath(cwd, root);
  mkdirSync(dirname(p), { recursive: true });
  const wm: Watermark = { lastTimestamp, updatedAt: new Date().toISOString() };
  writeFileSync(p, JSON.stringify(wm, null, 2));
}

/** Encode a cwd to its pi session-directory name. */
export function sessionDirName(cwd: string): string {
  // Handle both POSIX (/) and Windows (\) separators.
  return "--" + cwd.replace(/^[/\\]/, "").replace(/[/\\]/g, "-") + "--";
}

export function sessionsRoot(cwd: string): string {
  return join(homedir(), ".pi", "agent", "sessions", sessionDirName(cwd));
}

export interface SessionFileRef {
  path: string;
  /** session start timestamp parsed from the filename prefix */
  timestamp: string;
}

/** List .jsonl session files for a cwd whose timestamp is newer than the watermark. */
export function listNewerSessions(
  cwd: string,
  since: string,
  dir = sessionsRoot(cwd),
): SessionFileRef[] {
  if (!existsSync(dir)) return [];
  const sinceMs = since ? Date.parse(since) : -Infinity;
  if (since && Number.isNaN(sinceMs)) {
    // A malformed watermark would make every `> sinceMs` false and silently
    // process 0 sessions. Fail loud so the watermark can be repaired.
    throw new Error(`Invalid watermark timestamp: ${since}`);
  }
  const refs: SessionFileRef[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const ts = timestampFromName(name) ?? isoFromMtime(join(dir, name));
    const tsMs = Date.parse(ts);
    if (Number.isNaN(tsMs)) continue; // skip unparseable timestamps rather than mis-compare
    if (tsMs > sinceMs) refs.push({ path: join(dir, name), timestamp: ts });
  }
  refs.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return refs;
}

/** Filenames look like 2026-06-23T22-25-00-849Z_<uuid>.jsonl */
export function timestampFromName(name: string): string | undefined {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!m) return undefined;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
}

function isoFromMtime(p: string): string {
  return statSync(p).mtime.toISOString();
}
