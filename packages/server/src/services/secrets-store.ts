/**
 * `~/.pi/dashboard/services-secrets.json` — the service secret store, keyed
 * `<serviceId>/<name>`, separate from every other credential file.
 *
 * Same discipline as the definitions file, stricter than
 * `plugin-credential-store`: on a corrupt file EVERY write is refused (the file
 * is multi-service, so a fresh write would wipe other services' secrets); the
 * bytes are quarantined byte-exact and `status` names the backup. There is no
 * method that returns a value to a dashboard surface: `get` exists only for
 * the delivery paths (container mount, child env).
 * See change: add-service-registry-core (D8).
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { readJsonChecked, withLockedJsonFile, writeJsonAtomic } from "../auth/locked-json-file.js";
import { latestBackup } from "./definitions-store.js";

const LOG_TAG = "services";

export class SecretsCorruptError extends Error {
  readonly code = "secrets-corrupt";
  constructor(readonly file: string, readonly backupPath?: string) {
    super(
      `Refusing to write: ${file} is corrupt` +
        (backupPath ? ` (byte-exact backup: ${backupPath})` : "") +
        ". Repair or remove it manually, then try again.",
    );
  }
}

type Bag = Record<string, string>;

/** A `<serviceId>/<name>` key in the store. */
export interface StoreSlot {
  id: string;
  name: string;
}

export interface SecretsStatus {
  corrupt: boolean;
  backupPath?: string;
}

export class SecretsStore {
  constructor(readonly file: string) {}

  private readBag(): { corrupt: boolean; bag: Bag } {
    if (!fs.existsSync(this.file)) return { corrupt: false, bag: {} };
    const r = readJsonChecked<{ secrets?: unknown }>(this.file, LOG_TAG);
    if (r.corrupt) return { corrupt: true, bag: {} };
    const s = r.data.secrets;
    const bag: Bag = {};
    if (s && typeof s === "object" && !Array.isArray(s)) {
      for (const [k, v] of Object.entries(s)) if (typeof v === "string") bag[k] = v;
    }
    return { corrupt: false, bag };
  }

  status(): SecretsStatus {
    const { corrupt } = this.readBag();
    return corrupt ? { corrupt, backupPath: latestBackup(this.file) } : { corrupt };
  }

  /** Delivery-only read. `undefined` = not set; throws on a corrupt store. */
  get(id: string, name: string): string | undefined {
    const { corrupt, bag } = this.readBag();
    if (corrupt) throw new SecretsCorruptError(this.file, latestBackup(this.file));
    return bag[`${id}/${name}`];
  }

  /**
   * `configured` per secret name — the ONLY view a REST/CLI surface ever gets.
   * `slots` maps each declared name to the store slot its ref resolves to.
   */
  configured(slots: Record<string, StoreSlot>): Record<string, { configured: boolean }> {
    const { bag } = this.readBag();
    return Object.fromEntries(
      Object.entries(slots).map(([n, s]) => [n, { configured: typeof bag[`${s.id}/${s.name}`] === "string" }]),
    );
  }

  private async mutate(fn: (bag: Bag) => void): Promise<void> {
    await withLockedJsonFile(
      this.file,
      () => {
        const r = readJsonChecked<Record<string, unknown>>(this.file, LOG_TAG);
        if (r.corrupt) throw new SecretsCorruptError(this.file, latestBackup(this.file));
        const raw = r.data.secrets;
        const bag: Bag = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...(raw as Bag) } : {};
        fn(bag);
        writeJsonAtomic(this.file, { version: 1, secrets: bag }, 0o600);
      },
      { logTag: LOG_TAG },
    );
  }

  async set(id: string, name: string, value: string): Promise<void> {
    await this.mutate((bag) => {
      bag[`${id}/${name}`] = value;
    });
  }

  /**
   * Generate missing values inside the single locked read-modify-write
   * (synchronous `randomBytes`), so there is no second lock and no lost update.
   * An existing value is kept.
   */
  async generate(specs: ReadonlyArray<StoreSlot & { bytes: number }>): Promise<void> {
    if (specs.length === 0) return;
    await this.mutate((bag) => {
      for (const { id, name, bytes } of specs) {
        const key = `${id}/${name}`;
        if (typeof bag[key] !== "string") bag[key] = randomBytes(bytes).toString("base64url");
      }
    });
  }

  /** Remove every `<id>/*` key. A missing file is a no-op (never created). */
  async deleteService(id: string): Promise<void> {
    if (!fs.existsSync(this.file)) return;
    await this.mutate((bag) => {
      for (const k of Object.keys(bag)) if (k.startsWith(`${id}/`)) delete bag[k];
    });
  }
}
