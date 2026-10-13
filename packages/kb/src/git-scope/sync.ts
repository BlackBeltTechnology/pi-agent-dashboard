// Forge sync (design G4): lazy, incremental, budgeted. Per endpoint: a keyset
// cursor `{since, page}` advanced in the SAME fenced transaction as the page's
// items, so a crash applies nothing from a page and the next sync re-requests it.
import { createHash } from "node:crypto";
import type { GitConfig } from "../config.js";
import type { Chunk, KbStore, RawDb } from "../types.js";
import type { GitScopeDeps } from "./deps.js";
import { type ForgeAdapter, type ForgeEndpoint, type ForgeItem, type ForgePage, ForgeRateLimited, ForgeUnavailable, type RateInfo } from "./forge/types.js";
import { type GitLease, LeaseLostError } from "./lease.js";
import { buildEdges, type LinkCtx, repointIssuePlaceholder, sharedNumberSpace } from "./links.js";
import { GIT_ROOT, metaDelete, metaGet, metaJson, metaSet, metaSetJson } from "./store.js";

const DEFAULT_BACKOFF_MS = 15 * 60_000;
const DAY_MS = 86_400_000;

interface Cursor {
  since: string;
  page: number;
  /** Still draining the initial window (bounded by firstSyncMaxItems per sync). */
  first: boolean;
}
export interface ForgeState {
  lastSyncAt: number;
  lastAttemptAt: number;
  rate: RateInfo | null;
  backoffUntil: number;
  unavailable: string | null;
  identity: string | null;
}

/** Item → single chunk. `headingPath` is `<hit prefix> > <title>` (`pr #12 [open] · date · @author > title`). */
function itemChunk(i: ForgeItem): Chunk {
  const path = `${i.kind}/${i.number}`;
  const body = [i.title, "", ...(i.labels.length ? [`Labels: ${i.labels.join(", ")}`] : []), `State: ${i.state}`, `Author: @${i.author}`, `Created: ${i.createdAt}`, `Updated: ${i.updatedAt}`, ...(i.body.trim() ? ["", i.body.trim()] : [])].join("\n");
  return {
    root: GIT_ROOT,
    path,
    chunkId: `${path}#0`,
    headingPath: `${i.kind} #${i.number} [${i.state}] · ${i.updatedAt.slice(0, 10)} · @${i.author} > ${i.title}`,
    heading: i.title,
    level: 0,
    parentChunkId: null,
    docType: "doc",
    body,
    bodyHash: createHash("sha256").update(body).digest("hex"),
  };
}

export function readForgeState(store: KbStore): ForgeState {
  return store.read!((db) => ({
    lastSyncAt: Number(metaGet(db, "forge.lastSyncAt") ?? 0),
    lastAttemptAt: Number(metaGet(db, "forge.lastAttemptAt") ?? 0),
    rate: metaJson<RateInfo>(db, "forge.rate"),
    backoffUntil: Number(metaGet(db, "forge.backoffUntil") ?? 0),
    unavailable: metaGet(db, "forge.unavailable"),
    identity: metaGet(db, "forge.identity"),
  }));
}

/** The rate observation expires at its reset time; below the floor only while it is in force. */
export function rateFloorActive(rate: RateInfo | null, floorPercent: number, now: number): boolean {
  if (!rate || rate.limit <= 0 || now >= rate.resetAt) return false;
  return (rate.remaining / rate.limit) * 100 < floorPercent;
}

/** Is a forge sync permitted right now? (staleness, back-off and rate floor). */
export function forgeSyncDue(s: ForgeState, cfg: GitConfig, now: number, hintMs: number | null, bypassInterval = false): boolean {
  if (now < s.backoffUntil) return false;
  if (rateFloorActive(s.rate, cfg.forge.rateFloorPercent, now)) return false;
  if (bypassInterval) return true;
  const last = Math.max(s.lastSyncAt, s.lastAttemptAt);
  if (last === 0) return true;
  const hinted = hintMs !== null && hintMs > s.lastSyncAt;
  const interval = (hinted ? cfg.forge.hintedMinSyncIntervalSeconds : cfg.forge.minSyncIntervalSeconds) * 1000;
  return now - last >= interval;
}

/** Remote changed forge repository (or stopped being supported): drop forge items,
 *  cursors, ETags, rate and comments; keep commits and the links that point at the
 *  now-vanished items (they become placeholders). One idempotent transaction. */
export function reconcileForgeIdentity(store: KbStore, identity: string | null): void {
  const want = identity ?? "";
  const seen = store.read!((db) => metaGet(db, "forge.identity"));
  if (seen !== null && seen === want) return;
  store.immediate!((db) => {
    const cur = metaGet(db, "forge.identity");
    if (cur !== null && cur === want) return;
    db.prepare("DELETE FROM chunks WHERE rowid IN (SELECT rid FROM item_rows WHERE root=? AND (path LIKE 'pr/%' OR path LIKE 'issue/%'))").run(GIT_ROOT);
    db.prepare("DELETE FROM item_rows WHERE root=? AND (path LIKE 'pr/%' OR path LIKE 'issue/%')").run(GIT_ROOT);
    db.prepare("DELETE FROM edges WHERE src IN (SELECT id FROM nodes WHERE type='file' AND path IS NOT NULL AND (name LIKE 'pr/%' OR name LIKE 'issue/%'))").run();
    db.prepare("UPDATE nodes SET path=NULL WHERE type='file' AND (name LIKE 'pr/%' OR name LIKE 'issue/%')").run();
    db.prepare("DELETE FROM nodes WHERE type='file' AND path IS NULL AND (name LIKE 'pr/%' OR name LIKE 'issue/%') AND id NOT IN (SELECT dst FROM edges)").run();
    db.prepare("DELETE FROM git_comments").run();
    db.prepare("DELETE FROM git_meta WHERE key LIKE 'forge.%'").run();
    metaSet(db, "forge.identity", want);
  });
}

export interface ForgeSyncArgs {
  deps: GitScopeDeps;
  cfg: GitConfig;
  store: KbStore;
  lease: GitLease;
  adapter: ForgeAdapter;
  identity: string;
  link: LinkCtx;
  signal: AbortSignal;
}
export interface ForgeSyncStats {
  requests: number;
  notModified: number;
  items: number;
  capped: boolean;
  stoppedBy: "rate-floor" | "back-off" | "unavailable" | "error" | null;
}

const ms = (iso: string): number => Date.parse(iso);

/** Next cursor after a page was applied (see design G4: keyset + cohort walk). */
function nextCursor(cur: Cursor, items: ForgeItem[], full: boolean): Cursor {
  if (items.length === 0) return { since: cur.since, page: 1, first: false };
  const firstTs = items[0].updatedAt;
  const lastTs = items[items.length - 1].updatedAt;
  const advanced = ms(lastTs) > ms(cur.since) ? lastTs : cur.since;
  if (!full) return { since: advanced, page: 1, first: false };
  // a full page sharing ONE timestamp cannot advance `since`: walk pages within that cohort
  if (ms(firstTs) === ms(lastTs)) return { since: lastTs, page: ms(cur.since) === ms(lastTs) ? cur.page + 1 : 2, first: cur.first };
  return { since: lastTs, page: 1, first: cur.first };
}

function applyItem(a: ForgeSyncArgs, db: RawDb, item: ForgeItem): void {
  const chunk = itemChunk(item);
  a.store.replaceItem!(GIT_ROOT, chunk.path, [chunk], buildEdges(db, chunk.path, `${item.title}\n${item.body}`, a.link));
  if (item.kind === "pr" && sharedNumberSpace(a.adapter.id)) repointIssuePlaceholder(db, item.number);
}

class StopSync extends Error {
  readonly by: NonNullable<ForgeSyncStats["stoppedBy"]>;
  constructor(by: NonNullable<ForgeSyncStats["stoppedBy"]>) {
    super(by);
    this.by = by;
  }
}

/** One page applied in ONE fenced transaction: items + cursor (+ ETag, rate) commit together. */
function applyPage(a: ForgeSyncArgs, ep: ForgeEndpoint, used: Cursor, next: Cursor, page: ForgePage): void {
  a.lease.fenced((db) => {
    if (metaGet(db, "forge.identity") !== a.identity) throw new LeaseLostError(); // remote switched under us
    for (const item of page.items) applyItem(a, db, item);
    if (page.rate) metaSetJson(db, "forge.rate", page.rate);
    metaSetJson(db, `forge.cursor.${ep}`, next);
    if (page.status === "ok" && used.page === 1 && page.etag) metaSetJson(db, `forge.etag.${ep}`, { etag: page.etag, since: used.since });
  });
}

/** The stored validator, only when it belongs to exactly this `since` (page 1). */
function validatorFor(store: KbStore, ep: ForgeEndpoint, cursor: Cursor): string | null {
  if (cursor.page !== 1) return null;
  const et = store.read!((db) => metaJson<{ etag: string; since: string }>(db, `forge.etag.${ep}`));
  return et && ms(et.since) === ms(cursor.since) ? et.etag : null;
}

/** Everything that must hold before each forge request. Returns false when the first-sync cap ends this sync. */
function mayRequest(a: ForgeSyncArgs, cursor: Cursor, applied: number): boolean {
  if (a.signal.aborted) throw new Error("aborted");
  if (rateFloorActive(a.store.read!((db) => metaJson<RateInfo>(db, "forge.rate")), a.cfg.forge.rateFloorPercent, a.deps.now())) throw new StopSync("rate-floor");
  if (cursor.first && applied >= a.cfg.forge.firstSyncMaxItems) return false; // continue next sync
  if (!a.lease.extend()) throw new LeaseLostError(); // heartbeat before each network request
  return true;
}

async function syncEndpoint(a: ForgeSyncArgs, ep: ForgeEndpoint, stats: ForgeSyncStats): Promise<void> {
  const { deps, cfg, store } = a;
  let cursor = store.read!((db) => metaJson<Cursor>(db, `forge.cursor.${ep}`)) ?? { since: new Date(deps.now() - cfg.forge.firstSyncWindowDays * DAY_MS).toISOString(), page: 1, first: true };
  let applied = 0;
  for (let pages = 0; pages < cfg.forge.pagesPerSync; pages++) {
    if (!mayRequest(a, cursor, applied)) break;
    const used = cursor;
    const page = await a.adapter.list(ep, { since: used.since, page: used.page, etag: validatorFor(store, ep, used), signal: a.signal });
    stats.requests++;
    if (page.status === "not_modified") stats.notModified++;
    const next = page.status === "not_modified" ? used : nextCursor(used, page.items, page.full);
    applyPage(a, ep, used, next, page);
    stats.items += page.items.length;
    applied += page.items.length;
    cursor = next;
    if (page.status === "not_modified" || !page.full) return; // caught up
  }
  stats.capped = true; // cap reached with more pending: the next permitted sync continues from the cursor
}

/** One sync round over every endpoint. Failures are recorded, never thrown (except lease loss / abort). */
export async function syncForge(a: ForgeSyncArgs): Promise<ForgeSyncStats> {
  const t0 = Date.now();
  const stats: ForgeSyncStats = { requests: 0, notModified: 0, items: 0, capped: false, stoppedBy: null };
  const record = (fn: (db: RawDb) => void) => a.lease.fenced(fn);
  try {
    for (const ep of a.adapter.endpoints) await syncEndpoint(a, ep, stats);
    record((db) => {
      metaSet(db, "forge.lastSyncAt", String(a.deps.now()));
      metaDelete(db, "forge.unavailable");
      metaDelete(db, "forge.backoffUntil");
    });
  } catch (e) {
    if (e instanceof LeaseLostError || a.signal.aborted) throw e;
    const now = a.deps.now();
    if (e instanceof StopSync) {
      stats.stoppedBy = e.by;
    } else if (e instanceof ForgeRateLimited) {
      stats.stoppedBy = "back-off";
      record((db) => {
        metaSet(db, "forge.backoffUntil", String(e.retryAt ?? now + DEFAULT_BACKOFF_MS));
        metaSet(db, "forge.lastAttemptAt", String(now));
        if (e.rate) metaSetJson(db, "forge.rate", e.rate);
      });
    } else if (e instanceof ForgeUnavailable) {
      stats.stoppedBy = "unavailable";
      record((db) => {
        metaSet(db, "forge.unavailable", e.reason);
        metaSet(db, "forge.lastAttemptAt", String(now));
      });
    } else {
      stats.stoppedBy = "error";
      record((db) => {
        metaSet(db, "lastError", `forge sync failed: ${(e as Error).message}`);
        metaSet(db, "forge.lastAttemptAt", String(now));
      });
    }
  }
  const rate = a.store.read!((db) => metaJson<RateInfo>(db, "forge.rate"));
  const cursors = a.adapter.endpoints.map((ep) => a.store.read!((db) => metaGet(db, `forge.cursor.${ep}`)) ?? "none").join(",");
  a.deps.log(
    `forge=${a.adapter.id} endpoints=${a.adapter.endpoints.join("+")} requests=${stats.requests} not_modified=${stats.notModified} items=${stats.items} remaining=${rate?.remaining ?? "?"}/${rate?.limit ?? "?"} cursor=${cursors} capped=${stats.capped} stopped=${stats.stoppedBy ?? "no"} ms=${Date.now() - t0}`,
  );
  return stats;
}
