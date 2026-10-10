/**
 * `~/.pi/dashboard/services.json` — user-owned service definitions.
 *
 * - Reads are fresh every time (hand edits are picked up on the next ensure /
 *   list); no cached write base, so a stale copy never overwrites an edit.
 * - Every write is ONE read-modify-write inside `withLockedJsonFile`,
 *   re-reading the file under the lock, written with `writeJsonAtomic(…, 0o600)`.
 * - A corrupt file is quarantined byte-exact and REFUSES every write: a corrupt
 *   read yields `{}`, so writing would wipe every definition.
 * - `instanceId` is created once and never regenerated while the file exists.
 * - A missing file means zero services and is never created by a read.
 * See change: add-service-registry-core (D1, D7).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  SERVICE_SCHEMA_VERSION,
  type ServiceDefinition,
  validateDefinition,
} from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { readJsonChecked, withLockedJsonFile, writeJsonAtomic } from "../auth/locked-json-file.js";

export interface ServicesFile {
  schemaVersion: 1;
  instanceId: string;
  services: ServiceDefinition[];
}

/** One raw entry and its validation verdict. */
interface DefinitionEntry {
  id: string;
  raw: unknown;
  def?: ServiceDefinition;
  errors?: string[];
}

export type DefinitionsRead =
  | { ok: true; exists: boolean; instanceId?: string; entries: DefinitionEntry[] }
  | { ok: false; corrupt: true; backupPath?: string };

export class DefinitionsCorruptError extends Error {
  readonly code = "definitions-corrupt";
  constructor(readonly file: string, readonly backupPath?: string) {
    super(
      `Refusing to write: ${file} is corrupt` +
        (backupPath ? ` (byte-exact backup: ${backupPath})` : "") +
        ". Repair or remove it manually, then try again.",
    );
  }
}

const LOG_TAG = "services";

/** Newest `<file>.corrupt-*` sibling, i.e. the quarantine copy of the current bytes. */
export function latestBackup(file: string): string | undefined {
  try {
    const base = path.basename(file);
    const names = fs
      .readdirSync(path.dirname(file))
      .filter((n) => n.startsWith(`${base}.corrupt-`))
      .sort();
    return names.length > 0 ? path.join(path.dirname(file), names[names.length - 1]) : undefined;
  } catch {
    return undefined;
  }
}

function entriesOf(data: Record<string, unknown>): DefinitionEntry[] {
  const list = Array.isArray(data.services) ? (data.services as unknown[]) : [];
  return list.map((raw) => {
    const id = typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : "?";
    const r = validateDefinition(raw);
    return r.ok ? { id, raw, def: r.value } : { id, raw, errors: r.errors };
  });
}

export class DefinitionsStore {
  constructor(readonly file: string) {}

  read(): DefinitionsRead {
    const exists = fs.existsSync(this.file);
    if (!exists) return { ok: true, exists: false, entries: [] };
    const r = readJsonChecked<Record<string, unknown>>(this.file, LOG_TAG);
    if (r.corrupt) return { ok: false, corrupt: true, backupPath: latestBackup(this.file) };
    const instanceId = typeof r.data.instanceId === "string" ? r.data.instanceId : undefined;
    return { ok: true, exists: true, instanceId, entries: entriesOf(r.data) };
  }

  /**
   * Read-modify-write under the lock. `fn` receives the current file (fresh,
   * with `instanceId` minted if absent) and mutates `services` in place; it is
   * synchronous by the `withLockedJsonFile` contract. Throws
   * {@link DefinitionsCorruptError} on a corrupt file without writing.
   */
  async mutate(fn: (file: ServicesFile) => void): Promise<void> {
    await withLockedJsonFile(
      this.file,
      () => {
        const r = readJsonChecked<Record<string, unknown>>(this.file, LOG_TAG);
        if (r.corrupt) throw new DefinitionsCorruptError(this.file, latestBackup(this.file));
        const file: ServicesFile = {
          schemaVersion: SERVICE_SCHEMA_VERSION,
          instanceId: typeof r.data.instanceId === "string" ? r.data.instanceId : randomUUID(),
          services: Array.isArray(r.data.services) ? (r.data.services as ServiceDefinition[]) : [],
        };
        fn(file);
        writeJsonAtomic(this.file, { ...r.data, ...file }, 0o600);
      },
      { logTag: LOG_TAG },
    );
  }
}
