## Why

An invoice's chat panel must show the greetings the engine persisted while
processing that invoice. The spec `invoicebot-session-profile` already requires
this: "A producer-run per-invoice scoped session is adopted as canonical without
a dashboard spawn" — when the producer runs an invoice's flow in a session
surfaced as `automationRun.name === "invoicebot-scoped:<invoice_id>"`,
`ensureScopedSession` SHALL adopt that session (which carries the persisted
`ib-greeting` rows in its `.jsonl`) rather than spawn a fresh detail session.

But the per-invoice fan-out that actually runs the processing (the
`automation-per-invoice-fanout` producer) spawns each run stamped with the
automation's own name — `invoicebot-intake` — never the scoped name. So:

- `isScopedInvoiceSession` (which gates adoption on
  `automationRun.name === "invoicebot-scoped:<invoice_id>"`) does NOT recognise
  the producer, and — correctly, per the "never adopt a global session" guard —
  refuses to adopt an `invoicebot-intake`-named session.
- `ensureScopedSession` falls through to `spawnScopedAndBind`, creating a fresh
  detail session. Being idle with only a display-only opener and no agent turn,
  that session never flushes a `.jsonl`, so the file-based greeting read returns
  zero — the invoice panel shows no persisted greeting.

The producer already carries the invoice's scoped profile env
(`IB_TOOLSET=scoped-invoice`, `IB_INVOICE_ID=<id>`); it is simply not SURFACED
under the scoped session NAME the adoption gate keys on.

## What Changes

Surface each per-invoice fan-out run under the invoice's scoped session name so
the existing adoption gate recognises it — with NO gate relaxation:

- **Injected per-invoice run name.** The generic fan-out gains an optional
  injected namer `perInvoiceRunName(invoiceId)`. When a fire is bound to an
  invoice (`fireCtx.invoiceId` set), the spawned run's `automationRun.name` is
  the injected name; folder/global fires keep the automation's own name. The
  automation-plugin stays free of any invoicebot-specific string — the namer is
  provided over the same cross-plugin seam as the queued-invoice enumerator.
- **InvoiceBot provides the scoped name.** The invoicebot plugin publishes
  `invoicebot:scopedRunName` = its own `scopedAutomationName(invoiceId)` (the
  single source of truth for `invoicebot-scoped:<invoice_id>`). The
  automation-plugin consumes it lazily at fire time.
- **Adoption is unchanged code.** With the producer now surfaced as
  `invoicebot-scoped:<invoice_id>`, `ensureScopedSession`'s existing resolution
  (live scan + recorded-run read) adopts the producer as the invoice's canonical
  session. The "never adopt a global `invoicebot-intake`/`ask` session" guard
  stays exactly as-is.

## Impact

- Affected specs: `invoicebot-session-profile` (the per-invoice producer is
  surfaced under the scoped name so req "A producer-run per-invoice scoped
  session is adopted as canonical" is actually reachable).
- Affected code: `packages/automation-plugin/src/server/engine.ts` (per-invoice
  run name), `packages/automation-plugin/src/server/index.ts` (consume the
  namer), `packages/invoicebot-plugin/src/server/index.ts` (provide the namer),
  `packages/invoicebot-plugin/src/server/session-link.ts` (export
  `scopedAutomationName`).
- No engine change. No adoption-gate relaxation. The shared-session /
  global-never-adopted guard is untouched.

## Discipline Skills

- `review-code` — a cross-plugin identity change that must NOT relax the
  global-never-adopted guard; review the naming + the untouched gate before
  commit.
