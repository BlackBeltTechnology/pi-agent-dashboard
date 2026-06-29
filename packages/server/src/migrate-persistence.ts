/**
 * Migration utility: converts sessions.json + state.json → per-session .meta.json + preferences.json.
 * Runs automatically on first startup when old files are detected.
 * Idempotent — safe to run multiple times.
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR, loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { resolvePiSessionsDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { readSessionMeta, type SessionMeta, writeSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { PREFERENCES_FILE } from "./preferences-store.js";

const DEFAULT_SESSIONS_FILE = path.join(CONFIG_DIR, "sessions.json");
const DEFAULT_STATE_FILE = path.join(CONFIG_DIR, "state.json");

interface OldSession {
  id: string;
  sessionFile?: string;
  cwd?: string;
  name?: string;
  source?: string;
  status?: string;
  model?: string;
  thinkingLevel?: string;
  startedAt?: number;
  endedAt?: number;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;
  contextTokens?: number;
  contextWindow?: number;
  firstMessage?: string;
  hidden?: boolean;
  attachedProposal?: string | null;
}

interface OldState {
  hiddenSessions?: string[];
  sessionOrder?: Record<string, string[]>;
  pinnedDirectories?: string[];
}

export interface MigrationResult {
  sessionsWritten: number;
  hiddenApplied: number;
  hiddenOrphaned: number;
  preferencesWritten: boolean;
  oldFilesRenamed: string[];
}

export interface MigrationPaths {
  sessionsFile?: string;
  stateFile?: string;
  preferencesFile?: string;
  sessionsDir?: string;
}

/** Check if migration is needed (old files exist without .bak) */
export function needsMigration(paths?: MigrationPaths): boolean {
  const sessionsFile = paths?.sessionsFile ?? DEFAULT_SESSIONS_FILE;
  const stateFile = paths?.stateFile ?? DEFAULT_STATE_FILE;
  return fs.existsSync(sessionsFile) || fs.existsSync(stateFile);
}

/**
 * Run the full migration:
 * 1. Read sessions.json → write .meta.json for each session
 * 2. Read state.json → apply hiddenSessions to .meta.json, write preferences.json
 * 3. Rename old files to .bak
 */
export function runMigration(paths?: MigrationPaths): MigrationResult {
  const sessionsFile = paths?.sessionsFile ?? DEFAULT_SESSIONS_FILE;
  const stateFile = paths?.stateFile ?? DEFAULT_STATE_FILE;
  const preferencesFile = paths?.preferencesFile ?? PREFERENCES_FILE;
  const sessionsScanDir =
    paths?.sessionsDir ??
    resolvePiSessionsDir({ piSessionsDir: loadConfig().piSessionsDir });

  const result: MigrationResult = {
    sessionsWritten: 0,
    hiddenApplied: 0,
    hiddenOrphaned: 0,
    preferencesWritten: false,
    oldFilesRenamed: [],
  };

  // --- Step 1: Migrate sessions.json → per-session .meta.json ---
  const sessions = readJsonFile<OldSession[]>(sessionsFile, []);
  const sessionFileById = new Map<string, string>();

  for (const session of sessions) {
    if (!session.sessionFile || !fs.existsSync(session.sessionFile)) continue;

    sessionFileById.set(session.id, session.sessionFile);

    // Build meta from session data
    const newMeta: SessionMeta = {
      source: session.source,
      name: session.name,
      attachedProposal: session.attachedProposal,
      hidden: session.hidden ?? false,
      cwd: session.cwd,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      tokensIn: session.tokensIn,
      tokensOut: session.tokensOut,
      cacheRead: session.cacheRead,
      cacheWrite: session.cacheWrite,
      cost: session.cost,
      contextTokens: session.contextTokens,
      contextWindow: session.contextWindow,
      firstMessage: session.firstMessage,
      cachedAt: Date.now(),
    };

    // Merge with existing .meta.json — strip undefined values so they don't overwrite
    const existing = readSessionMeta(session.sessionFile) ?? {};
    const cleaned = Object.fromEntries(Object.entries(newMeta).filter(([, v]) => v !== undefined));
    const merged = { ...existing, ...cleaned };
    writeSessionMeta(session.sessionFile, merged);
    result.sessionsWritten++;
  }

  // --- Step 2: Migrate state.json ---
  const state = readJsonFile<OldState>(stateFile, {});

  // Apply hidden IDs to .meta.json files
  if (state.hiddenSessions) {
    for (const hiddenId of state.hiddenSessions) {
      // Try to find the session file
      const sessionFile = sessionFileById.get(hiddenId);
      if (sessionFile) {
        // Known session — merge hidden flag
        const existing = readSessionMeta(sessionFile) ?? {};
        writeSessionMeta(sessionFile, { ...existing, hidden: true });
        result.hiddenApplied++;
        continue;
      }

      // Try scanning session directories for this UUID
      const found = findSessionFileByUuid(hiddenId, sessionsScanDir);
      if (found) {
        const existing = readSessionMeta(found) ?? {};
        writeSessionMeta(found, { ...existing, hidden: true });
        result.hiddenApplied++;
      } else {
        result.hiddenOrphaned++;
      }
    }
  }

  // Write preferences.json
  const preferences = {
    pinnedDirectories: state.pinnedDirectories ?? [],
    sessionOrder: state.sessionOrder ?? {},
  };
  writeJsonFile(preferencesFile, preferences);
  result.preferencesWritten = true;

  // --- Step 3: Rename old files to .bak ---
  for (const file of [sessionsFile, stateFile]) {
    if (fs.existsSync(file)) {
      const bakFile = file + ".bak";
      fs.renameSync(file, bakFile);
      result.oldFilesRenamed.push(path.basename(file));
    }
  }

  return result;
}

/** Scan session directories for a .jsonl file containing the given UUID */
function findSessionFileByUuid(uuid: string, scanDir: string): string | null {
  if (!fs.existsSync(scanDir)) return null;

  try {
    for (const cwdDir of fs.readdirSync(scanDir)) {
      const cwdPath = path.join(scanDir, cwdDir);
      try {
        if (!fs.statSync(cwdPath).isDirectory()) continue;
        for (const file of fs.readdirSync(cwdPath)) {
          if (file.endsWith(".jsonl") && file.includes(uuid)) {
            return path.join(cwdPath, file);
          }
        }
      } catch { continue; }
    }
  } catch { /* ignore */ }

  return null;
}
