/**
 * The remembered-refusal ledger (spec `access-grant-yolo`; tasks 2b.9, 8b.4a).
 *
 * The one piece of persisted state this change owns. When the operator
 * EXPLICITLY denies a subject on a YOLO-eligible plane, the refusal is recorded
 * here so a later YOLO session can never silently reverse it: while a session is
 * active, that subject is refused without prompting and recorded as
 * refused-by-prior-refusal instead of being auto-allowed.
 *
 * Lifetime (resolved, clarification C4): DURABLE. It survives a restart, never
 * self-expires, and is cleared only by an explicit operator action on the Access
 * surface. It grants nothing on its own, so leaving it in place across a rollback
 * is fail-safe.
 *
 * Only an explicit `deny` is recorded (dismissal is a deny, per the dialog spec).
 * An expiry is not a refusal: nobody answered.
 *
 * Store conventions mirror `access-grants.json`: the dashboard config dir by
 * default, `PI_ACCESS_REFUSALS_STORE` to override it in tests, atomic temp+rename
 * writes, and a missing or malformed file read as empty.
 *
 * See change: add-access-grant-dialog.
 */
import * as fs from "node:fs";
import path from "node:path";
import type { AccessPlaneId } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

export interface Refusal {
  plane: AccessPlaneId;
  subject: string;
  refusedAt: number;
}

interface StoreFile {
  version: 1;
  refusals: Refusal[];
}

const PLANES: ReadonlySet<string> = new Set(["filesystem", "cwd", "network", "cors"]);

export function refusalLedgerPath(): string {
  const override = process.env.PI_ACCESS_REFUSALS_STORE;
  if (override?.trim()) return path.resolve(override);
  return path.join(getDashboardConfigDir(), "access-refusals.json");
}

let cache: Refusal[] | null = null;

/** Test seam: drop the cache (simulates a restart). */
export function __resetRefusalLedger(): void {
  cache = null;
}

function load(): Refusal[] {
  if (cache) return cache;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(refusalLedgerPath(), "utf8"));
  } catch {
    cache = [];
    return cache;
  }
  const list = (parsed as Partial<StoreFile> | null)?.refusals;
  cache = Array.isArray(list)
    ? list.filter(
        (r): r is Refusal =>
          !!r &&
          typeof r === "object" &&
          typeof r.subject === "string" &&
          r.subject !== "" &&
          typeof r.plane === "string" &&
          PLANES.has(r.plane) &&
          typeof r.refusedAt === "number",
      )
    : [];
  return cache;
}

function save(refusals: Refusal[]): { ok: true } | { ok: false; error: string } {
  const target = refusalLedgerPath();
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, refusals } satisfies StoreFile, null, 2), "utf8");
    fs.renameSync(tmp, target);
    cache = refusals;
    return { ok: true };
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    // The cache is left as it was, so a failed write never changes behaviour.
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
}

export function listRefusals(): Refusal[] {
  return [...load()];
}

export function isRefused(plane: AccessPlaneId, subject: string): boolean {
  return load().some((r) => r.plane === plane && r.subject === subject);
}

/** Remember an explicit deny. Idempotent per (plane, subject). */
export function recordRefusal(
  plane: AccessPlaneId,
  subject: string,
  now: number = Date.now(),
): { ok: true } | { ok: false; error: string } {
  if (isRefused(plane, subject)) return { ok: true };
  return save([...load(), { plane, subject, refusedAt: now }]);
}

/** The operator's explicit clear, from the Access surface. */
export function clearRefusal(plane: AccessPlaneId, subject: string): boolean {
  const current = load();
  const remaining = current.filter((r) => !(r.plane === plane && r.subject === subject));
  if (remaining.length === current.length) return false;
  return save(remaining).ok;
}
