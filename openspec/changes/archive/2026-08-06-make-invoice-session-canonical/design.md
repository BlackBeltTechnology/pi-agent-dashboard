# Design — make-invoice-session-canonical

## Context

The on-demand resolver (`/scoped-session`) and the flow dispatcher both try to
find "the invoice's session", but they use **weak, non-durable, status-gated**
identity and can hand back a session with no live bridge.

```
CURRENT — resolve "the invoice's session"
  /scoped-session:  linkedLive(in-mem, !ended) → restoredLive(scan, !ended)
                    → recordedUsable(ended ok IF sessionFile) → SPAWN
  dispatchFlow:     reuseTarget(cwd+name, NO status check)
                    → emitEventToSession → false when ended → SPAWN (one-shot)

FAILURES (all observed live on one invoice)
  · in-mem link + live scan reject ended → a stopped session is never re-found
  · no single-flight        → 2 spawns 20 ms apart, both "active"
  · exited process not finalized → status "active" but NO bridge (phantom)
  · send_prompt resumes only when status==="ended"
        → phantom-active takes live-send → sendToSession=false → prompt DROPPED
  · dispatchFlow on ended → spawn fresh one-shot (no resume) — asymmetric w/ send
```

Root causes, in one line each:
1. **Identity is not durable** (in-memory + live scan) and **rejects ended**.
2. **No single-flight** around bootstrap.
3. **Lifecycle lies** — exited sessions stay `active` (phantom).
4. **Send is status-gated**, not bridge-gated → drops on phantom-active.
5. **Dispatch spawns instead of resuming** an ended target.

## The model — ONE canonical session per invoice

```
invoice_id  ──durable link──▶  canonical session id
                                   │
      resolve(invoice_id):         ▼
        has canonical link?
          ├─ NO  → SPAWN exactly one, record as canonical      (new invoice)
          └─ YES → live?  ── yes ─▶ reuse
                          ── no  ─▶ resume (--continue) IF sessionFile exists
                                    else re-spawn + re-link (lost file)
        (all under a single-flight guard keyed by invoice_id)

      both /scoped-session AND dispatchFlow resolve THIS same id.
      send_prompt / flow:run to it: live → deliver; no bridge → resume then deliver.
```

`new invoice ⇒ spawn` falls out for free: no link ⇒ the only branch is spawn,
guarded to run once.

## Decision 1 — Durable canonical link via a DEDICATED store (survives restart)

The invoice→session link becomes durable via a **dedicated key→id store**, keyed
`cwd\0invoice_id → sessionId`, owned by this plugin. The in-memory map stays as a
fast-path cache in front of it; the store is the restart-safe and resume-safe
source of truth.

### Why not reconstruct from the session's own persisted metadata (rejected)

The first plan was to read the invoice identity back from each session's
persisted `automationRun` metadata on a cache miss — "no new store, the session's
metadata is already authoritative". That basis is **falsified**; three
independent breaks, all live today:

1. **The stamp is never persisted durably.** `event-wiring` stamps
   `kind:"automation"` + `automationRun` in memory and merges it into `.meta.json`
   at register — but the debounced writer (`metaPersistence.save` →
   `sessionToMeta`) does a **FULL overwrite** from an explicit field enumeration
   that **omits both `kind` and `automationRun`**. The next unrelated save (a
   token/cost/status tick, ~1 s later) wipes them. Empirically: **0 of 955**
   on-disk `.meta.json` carry either field.
2. **It is not rehydrated on read.** `session-scanner.sessionFromMeta` restores
   `kind` but has **no** `automationRun` line — a cold scan could not reconstruct
   the invoice identity even if the field survived.
3. **Resume mints a NEW session id.** `spawnPiSession(mode:"continue")` registers
   a *successor* session (pending-resume is keyed by cwd, not id; there is no
   predecessor→successor field). The successor carries no `automationRun`, so it
   fails `isInvoicebotSession` regardless.

Any one break sinks Option A; all three hold. Repairing it means editing the
shared per-session persistence path (`sessionToMeta` / `sessionFromMeta`) every
session type depends on, **plus** a re-stamp-on-resume step — a large
cross-cutting change to serve one plugin's identity need.

**Chosen: the dedicated store.** It records the canonical id when a session is
first spawned for an invoice and **re-points** it whenever resolution adopts a
successor (resume) or a replacement (lost file). It is immune to the
successor-id problem, so "one canonical session per invoice" holds across both
restarts and resumes. GC: an entry whose session file is gone is dropped on the
next resolution (re-spawn + re-link).

**Resolution chain (replaces the metadata-scan path):**

```
  in-mem cache
    ?? dedicated store[cwd\0invoice_id]     (validated live-or-restorable)
    ?? recordedUsable (view:"runs" fallback, now deduped)   ← reconstruction only
    ?? SPAWN + record in store
```

The `status !== "ended"` filter is dropped: the store returns the id regardless
of status; validation then checks live-or-restorable (session file exists).

### Re-point-on-resume (the crux of Option B)

Resolution initiates a resume knowing the invoice, but learns the **successor**
id only when it registers. Mirror the proven `pendingAutomationRunRegistry`
pattern: on resume of an invoice's canonical session, enqueue a pending
`cwd → invoice` re-point; the session-register handler re-points the store to
the successor id (and may re-stamp `automationRun` in memory for the warm-path
scan). This ties to task 5.4, which already passes the bound-scope hint
(`IB_INVOICE_ID`) into the resume spawn.

Because a resumed successor carries no `automationRun`, **the store binding — not
the stamp — is the authority** that "this id is the invoice's canonical session"
and what authorizes `flow:run` dispatch for that invoice. The name-scan
`isInvoicebotSession` remains only as the warm-path reconstruction and the
untrusted-session guard on the no-store fallback.

## Decision 2 — Reuse-or-resume, never discard an ended canonical

Resolution returns the canonical id whether it is live or ended-restorable. The
**caller's transport** brings an ended one back to life on first use (existing
auto-resume). Resolution never spawns a second session for an invoice that has a
canonical one, unless its session file is genuinely gone (unrecoverable) — then
it re-spawns and re-links, still exactly one canonical.

## Decision 3 — Single-flight bootstrap

Resolution is wrapped in a per-invoice in-flight promise: the first call starts
the bootstrap, concurrent calls await the same promise. Guarantees at most one
spawn per invoice per bootstrap window, killing the 20-ms double-spawn.

## Decision 4 — Honest end-of-life (kill phantom-active)

When an invoicebot spawned session's bridge closes / process exits, it is
finalized to `ended` (the same finalize automation sessions already receive).
Consequence: `status` is truthful, and the send/dispatch paths can rely on it.
This removes the phantom-active state at its source.

## Decision 5 — Send + dispatch are BRIDGE-gated, not status-gated

- **`send_prompt`:** the deciding question becomes "is there a live bridge for
  this session?" If **no live bridge** (ended OR phantom-active), auto-resume and
  deliver the queued prompt; only deliver live when a bridge exists. This makes
  the existing pending-resume machinery reachable for the phantom case too. With
  Decision 4 in place a phantom-active session is already `ended`, so this is
  belt-and-suspenders, but it also fixes any residual race where the finalize
  has not yet landed.
- **`dispatchFlow`:** symmetric — resolve the canonical session, deliver
  `flow:run` when live, else resume-then-deliver. A brand-new invoice with no
  canonical session still spawns (the only correct behavior — nothing to resume).

## Decision 6 — A dispatch that did not START a flow is a FAILED dispatch

`emitEventToSession` returns `true` on **delivery**, not on flow **start**. Under
reuse-or-resume, dispatching into a session that is already running a flow (or an
unknown flow / a blocked gate) becomes routine, and the flow runtime declines
**silently** — reported as success today. That reintroduces the symptom this
change exists to kill ("surface looks healthy while every message is lost") one
layer down, on the dispatch path.

The flow runtime is being changed (separately, same base name) to emit an
observable **rejection** carrying a **caller-supplied correlation token** echoed
on a structured payload. This repo consumes it on **both** producer paths:

- **`dispatchFlow`** SHALL mint a correlation token, put it on the emitted
  `flow:run`, and await a bounded race — **started** (resolve with the session
  id) | **rejected** (return a failure the REST caller sees) | **timeout**
  (failure). It SHALL NOT report a dispatch that did not start a flow as success.
- **The slash-command path** (`packages/extension/src/bridge.ts`, `/<flow-name>`)
  emits `flow:run` directly and eagerly settles the optimistic bubble with
  `prompt_received`. It SHALL carry the token and settle the bubble with an
  **error** on rejection, rather than a silent `prompt_received`.

The token is required because a rejection never starts a flow and so has no run
id; two dispatches into one session are otherwise indistinguishable. That token
contract is a reverse ask to the flow runtime (recorded in the aggregator
initiative + `handoffs/…flows-correlation-token.md`).

The bridge currently **emits** `flow:notify` (line 770) but has **no listener**
for it, and `emitEventToSession` → `piGateway.sendToSession` reports only
delivery — so a return channel (bridge `pi.events.on(<rejection>)` → WS → server
→ plugin) is part of this decision.

**No queueing.** An already-running rejection stays a rejection; drop→queue is a
separate decision not taken here.

## Session↔invoice run rows — read boundary dedupes

The `view:"runs"` history that records which sessions processed an invoice is a
read source for reconstructing identity (the Decision-1 fallback), not rewritten
here. Recording remains as today. **But `recordedSessionIdsFromDetails` SHALL
dedupe by session id** — keep first occurrence AFTER the existing newest-first
sort. This is **shape-agnostic**: a no-op under today's one-row-per-(invoice,
session), and — when the producing side reshapes to one-row-per-run under the
same effort — it yields each session once, ordered by its **most recent run**
(the correct session-recency reading). No new/deduped view is consumed. (Moot
until Decision 1's store lands: every recorded candidate is otherwise rejected by
`isInvoicebotSession` after a restart.)

## Decision 7 — The canonical session must be SCOPED-profile (reject global/intake adoption)

The reuse gate `isInvoicebotSession(s, cwd)` accepts any session whose
`automationRun.name` starts with `invoicebot` — by design it also matches the
shared `invoicebot-intake` folder-automation session (its own comment: "stamped
by us or by intake"). That is correct for the **dispatch** path (delivering a
`flow:run` into a live intake batch session is legitimate), but WRONG for the
**card's canonical identity**: the intake session runs under the full-surface
`ask` profile (no `IB_TOOLSET`), so adopting it as an invoice's session gives the
operator the global Ask greeting and every-invoice tool surface on a
single-invoice view. Because `restore-session-id-bridge` records the intake
session as each processed invoice's run session, `recordedUsableSession` returns
it — the observed bug.

**Decision:** split the gate by purpose.

- Add `isScopedInvoiceSession(s, cwd, invoiceId)` — true only when `s` is live/
  restorable in `cwd` AND its `automationRun.name === "invoicebot-scoped:" +
  invoiceId` (the flow-less scoped chat) OR it is an `invoicebot:process` run
  bound to that same `invoiceId`. It is FALSE for `invoicebot-intake`,
  `invoicebot-pull`, and the Ask session.
- The **card identity** paths use the scoped gate: `linkedLiveScopedSession`,
  `restoredLiveScopedSession` (already scoped by name — keep), and
  `recordedUsableSession` (change `isUsableRecordedSession` to require the scoped
  gate). A recorded global session is skipped, so resolution falls through to
  `spawnScopedAndBind` — a fresh scoped session — rather than adopting the global
  one.
- The **dispatch** path (`dispatchFlow` → `reuseTarget`) keeps the looser
  `isInvoicebotSession`; delivering a run into a live intake session is
  unchanged.

**Why not stop recording the intake session as the invoice's run session
(engine-side)?** That record is legitimate traceability ("which run touched this
invoice"). The fix belongs at the **card adoption** boundary, not the recording
boundary — and it stays entirely within this repo's `session-link.ts`.

**Interaction with Decision 1 (durable store).** The durable canonical link only
ever stores a session that passed the scoped gate at record time, so the store
never points at a global session; the gate is also re-applied on read so a
pre-existing/global-linked id cannot be resurrected as canonical.

## Risks

- **Resume latency on first send/dispatch to an ended canonical.** Same latency
  the send auto-resume already pays today; surfaced by the existing "resuming"
  UI state. No new masking.
- **Lost session file** (external cleanup) ⇒ resolution re-spawns + re-links.
  Acceptable: exactly one canonical is maintained; the prior transcript is gone
  because its file is gone (not something this change can recover).
- **Finalize-on-close correctness.** Must finalize only invoicebot spawned
  sessions on a genuine bridge close, never a transient reconnect window — reuse
  the existing gateway close/grace handling rather than inventing a new one.
- **Store re-point timing.** The successor id from a resume arrives
  asynchronously (register event). If resolution reads the store before the
  re-point lands, it sees the stale (ended) id and validates it as restorable —
  acceptable (it resumes again to the same file), but a burst could race; the
  single-flight guard (Decision 3) plus the pending `cwd → invoice` re-point
  registry keyed by cwd (one outstanding resume per cwd) contains it.
- **Rejection consumption latency.** `dispatchFlow` now awaits start-or-reject
  within a bounded window instead of returning on delivery; the timeout must be
  short enough not to stall the REST response and long enough to catch a genuine
  start on a busy session. Surfaced as a dispatch failure, not masked.
