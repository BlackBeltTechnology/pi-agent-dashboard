# Optimistic pending feedback for the KB Index-now button

## Why

`add-kb-folder-slot` gives each folder row an **Index now** button; `2026-07-04-fix-kb-index-feedback` then made the reindex route non-blocking (`202`), the walk async (so `/stats` is served mid-walk), and the `indexing` spinner reachable *once the job is observed running*. That fix closed the "spinner never shows during the walk" gap. It did **not** close the gap **between the click and the first `indexing: true` observation**.

The click handler `reindex()` performs exactly one state mutation — `setReindexError(null)` — and since `reindexError` is already `null` on a fresh click, **nothing re-renders**. The button then sits on `KB · NOT INDEXED` / `Index now` through **two sequential network round-trips**:

```
click ─▶ reindex()  ── setReindexError(null)   (no visible change)
        ▸ POST /api/kb/reindex        round-trip #1  ── button still "Index now"
        ▸ .then(refetch) → GET /stats round-trip #2  ── button still "Index now"
        ▸ stats.indexing === true → spinner          ── FIRST visible feedback
```

On a busy server, a large folder registration, or a slow link, that window is seconds long. During it the button looks dead: the user gets no signal the click landed, may click again, or concludes it is broken. This is the exact complaint — *"when I push to index, no UX response that it is pushed, and it just waits for the kb index response state from the server."* The server is healthy; the missing piece is **optimistic client feedback on click**.

Two secondary problems fall out of the same gap:
- **Double-submit is possible** during the pending window — the button stays enabled, so a second click fires a second `POST /reindex` (harmless server-side thanks to per-cwd coalescing, but a UX smell and a wasted request).
- The remaining latency undermines the five-state design's promise that the primary action is *visibly responsive*.

## What Changes

- **Optimistically enter the `indexing` presentation the instant `Index now` (or reindex) is clicked**, before the server acknowledges. `useKbStats` gains a `pending` flag set `true` synchronously inside `reindex()`. `FolderKbSection` treats `pending || stats.indexing` as the existing `indexing` branch — the SAME animated spinner and label the running job already uses. No new visual state; the in-flight click looks identical to an in-progress index (per the design decision: fold into the spinner, do not add a distinct "submitting…" affordance).
- **Disable the action button during the pending/indexing window** to block double-submits. While `pending || stats.indexing` is true the reindex / `Index now` control is non-interactive.
- **Clear `pending` only on a definitive outcome, never on the bare `202`.** `pending` stays true until either (a) the trigger POST is rejected → `reindexError` drives the `error` + `Retry` state and `pending` clears, or (b) a `/stats` poll actually observes `indexing: true` (the real job took over the spinner) — after which `pending` clears and normal poll-driven state owns the row. A short timeout guard clears a stuck `pending` if neither is ever observed (e.g. the job settled faster than the first poll), so the row can never wedge on a permanent optimistic spinner.
- **No server, route, schema, config, or indexer change.** This is a pure client-hook + component change layered on the already-shipped non-blocking route. The `pending`→real-`indexing` handoff reuses the existing `refetch()`/poll machinery untouched.

## Capabilities

### Modified Capabilities
- `kb-folder-slot`: the **KB row reflects index state** requirement gains an explicit scenario that activating the primary action shows the indexing indicator **immediately on click** (optimistic), before the server's `202`/first `/stats`, and that the action control is **disabled** for the pending+indexing window to prevent double-submit. The optimistic indicator must resolve into either the real polled `indexing` state or the `error`/`Retry` state — never a permanent spinner.

## Impact

- **Client only** (2 files):
  - `packages/kb-plugin/src/client/useKbStats.ts` — add a `pending` boolean to `UseKbStatsResult`; set it `true` synchronously at the top of `reindex()`; clear it on trigger reject (alongside setting `reindexError`) and once a subsequent `/stats` load observes `indexing: true`; add a bounded timeout guard so `pending` cannot outlive a fast-settling job.
  - `packages/kb-plugin/src/client/FolderKbSection.tsx` — derive the display from `pending || deriveKbRowState(stats)` so a pending click renders the existing `indexing` branch; add `disabled` (+ non-interactive styling) to the reindex / `Index now` buttons while `pending || indexing`.
- **Tests**: `packages/kb-plugin/src/client/__tests__/` — assert (a) the spinner renders synchronously on click before any `/stats` resolves, (b) the button is disabled during pending so a second click fires no second POST, (c) `pending` clears into the real polled `indexing` state and then `populated`, (d) a rejected trigger clears `pending` into `error` + `Retry`, (e) a job that settles before the first poll does not leave a stuck spinner (timeout guard).
- **Docs drift**: per-file `AGENTS.md` rows for `useKbStats.ts` and `FolderKbSection.tsx` gain the `pending` optimistic-feedback note + `See change: add-kb-index-optimistic-pending`.
- **Out of scope**:
  - Live per-file progress during the walk (still spinner + polled chunk count — a separate WS-progress enhancement).
  - Any server / route / indexer / schema / config change (the non-blocking route from `fix-kb-index-feedback` is a prerequisite, not re-touched).
  - The five-state visual language and the settings page (unchanged; `pending` reuses the `indexing` visuals verbatim).
  - The in-session `kb-extension` reindex triggers (untouched).

## Discipline Skills

- `doubt-driven-review` — the `pending`-clear invariant (never on bare `202`; guard against a permanent optimistic spinner) is the one subtle, easy-to-get-wrong decision; stress-test it before it stands.
