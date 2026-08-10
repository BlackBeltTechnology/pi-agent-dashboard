## Context

`add-kb-folder-slot` shipped the five-state KB row; `fix-kb-index-feedback` made the reindex route non-blocking (`202 { status:"running" }`), the walk async (so `GET /api/kb/stats` is answered mid-walk), and split trigger errors (`reindexError`) from resilient poll errors (`error`). The infrastructure to show a live spinner works — `useKbStats` polls `/stats` every second while `stats.indexing === true`.

The remaining defect is purely the **latency before the first `indexing:true` is observed**. After `fix-kb-index-feedback`:

```
POST-FIX (non-blocking) but STILL no click-time feedback

  click ─▶ reindex()  ── setReindexError(null)         no re-render (already null)
        ▸ POST /api/kb/reindex ─────────▶ 202 running   round-trip #1  (button: "Index now")
        ▸ .then(refetch) → nonce++
        ▸ GET /api/kb/stats ────────────▶ indexing:true  round-trip #2  (button: "Index now")
        ▸ deriveKbRowState → "indexing" → spinner        FIRST visible feedback
```

Two round-trips of dead-button. The server flips the job `running` synchronously before the `202`, so the *race* is small — but the *round-trip latency* is not, and the button gives zero click acknowledgement. This change adds an **optimistic `pending`** that renders the spinner synchronously on click and hands off to the real polled `indexing` state.

## Goals

- Click acknowledgement is **synchronous** — the spinner appears in the same render as the click, before any network call resolves.
- The optimistic indicator is **visually identical** to the real `indexing` state (decision: fold into the existing spinner; no distinct "submitting…" affordance).
- The action button is **disabled** for the whole `pending || indexing` window (no double-submit).
- The optimistic state **always resolves** — into real polled `indexing` → `populated`, or into `error` + `Retry` — and can **never wedge** on a permanent spinner.
- **Zero** server/route/indexer/schema/config change.

## Decision — where `pending` lives and how it clears

`pending` is client-local state in `useKbStats`. It is the answer to "the user asked for a reindex and we have not yet seen the server acknowledge a running job."

```
   click ──▶ pending = true ───────────────────────────────┐
                    │                                       │ renders as `indexing`
                    │                                       │ (spinner + button disabled)
    ┌───────────────┼───────────────────────┐               │
    ▼               ▼                        ▼               │
 POST rejects   /stats sees            timeout guard         │
 (reindexError) indexing:true          (fires, no ack)       │
    │               │                        │               │
 pending=false  pending=false           pending=false        │
    ▼               ▼                        ▼               ◀┘
  `error`+Retry   poll owns spinner      refetch() → derive
                  (real `indexing`)       from fresh stats
```

**The invariant (the whole point of `doubt-driven-review` here):** `pending` MUST NOT clear on the bare `202` from the reindex POST. If it did, the spinner would blink off in the gap between the `202` and the first `/stats` that reports `indexing:true`, snapping the button back to "Index now" mid-job. `pending` clears on exactly three definitive events:

| Event | Clear because | Next state |
|---|---|---|
| Trigger POST rejected | no job started; failure is definitive | `error` + `Retry` (via `reindexError`) |
| A `/stats` load observes `indexing: true` | the real job now owns the spinner | poll-driven `indexing` → `populated` |
| Timeout guard elapses with no ack | job may have settled faster than the first poll (fast/empty folder) | clear + `refetch()`; derive from fresh stats (avoids a stuck spinner) |

The timeout guard is the safety net for the one edge case: a folder small enough that the walk completes and the registry flips back to `idle` **before** the first `/stats` poll fires, so `indexing:true` is never observed. Without the guard `pending` would stay true forever. With it, `pending` clears and a fresh `refetch()` derives the correct settled state (`populated`).

### Rejected alternative — a distinct `pending` visual

A separate "submitting…" label/affordance was considered and rejected (design Q1 answered "fold into the spinner"). The user's mental model on click is "it's indexing now"; a second visual to learn adds nothing and the running-job spinner is already polished. `pending` reuses the `indexing` branch verbatim.

### Rejected alternative — optimistic count / progress

`pending` shows the spinner only, no fabricated file/chunk counts. Real counts arrive from `/stats` once the poll engages. Fabricating progress would risk a visible correction when real numbers land.

## Component wiring

`FolderKbSection` derives display from `pending || deriveKbRowState(stats)`:

```
const { stats, reindex, reindexError, error, pending } = useKbStats(cwd);
const clientError = reindexError ?? error ?? null;
const state = clientError != null ? "error"
            : pending ? "indexing"
            : deriveKbRowState(stats);
const busy = pending || stats?.indexing === true;   // drives `disabled`
```

Note ordering: `error` still outranks `pending` — a trigger reject that lands while `pending` is briefly true must show `error`+`Retry`, not a spinner (and `reindex()` clears `pending` on reject anyway). The reindex / `Index now` / reindex-icon buttons all get `disabled={busy}` + a non-interactive style while busy.

## Testing strategy

React Testing Library, mocking `fetchKbStats` / `reindexKb` timing:

1. **Synchronous spinner** — click `Index now`; assert the animated indicator is present in the render *before* any mocked `/stats` promise resolves (advance no timers).
2. **Disabled during pending** — while pending, assert the button has `disabled`; a second click fires no second `reindexKb` call.
3. **Handoff** — resolve `/reindex`→`202`, `/stats`→`indexing:true` then `populated`; assert the spinner persists across the handoff (no flicker to "Index now") and lands on the chunk count.
4. **Reject clears pending** — `/reindex`→reject(403); assert spinner clears into `error`+`Retry` and `Retry` re-fires.
5. **Timeout guard** — `/reindex`→`202` but `/stats` reports `indexing:false` (already settled); advance the guard timer; assert `pending` clears, `refetch()` runs, row shows `populated` (no stuck spinner).

## Risks / trade-offs

- **Optimistic lie window** — for the brief moment between click and a definitive outcome we assert "indexing" without server confirmation. If the POST rejects, the correction to `error` is immediate and expected. Acceptable: the honest alternative (dead button) is the bug being fixed.
- **Timeout guard tuning** — too short and it clears before a legitimately slow first poll (harmless: `refetch()` re-derives, and if the job really is running the next poll re-engages the spinner); too long and a fast-settled empty folder shows an unnecessary extra second of spinner. A small guard (≈ a few poll intervals) balances both; exact value is an implementation detail asserted only for "eventually clears."
