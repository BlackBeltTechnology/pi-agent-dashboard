/**
 * Remembered projects behind the vault project picker.
 *
 * `~/.pi/dashboard/vault-projects.json` (0600): `{ projects: [{ deviceId, dir,
 * repoKey?, lastSeenAt }] }`. Activity data, kept apart from `vault.json` so the
 * vault file stays secret-only and still does not exist before the first account.
 * No values, no binding names.
 *
 * - Reads never create the file; `record()` validates before it opens anything,
 *   so the file appears only when a valid project is first recorded.
 * - Bounds: 200 entries, 100 per device, 90 days (enforced on write AND filtered
 *   on read, so an idle hub never serves stale entries). Least recently seen go first.
 * - Write throttle: an in-memory map (bounded like the file) lets a known key be
 *   rewritten at most hourly, so a store-change push across many sessions costs
 *   no file I/O. Writes are serialised in-process (no lock contention).
 * - Corrupt file: `readJsonChecked` keeps a byte copy; `list()` returns empty and
 *   the next `record()` writes a fresh document.
 *
 * See change: retro-ux-credential-vault (D2).
 */

import path from "node:path";
import { readJsonChecked, withLockedJsonFile, writeJsonAtomic } from "../auth/locked-json-file.js";
import { findBackup } from "./vault-store.js";

const LOG_TAG = "vault";
const MAX_ENTRIES = 200;
const MAX_PER_DEVICE = 100;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const WRITE_THROTTLE_MS = 60 * 60 * 1000;
const MAX_DIR_LENGTH = 4096;
const MAX_REPO_KEY_LENGTH = 512;

export interface VaultProjectEntry {
  deviceId: string;
  dir: string;
  repoKey?: string;
  lastSeenAt: number;
}

type VaultProjectInput = Omit<VaultProjectEntry, "lastSeenAt">;

export interface VaultProjects {
  /** Remembered projects younger than 90 days. Never creates or writes the file. */
  list(): VaultProjectEntry[];
  /** Remember a project. Resolves without writing for invalid input or a recently written key; rejects on a write failure. */
  record(project: VaultProjectInput): Promise<void>;
}

interface Doc {
  projects?: unknown;
}

const keyOf = (deviceId: string, dir: string): string => `${deviceId}\u0000${dir}`;

function isEntry(v: unknown): v is VaultProjectEntry {
  if (v === null || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.deviceId === "string" &&
    typeof e.dir === "string" &&
    (e.repoKey === undefined || typeof e.repoKey === "string") &&
    typeof e.lastSeenAt === "number" &&
    Number.isFinite(e.lastSeenAt)
  );
}

const liveEntries = (doc: Doc, now: number): VaultProjectEntry[] =>
  (Array.isArray(doc.projects) ? doc.projects : []).filter(isEntry).filter((e) => now - e.lastSeenAt <= MAX_AGE_MS);

/** Keep the newest `MAX_PER_DEVICE` per device, then the newest `MAX_ENTRIES` overall. */
function bound<T extends { deviceId: string }>(items: T[], at: (item: T) => number): T[] {
  const newestFirst = [...items].sort((a, b) => at(b) - at(a));
  const perDevice = new Map<string, number>();
  const kept = newestFirst.filter((item) => {
    const n = (perDevice.get(item.deviceId) ?? 0) + 1;
    perDevice.set(item.deviceId, n);
    return n <= MAX_PER_DEVICE;
  });
  return kept.slice(0, MAX_ENTRIES);
}

function validate(p: unknown): VaultProjectInput | undefined {
  if (p === null || typeof p !== "object") return undefined;
  const { deviceId, dir, repoKey } = p as Record<string, unknown>;
  if (typeof deviceId !== "string" || deviceId.length === 0) return undefined;
  if (typeof dir !== "string" || dir.length === 0 || dir.length > MAX_DIR_LENGTH) return undefined;
  if (repoKey !== undefined && (typeof repoKey !== "string" || repoKey.length === 0 || repoKey.length > MAX_REPO_KEY_LENGTH)) return undefined;
  return { deviceId, dir, ...(repoKey !== undefined ? { repoKey } : {}) };
}

export function createVaultProjects({ file, now = Date.now }: { file: string; now?: () => number }): VaultProjects {
  /** key → last write time (and device, for the per-device bound). Bounded like the file. */
  const written = new Map<string, { deviceId: string; at: number }>();
  let chain: Promise<unknown> = Promise.resolve();
  let warnedCorrupt = false;

  const remember = (key: string, deviceId: string, at: number): void => {
    written.set(key, { deviceId, at });
    const items = [...written].map(([k, v]) => ({ k, ...v }));
    const keep = new Set(bound(items, (i) => i.at).map((i) => i.k));
    for (const k of [...written.keys()]) if (!keep.has(k)) written.delete(k);
  };

  const write = (project: VaultProjectInput, at: number): Promise<void> =>
    withLockedJsonFile(
      file,
      () => {
        // A corrupt file reads as `{}` (a byte copy is kept), so the write replaces it.
        const { data } = readJsonChecked<Doc>(file, LOG_TAG);
        const rest = liveEntries(data, at).filter((e) => !(e.deviceId === project.deviceId && e.dir === project.dir));
        const entry: VaultProjectEntry = { ...project, lastSeenAt: at };
        writeJsonAtomic(file, { projects: bound([...rest, entry], (e) => e.lastSeenAt) });
      },
      { logTag: LOG_TAG, createIfMissing: false },
    );

  return {
    list() {
      try {
        const checked = readJsonChecked<Doc>(file, LOG_TAG);
        if (checked.corrupt) {
          if (!warnedCorrupt) {
            const backup = findBackup(file);
            console.warn(`[${LOG_TAG}] projects file corrupt, copy kept as ${backup ? path.basename(backup) : "none"}`);
          }
          warnedCorrupt = true;
          return [];
        }
        warnedCorrupt = false;
        return liveEntries(checked.data, now());
      } catch (err) {
        console.warn(`[${LOG_TAG}] projects read failed: ${(err as Error)?.name ?? "error"}`);
        return [];
      }
    },

    async record(input) {
      const project = validate(input);
      if (!project) return;
      const key = keyOf(project.deviceId, project.dir);
      const at = now();
      const last = written.get(key);
      if (last && at - last.at <= WRITE_THROTTLE_MS) return;
      remember(key, project.deviceId, at);
      const job = chain.then(() => write(project, at));
      chain = job.catch(() => undefined);
      try {
        await job;
      } catch (err) {
        written.delete(key); // retry on the next sync
        throw err;
      }
    },
  };
}
