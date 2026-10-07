/**
 * Persistent store for role bindings: `~/.pi/dashboard/role-bindings.json`
 * (dashboard-owned; never providers.json, never a third-party target).
 * Versioned, tmp+rename writes. A missing or unparseable file is "no bindings"
 * and is never repaired by writing a target.
 *
 * See change: add-role-aware-model-refs (D11).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Concrete {
  provider: string;
  id: string;
  level?: string;
}
export type BindingStatus = "ok" | "detached" | "dangling";
interface StoredBinding {
  ref: string;
  projected: Concrete;
  status: BindingStatus;
  updatedAt: string;
}
export interface StoreData {
  version: 1;
  owners: Record<string, Record<string, StoredBinding>>;
}

const emptyStore = (): StoreData => ({ version: 1, owners: {} });

function isConcrete(v: unknown): v is Concrete {
  const c = v as Concrete;
  return !!c && typeof c.provider === "string" && typeof c.id === "string";
}

/** Load; on corrupt/missing returns empty. `onCorrupt` fires for unparseable (not missing). */
export function loadStore(file: string, onCorrupt?: (reason: string) => void): StoreData {
  let text: string;
  try {
    text = readFileSync(file, "utf-8");
  } catch {
    return emptyStore();
  }
  try {
    const raw = JSON.parse(text) as StoreData;
    if (!raw || raw.version !== 1 || typeof raw.owners !== "object" || raw.owners === null) {
      throw new Error("unexpected shape");
    }
    const out = emptyStore();
    for (const [owner, fields] of Object.entries(raw.owners)) {
      if (!fields || typeof fields !== "object") continue;
      const kept: Record<string, StoredBinding> = {};
      for (const [field, b] of Object.entries(fields)) {
        if (b && typeof b.ref === "string" && isConcrete(b.projected)) {
          const status: BindingStatus = b.status === "detached" || b.status === "dangling" ? b.status : "ok";
          kept[field] = { ref: b.ref, projected: b.projected, status, updatedAt: String(b.updatedAt ?? "") };
        }
      }
      if (Object.keys(kept).length) out.owners[owner] = kept;
    }
    return out;
  } catch (e) {
    onCorrupt?.(e instanceof Error ? e.message : String(e));
    return emptyStore();
  }
}

export function saveStore(file: string, data: StoreData): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  renameSync(tmp, file);
}
