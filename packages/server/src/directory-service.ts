/**
 * DirectoryService — server-side directory-scoped operations.
 * Handles session discovery, event loading, and OpenSpec polling
 * directly on the server without requiring bridge connections.
 */
import { pollOpenSpecAsync } from "@blackbelt-technology/pi-dashboard-shared/openspec-poller.js";
import { discoverSessionsForCwd } from "./session-discovery.js";
import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { scanPiResources } from "./pi-resource-scanner.js";
import type { OpenSpecData } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { PiResourcesResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { PreferencesStore } from "./preferences-store.js";
import type { SessionManager } from "./memory-session-manager.js";

const POLL_INTERVAL = 30_000;

import type { DiscoveredSession } from "./session-discovery.js";
export type { DiscoveredSession } from "./session-discovery.js";

export interface LoadResult {
  success: boolean;
  events: Array<{ eventType: string; timestamp: number; data: Record<string, unknown> }>;
  error?: string;
}

export interface DirectoryAddedResult {
  sessions: DiscoveredSession[];
  openspecData: OpenSpecData;
}

export interface DirectoryService {
  knownDirectories(): string[];
  discoverSessions(cwd: string): DiscoveredSession[];
  loadSessionEvents(sessionId: string, sessionFile: string): Promise<LoadResult>;
  getOpenSpecData(cwd: string): OpenSpecData | undefined;
  refreshOpenSpec(cwd: string): Promise<OpenSpecData>;
  getPiResources(cwd: string): PiResourcesResult | undefined;
  refreshPiResources(cwd: string): Promise<PiResourcesResult>;
  startPolling(onChange: (cwd: string, data: OpenSpecData) => void): void;
  stopPolling(): void;
  onDirectoryAdded(cwd: string): Promise<DirectoryAddedResult>;
}

export function createDirectoryService(
  preferencesStore: PreferencesStore,
  sessionManager: SessionManager,
): DirectoryService {
  const openspecCache = new Map<string, OpenSpecData>();
  const piResourcesCache = new Map<string, PiResourcesResult>();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let onChangeCallback: ((cwd: string, data: OpenSpecData) => void) | null = null;

  // In-progress session loads for dedup
  const loadingSet = new Set<string>();

  function computeKnownDirectories(): string[] {
    const dirs = new Set<string>();
    for (const dir of preferencesStore.getPinnedDirectories()) {
      dirs.add(dir);
    }
    for (const session of sessionManager.listAll()) {
      dirs.add(session.cwd);
    }
    return Array.from(dirs);
  }

  function discoverSessions(cwd: string): DiscoveredSession[] {
    return discoverSessionsForCwd(cwd);
  }

  async function loadSessionEvents(sessionId: string, sessionFile: string): Promise<LoadResult> {
    // Dedup: wait if already loading
    if (loadingSet.has(sessionId)) {
      return { success: false, events: [], error: "already_loading" };
    }
    loadingSet.add(sessionId);
    try {
      const { loadSessionEntries } = await import("./session-file-reader.js");
      const entries = loadSessionEntries(sessionFile);
      const eventMessages = replayEntriesAsEvents(sessionId, entries);
      const events = eventMessages.map((m) => m.event);
      return { success: true, events };
    } catch (err: any) {
      const error = err?.code === "ENOENT" ? "file_not_found" : (err?.message ?? "parse_error");
      return { success: false, events: [], error };
    } finally {
      loadingSet.delete(sessionId);
    }
  }

  async function refreshOpenSpec(cwd: string): Promise<OpenSpecData> {
    const data = await pollOpenSpecAsync(cwd);
    openspecCache.set(cwd, data);
    return data;
  }

  async function refreshPiResourcesInternal(cwd: string): Promise<PiResourcesResult> {
    const data = await scanPiResources(cwd);
    piResourcesCache.set(cwd, data);
    return data;
  }

  // Re-entry guard: if the previous poll hasn't finished yet (common on
  // Windows with many changes), skip this tick instead of stacking up
  // overlapping polls that starve the event loop.
  let pollInFlight = false;
  async function pollAllDirectories() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const dirs = computeKnownDirectories();
      // Poll all directories in parallel, non-blocking
      await Promise.all(dirs.map(async (cwd) => {
        const [data] = await Promise.all([
          pollOpenSpecAsync(cwd),
          refreshPiResourcesInternal(cwd),
        ]);
        const prev = openspecCache.get(cwd);
        const prevJson = prev ? JSON.stringify(prev) : undefined;
        const newJson = JSON.stringify(data);
        openspecCache.set(cwd, data);
        if (newJson !== prevJson) {
          onChangeCallback?.(cwd, data);
        }
      }));
    } finally {
      pollInFlight = false;
    }
  }

  return {
    knownDirectories: computeKnownDirectories,
    discoverSessions,
    loadSessionEvents,

    getOpenSpecData(cwd: string): OpenSpecData | undefined {
      return openspecCache.get(cwd);
    },

    refreshOpenSpec,

    getPiResources(cwd: string): PiResourcesResult | undefined {
      return piResourcesCache.get(cwd);
    },

    async refreshPiResources(cwd: string): Promise<PiResourcesResult> {
      return refreshPiResourcesInternal(cwd);
    },

    startPolling(onChange: (cwd: string, data: OpenSpecData) => void) {
      onChangeCallback = onChange;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(pollAllDirectories, POLL_INTERVAL);
    },

    stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      onChangeCallback = null;
    },

    async onDirectoryAdded(cwd: string): Promise<DirectoryAddedResult> {
      const [sessions, openspecData] = await Promise.all([
        discoverSessions(cwd),
        refreshOpenSpec(cwd),
      ]);
      return { sessions, openspecData };
    },
  };
}
