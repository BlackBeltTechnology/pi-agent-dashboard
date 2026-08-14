# Restore the persistent scoped-session spawn for per-invoice canonical sessions

## Why

The change `adopt-scoped-producer-session` renamed each per-invoice fan-out
producer run to `invoicebot-scoped:<invoice_id>` so `isScopedInvoiceSession`
would match it and `ensureScopedSession` would adopt it as the invoice's
canonical chat session — instead of falling through to `spawnScopedAndBind`.

That premise is wrong. The per-invoice fan-out producer is a
`flows.run invoicebot:process` run: it spawns, runs the flow, and **terminates
on completion**. It is not a held-open chat session. `spawnScopedAndBind`, by
contrast, spawns a **flow-less, guarded, `visibility: shown`, held-open** session
carrying `IB_TOOLSET=scoped-invoice` + `IB_INVOICE_ID` that stays alive as the
invoice's detail/chat surface.

By adopting the transient producer, the canonical scoped session became a dead
process, which produced three regressions:

- **No live scoped process** — after processing ends there is no live process
  carrying `IB_TOOLSET=scoped-invoice` for the invoice (the persistent
  `spawnScopedAndBind` session was skipped).
- **The card binds to the global Ask/main session** — with no live scoped
  session to bind, the dashboard resolution returns the wrong id.
- **A stale query mid-run** — the mounted-liveness read races the producer's
  terminal state.

It also did **not** fix the greeting-liveness failure it targeted: a terminated
producer session cannot have subsequent greeting refreshes flushed into it.

## What Changes

Revert the behaviour introduced by `adopt-scoped-producer-session` so the
per-invoice fan-out producer is **not** adopted and resolution falls through to
the persistent `spawnScopedAndBind` session:

- `automation-plugin` engine: the per-invoice fan-out run name goes back to
  `automation.name`; drop the injected `perInvoiceRunName` seam.
- `automation-plugin` index: drop the `consume("invoicebot:scopedRunName")`
  wiring.
- `invoicebot-plugin`: drop the `invoicebot:scopedRunName` provider and the
  `scopedAutomationName` export it required.
- Add a regression test that models the producer's terminate-on-completion
  lifecycle: an **ended** per-invoice producer run recorded for an invoice is
  NOT adopted, and `ensureScopedSession` still yields a persistent scoped
  session (spawn path) carrying the scoped env.

Everything `adopt-scoped-producer-session` did not touch stays intact:
per-invoice fan-out itself, `${invoice_id}` interpolation, the
`IB_TOOLSET`/`IB_INVOICE_ID` env passthrough, `concurrency: queue`, run-now
fan-out, and idle run-now settling.

The spec records the durable invariant: the canonical per-invoice scoped session
is a **persistent held-open session**, never a transient flow-run producer. The
existing "never adopt a global/shared session" requirement is unchanged.

## Discipline Skills

- `systematic-debugging` — the fix follows a confirmed root-cause of a shipped
  regression; the regression test reproduces the terminate-on-completion
  lifecycle the prior unit tests failed to model.
- `review-code` — non-trivial revert across two plugins on the contract seam;
  review before commit.
