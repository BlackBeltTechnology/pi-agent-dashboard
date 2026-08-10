# reconcile-session-order.ts — index

Pure startup reconciliation of persisted `sessionOrder` map under all-status model. Exports `reconcileSessionOrder(orders, sessions, resolveKey)` — prunes stale ids, backfills ended ids absent from stored list ordered by `(endedAt ?? startedAt)` desc. Returns changed keys only. Side-effect free.
