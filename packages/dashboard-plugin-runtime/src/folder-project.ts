/**
 * Client folder-project cache + predicate factories.
 *
 * Answers "what project is this folder" for folder-scoped claim `predicate`s and
 * `<EmbeddedApp projectScope>`. Predicates MUST be synchronous, so the answer
 * comes from a module-level cache filled by `GET /api/folder/project`:
 *
 * - A cache miss returns "loading" and queues the folder in a pending set; a
 *   `queueMicrotask` flush issues the fetches. Nothing updates React state
 *   during render.
 * - Landings are stored and coalesced into ONE `bumpSlotClaimsVersion()` per
 *   microtask (error landings included), which re-renders the folder consumers.
 * - A failed request is stored as `error` (fail closed) and expires after 60 s:
 *   the entry is dropped and the version bumped, so the predicate refetches
 *   without any unrelated render.
 * - Generations are per folder (`invalidateFolderProject`) plus a global epoch
 *   (`clearFolderProjects`). A landing from an older generation is discarded and
 *   its folder re-queued, so a response computed under a disabled plugin's rules
 *   can never repopulate the cache.
 *
 * Meaningful only while host and plugins resolve ONE runtime module instance
 * (the same assumption `slot-claims-invalidation.ts` documents).
 *
 * See change: add-project-scoped-apps.
 */

import type { FolderProject } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/manifest-types.js";
import { useSyncExternalStore } from "react";
import { bumpSlotClaimsVersion } from "./slot-claims-invalidation.js";

export type FolderProjectEntry =
  | { state: "loading" }
  | { state: "ready"; project: FolderProject }
  | { state: "error" };

/** How long an `error` entry stays before it is dropped and retried. */
export const FOLDER_PROJECT_ERROR_TTL_MS = 60_000;

const LOADING: FolderProjectEntry = { state: "loading" };
const ERROR: FolderProjectEntry = { state: "error" };

/** Settled entries only; a miss or an in-flight fetch reads as `LOADING`. */
const entries = new Map<string, FolderProjectEntry>();
/** cwd → generation key of the request in flight. */
const inFlight = new Map<string, string>();
const pending = new Set<string>();
const folderGen = new Map<string, number>();
const errorTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let epoch = 0;
let flushScheduled = false;
let bumpScheduled = false;

const genKey = (cwd: string): string => `${epoch}:${folderGen.get(cwd) ?? 0}`;

function notify(): void {
  for (const l of listeners) l();
}

/** Coalesce every landing in one microtask into a single claims-version bump. */
function scheduleBump(): void {
  if (bumpScheduled) return;
  bumpScheduled = true;
  queueMicrotask(() => {
    bumpScheduled = false;
    bumpSlotClaimsVersion();
  });
}

function isFolderProject(v: unknown): v is FolderProject {
  if (!v || typeof v !== "object") return false;
  const o = v as { id?: unknown; types?: unknown };
  return (o.id === null || typeof o.id === "string") && Array.isArray(o.types) && o.types.every((t) => typeof t === "string");
}

async function request(cwd: string): Promise<FolderProjectEntry> {
  try {
    const res = await fetch(`/api/folder/project?cwd=${encodeURIComponent(cwd)}`);
    if (!res.ok) return ERROR;
    const body: unknown = await res.json();
    return isFolderProject(body) ? { state: "ready", project: body } : ERROR;
  } catch {
    return ERROR;
  }
}

function startFetch(cwd: string): void {
  if (inFlight.has(cwd)) return;
  const key = genKey(cwd);
  inFlight.set(cwd, key);
  void request(cwd).then((entry) => {
    inFlight.delete(cwd);
    if (genKey(cwd) !== key) {
      // Computed under an older generation (plugin set changed / folder invalidated): drop it.
      queue(cwd);
      return;
    }
    entries.set(cwd, entry);
    if (entry.state === "error") armErrorExpiry(cwd, entry);
    notify();
    scheduleBump();
  });
}

function armErrorExpiry(cwd: string, entry: FolderProjectEntry): void {
  clearTimeout(errorTimers.get(cwd));
  errorTimers.set(
    cwd,
    setTimeout(() => {
      errorTimers.delete(cwd);
      if (entries.get(cwd) !== entry) return;
      entries.delete(cwd);
      notify();
      bumpSlotClaimsVersion();
    }, FOLDER_PROJECT_ERROR_TTL_MS),
  );
}

function flush(): void {
  flushScheduled = false;
  const batch = [...pending];
  pending.clear();
  for (const cwd of batch) startFetch(cwd);
}

function queue(cwd: string): void {
  if (inFlight.has(cwd) || pending.has(cwd)) return;
  pending.add(cwd);
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

/** Look up a folder; a miss queues a fetch and reads as `loading`. */
function lookup(cwd: string): FolderProjectEntry {
  const hit = entries.get(cwd);
  if (hit) return hit;
  queue(cwd);
  return LOADING;
}

/** Synchronous read of a folder's cache entry (queues a fetch on a miss). */
export function getFolderProject(cwd: string): FolderProjectEntry {
  return lookup(cwd);
}

/** Hook: a folder's cache entry. `undefined` cwd → `undefined` (no fetch, no subscription churn). */
export function useFolderProject(cwd: string | undefined): FolderProjectEntry | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => (cwd === undefined ? undefined : lookup(cwd)),
    () => undefined,
  );
}

/**
 * Forget one folder (e.g. after the user edits its identity file). Only this
 * folder's generation advances: an in-flight response for it is discarded and
 * re-requested; other folders' in-flight responses are unaffected.
 */
export function invalidateFolderProject(cwd: string): void {
  folderGen.set(cwd, (folderGen.get(cwd) ?? 0) + 1);
  entries.delete(cwd);
  clearTimeout(errorTimers.get(cwd));
  errorTimers.delete(cwd);
  notify();
  scheduleBump();
}

/** Forget every folder (the enabled plugin set changed). Advances every generation. */
export function clearFolderProjects(): void {
  epoch += 1;
  entries.clear();
  for (const t of errorTimers.values()) clearTimeout(t);
  errorTimers.clear();
  notify();
  scheduleBump();
}

/** `(folder) => boolean` claim `predicate`: true only for a `ready` entry whose types include `type`. */
export function folderHasProjectType(type: string): (folder: { cwd: string }) => boolean {
  return (folder) => {
    const e = lookup(folder.cwd);
    return e.state === "ready" && e.project.types.includes(type);
  };
}

/** `(folder) => boolean` claim `predicate`: true only for a `ready` entry whose declared id equals `id`. */
export function folderHasProjectId(id: string): (folder: { cwd: string }) => boolean {
  return (folder) => {
    const e = lookup(folder.cwd);
    return e.state === "ready" && e.project.id === id;
  };
}

/** Test-only: drop all state, including timers and listeners. */
export function __resetFolderProjectsForTests(): void {
  entries.clear();
  for (const t of errorTimers.values()) clearTimeout(t);
  errorTimers.clear();
  inFlight.clear();
  pending.clear();
  folderGen.clear();
  listeners.clear();
  epoch = 0;
}
