/**
 * Pure close-risk predicates shared by single tab close (`guardTabClose`) and
 * the bulk-close runner: one rule for "would closing this tab lose edits".
 *
 * `handlerCloseRisk` covers the file-handler branch only. A terminal tab is
 * risky in a BULK close only (single terminal close stays silent), so the
 * terminal reason lives in `planBulkClose`.
 *
 * See change: scope-anchor-editor-pane-controls (D6).
 */
import type { OpenFile } from "../../../lib/layout/editor-pane-state.js";
import { stripTermId } from "../../../lib/layout/use-terminal-pane-tabs.js";
import type { HandlerDirtyState } from "./file-handler-store.js";

/** What the close predicate needs from the pane / store (kept injectable for tests). */
export interface CloseRiskLookups {
  /** Handler instance key of `tab`, or `null` (no handler mode / not a session pane). */
  keyOf: (tab: OpenFile) => string | null;
  /** Instance for `key`; `undefined` when never mounted or evicted (= clean). */
  getInstance: (key: string) => { dirty: HandlerDirtyState } | undefined;
}

interface CloseRiskOptions {
  /** Treat a handler that never reported its dirty state (`"unknown"`) as risky. */
  unknownIsRisky: boolean;
}

/**
 * `"unsaved"` when closing `tab` would discard handler edits, else `null`.
 * `remainingTabs` are the tabs that STAY open: one sharing the instance key
 * keeps the instance alive, so closing `tab` loses nothing.
 */
export function handlerCloseRisk(
  tab: OpenFile,
  remainingTabs: readonly OpenFile[],
  lookups: CloseRiskLookups,
  { unknownIsRisky }: CloseRiskOptions,
): "unsaved" | null {
  const key = lookups.keyOf(tab);
  if (!key) return null;
  if (remainingTabs.some((t) => lookups.keyOf(t) === key)) return null;
  const inst = lookups.getInstance(key);
  if (!inst) return null;
  if (inst.dirty === true) return "unsaved";
  return inst.dirty === "unknown" && unknownIsRisky ? "unsaved" : null;
}

export type BulkRiskEntry =
  | { kind: "terminal"; id: string; reason: "terminal"; tabPaths: string[] }
  | { kind: "handler"; key: string; reason: "unsaved"; tabPaths: string[] };

export interface BulkClosePlan {
  /** Tab paths the operation closes (those present in `openFiles`). */
  targets: string[];
  /** Deduped entries needing confirmation (terminals + unsaved handler instances). */
  risky: BulkRiskEntry[];
  /** "Close all but these N": the number of tabs that stay open (risky tabs). */
  keptCount: number;
}

/**
 * Plan a bulk close of `targetPaths`. Unknown-state handlers are NOT risky here
 * (user decision, recorded in the `editor-pane-file-handlers` delta).
 */
export function planBulkClose(
  openFiles: readonly OpenFile[],
  targetPaths: readonly string[],
  lookups: CloseRiskLookups,
): BulkClosePlan {
  const wanted = new Set(targetPaths);
  const targetTabs = openFiles.filter((f) => wanted.has(f.path));
  const remaining = openFiles.filter((f) => !wanted.has(f.path));
  const risky: BulkRiskEntry[] = [];
  const byKey = new Map<string, Extract<BulkRiskEntry, { kind: "handler" }>>();
  for (const tab of targetTabs) {
    const termId = tab.viewer === "terminal" ? stripTermId(tab.path) : null;
    if (termId !== null) {
      risky.push({ kind: "terminal", id: termId, reason: "terminal", tabPaths: [tab.path] });
      continue;
    }
    if (handlerCloseRisk(tab, remaining, lookups, { unknownIsRisky: false }) === null) continue;
    const key = lookups.keyOf(tab) as string;
    const entry = byKey.get(key);
    if (entry) entry.tabPaths.push(tab.path);
    else {
      const created = { kind: "handler" as const, key, reason: "unsaved" as const, tabPaths: [tab.path] };
      byKey.set(key, created);
      risky.push(created);
    }
  }
  return {
    targets: targetTabs.map((t) => t.path),
    risky,
    keptCount: risky.reduce((n, e) => n + e.tabPaths.length, 0),
  };
}
