# Proposal: attach-live-scoped-invoice-session

## Why

A client opening a single invoice needs a **live**, invoice-scoped session to
converse with — one bound to that invoice (`IB_TOOLSET=scoped-invoice`,
`IB_INVOICE_ID`) so it opens with the invoice-scoped opener and accepts messages.
Today the only way to reach a per-invoice session is the recorded
`invoice_runs → session_id` mapping surfaced by `query view:"runs"`. That mapping
is unreliable for a conversation surface:

- The recorded run session is **ephemeral** — the process ends after the flow run,
  so it cannot receive a new message without a resume.
- Its transcript can be **gone** (reaped / not present in the sessions store), so
  an attempted resume fails with "no session file" — the session is dead, not
  resumable.
- A **never-processed** invoice has **no run at all**, so there is no id to return.

There is no server operation that, given an invoice, guarantees a live scoped
session. This change adds one.

## What Changes

- **New op `ensureScopedSession(cwd, invoiceId)`** on the session-linkage layer
  (`session-link.ts`) that returns a usable scoped session id via
  **reuse → resume → spawn**:
  1. **reuse** — if an active/idle/streaming invoicebot session in `cwd` is
     already bound to this invoice, return it;
  2. **resume** — else resolve the invoice's recorded sessions through the
     existing `InvoiceEngine.query(cwd, { view:"runs", invoice_id })` port,
     newest-first; return the first ended session whose `sessionFile` exists on
     disk (the existing per-session WebSocket auto-resumes it on `send_prompt` and
     replays its transcript on subscribe);
  3. **spawn** — else spawn a **fresh scoped-invoice session** bound to the invoice
     (`env { IB_TOOLSET:"scoped-invoice", IB_INVOICE_ID:invoiceId }`, **no**
     `flow:run` dispatched — a pure view/chat spawn), correlate registration by
     `automationRun.runId`, and return the registered session id. Its
     `automationRun.name` carries an encoded invoice id so a live flow-less
     session remains discoverable after dashboard restart. The spawned session
     opens with the invoice-scoped opener.

- **New endpoint `POST /api/plugins/invoicebot/scoped-session { cwd, invoice_id }
  → { sessionId }`** in `routes.ts`, wired through the plugin behind the existing
  session-linkage deps. Non-consequential (a session bootstrap), so it needs no
  consent gate.

- The spawn fallback (step 3) makes the endpoint robust even when a prior run
  transcript was lost, so an invoice card is never left without a usable session.
  A spawn token is never returned as `sessionId`; registration timeout returns an
  error envelope.

## Impact

- Affected capability: `invoicebot-session-profile`.
- Affected code: `packages/invoicebot-plugin/src/server/session-link.ts` (new
  `ensureScopedSession` + a flow-less scoped spawn path), `.../routes.ts` (new
  `scoped-session` route), `.../index.ts` (wire the dep).
- Additive: no change to existing endpoints, the `flow:run` dispatch path, or the
  `invoice_runs` contract. Reuses the existing spawn-with-scope-env plumbing.

## Non-goals

- Durable retention of scoped session transcripts (why reaped transcripts vanish)
  is a separate follow-up; the spawn fallback here makes attach correct regardless.
- No client/UI or WebSocket protocol change is described here; this change only
  provides the server bootstrap op + endpoint. Existing per-session `/ws`
  subscribe/replay/send behavior takes over once the caller has `sessionId`.
