## Context

`ensureScopedSession(cwd, invoiceId)` resolves an invoice's canonical scoped chat
session through: in-memory link → durable canonical store → live scan
(`restoredLiveScopedSession`, by scoped name) → recorded-run read
(`recordedUsableSession`, via `resolveRecordedSessionIds` → `invoice_runs`) →
spawn fresh (`spawnScopedAndBind`). Both the live scan and the recorded read gate
adoption on `isScopedInvoiceSession`:

```
automationRun.name === "invoicebot-scoped:<encodeURIComponent(invoiceId)>"
```

The producer that runs the invoice's flow is spawned by the per-invoice fan-out
(`automation-plugin` `startRunFor`) with `automationRun.name = automation.name`
= `"invoicebot-intake"`. It carries the scoped env but not the scoped NAME, so
the gate rejects it and resolution spawns a fresh, fileless detail session.

## Decisions

### Decision 1 — Surface the producer under the scoped name (no gate change)

The fix is to make the producer satisfy the EXISTING gate, not to relax it. The
per-invoice fan-out stamps each invoice-bound run's `automationRun.name` with the
scoped session name. Then `restoredLiveScopedSession` (live producer) and
`recordedUsableSession` (ended-restorable producer, via `invoice_runs`) adopt it
with zero adoption-code change, and the "never adopt `invoicebot-intake` /
global" guard is preserved — a genuinely shared/unscoped run keeps its own name
and is still rejected.

### Decision 2 — Inject the namer; keep the automation-plugin generic

The scoped-name convention (`invoicebot-scoped:<id>`) is invoicebot's, owned by
`session-link.ts#scopedAutomationName`. The automation-plugin is a generic,
publishable plugin and must not hardcode it. So it is injected over the SAME
cross-plugin service seam already used for the queued-invoice enumerator:

```
invoicebot-plugin  ── ctx.provide("invoicebot:scopedRunName", scopedAutomationName)
automation-plugin  ── ctx.consume("invoicebot:scopedRunName")  (lazy, at fire time)
```

`EngineDeps.perInvoiceRunName?: (invoiceId) => string | undefined`. In
`startRunFor`: when `fireCtx?.invoiceId` is set (a per-invoice fire — scheduled
fan-out OR manual run-now fan-out), `automationRun.name =
perInvoiceRunName(invoiceId) ?? automation.name`; otherwise `automation.name`.
Fallback to the automation name is safe: fan-out only happens when the invoicebot
enumerator is present, and the same plugin publishes both, so the namer is
present whenever fan-out fires.

`scopedAutomationName` becomes an exported function (single source of truth); the
run record keyed by `automation.name` (`storeStartRun`) and the run→session
correlation (by `automationRun.runId`, not name) are unaffected.

### Decision 3 — Liveness for the refresh

Adoption returns the producer's own session id (its `.jsonl` already holds the
baseline greetings). A live producer is adopted directly; an ended-restorable
producer is adopted via the existing recorded-read path (`enqueueResumeRepoint`),
so a subsequent state transition re-runs the flow in the canonical session and
the refresh greeting appends to the same session. No new resume/spawn mechanics —
the fix only changes WHICH session is adopted, never the adoption plumbing.

## Non-goals

- No adoption-gate relaxation; the global-never-adopted guard is untouched.
- No engine change; the engine already persists the greetings in the producer.
- No change to the fan-out enumeration, env resolution, or concurrency policy.
