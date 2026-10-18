/**
 * The live "Request access" knock of THIS tab, in `sessionStorage`, shared by the
 * `/pair?request` landing (writer) and the network-denied bar (reader) so the bar
 * can show the waiting code or the refusal reason after the landing hands back.
 * Storage may be unavailable (private mode, disabled): every access degrades to "no knock".
 *
 * See change: add-lan-knock-pairing (D9); retire-trusted-networks-bypass (D6b, C2/C3).
 */

/** The live knock this tab is waiting on. */
export interface StoredKnock {
  pendingId: string;
  confirmCode: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** The last refusal the server returned to this tab. */
export interface StoredRefusal {
  code: string;
  /** Epoch ms until which a retry is pointless (`knock_rate_limited`). */
  cooldownUntil?: number;
  /** Epoch ms the refusal was received. */
  at: number;
}

const KNOCK_STORE_KEY = "pi-dashboard:pair-request";
const KNOCK_REFUSAL_KEY = "pi-dashboard:pair-request-refusal";
/** A refusal older than this no longer describes the device's situation. */
const REFUSAL_TTL_MS = 10 * 60_000;

function readJson(key: string): unknown {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage disabled — the request still works, it just cannot survive a reload */
  }
}

function clear(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readStoredKnock(): StoredKnock | null {
  const v = readJson(KNOCK_STORE_KEY) as Partial<StoredKnock> | null;
  if (v && typeof v.pendingId === "string" && typeof v.confirmCode === "string" && typeof v.expiresAt === "number") {
    return { pendingId: v.pendingId, confirmCode: v.confirmCode, expiresAt: v.expiresAt };
  }
  return null;
}

export const writeStoredKnock = (req: StoredKnock): void => write(KNOCK_STORE_KEY, req);
export const clearStoredKnock = (): void => clear(KNOCK_STORE_KEY);

function readStoredRefusal(): StoredRefusal | null {
  const v = readJson(KNOCK_REFUSAL_KEY) as Partial<StoredRefusal> | null;
  if (v && typeof v.code === "string" && typeof v.at === "number") {
    return { code: v.code, at: v.at, ...(typeof v.cooldownUntil === "number" ? { cooldownUntil: v.cooldownUntil } : {}) };
  }
  return null;
}

export const writeStoredRefusal = (r: StoredRefusal): void => write(KNOCK_REFUSAL_KEY, r);
export const clearStoredRefusal = (): void => clear(KNOCK_REFUSAL_KEY);

/** What the denied bar shows: nothing yet, a live waiting code, or the last refusal. */
export type KnockView =
  | { kind: "idle" }
  | { kind: "pending"; confirmCode: string; expiresAt: number }
  | { kind: "refused"; code: string; cooldownUntil?: number };

/** Pure: pick the view for `now`. A live knock outranks an older refusal. */
export function knockViewAt(now: number): KnockView {
  const req = readStoredKnock();
  if (req && req.expiresAt > now) return { kind: "pending", confirmCode: req.confirmCode, expiresAt: req.expiresAt };
  const refusal = readStoredRefusal();
  if (refusal && now - refusal.at < REFUSAL_TTL_MS) {
    return { kind: "refused", code: refusal.code, ...(refusal.cooldownUntil ? { cooldownUntil: refusal.cooldownUntil } : {}) };
  }
  return { kind: "idle" };
}
