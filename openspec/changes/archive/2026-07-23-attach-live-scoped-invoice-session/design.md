# Design: attach-live-scoped-invoice-session

## Context

Invoice cards already converse over the dashboard's existing per-session WebSocket:
`subscribe` rebuilds replay + live state and `send_prompt` auto-resumes an ended
session when its persisted file survives. The missing seam is bootstrap: given
`(cwd, invoiceId)`, obtain a usable scoped `sessionId` before that socket can
subscribe.

The durable invoice → prior-session mapping already exists behind the plugin's
`InvoiceEngine.query(cwd, { view:"runs", invoice_id })` port. Its `runs[]` rows
carry `session_id` + `started_at`; select newest first. pi-flows persists flow
state inside those sessions, while the dashboard host owns process liveness,
session files, spawn, and registration correlation.

## Decision 1 — plugin REST bootstraps; existing per-session WebSocket chats

Expose `POST /api/plugins/invoicebot/scoped-session { cwd, invoice_id } →
{ sessionId }`. This request/response operation runs behind the trusted plugin and
may call `ctx.spawnSession` with a guarded scope environment. Do not extend generic
browser `spawn_session` with arbitrary env.

After bootstrap, the existing per-session `/ws` handles `subscribe`, replay, live
events, prompts, auto-resume, abort, and interactive responses. No core WebSocket
protocol change.

## Decision 2 — reuse → resume → spawn

`ensureScopedSession(cwd, invoiceId)` returns the first applicable result:

1. **reuse** — a session classified as invoicebot, cwd-matched, exact-invoice
   bound, and not `status:"ended"`. Sources: the process-local link map and a
   `listAll()` scan for a flow-less scoped session whose persisted
   `automationRun.name` encodes the invoice id.
2. **resume candidate** — call the injected `resolveRecordedSessionIds(cwd,
   invoiceId)` dependency, backed in `index.ts` by
   `InvoiceEngine.query(view:"runs")`. For each newest-first id: obtain its host
   session; if it is cwd-matched and active/idle/streaming, reuse it; if ended and
   `existsSync(sessionFile)`, return that id. `send_prompt` performs the actual
   host auto-resume. Missing records/files fall through.
3. **spawn** — spawn a fresh guarded scoped session; wait for its exact
   runId-correlated registration and return the real session id.

The in-memory link key is `(cwd, invoiceId)`, not invoice id alone.

## Decision 3 — flow-less spawn has durable invoice identity

Spawn with:

```ts
{
  cwd,
  guard: true,
  env: { IB_TOOLSET: "scoped-invoice", IB_INVOICE_ID: invoiceId },
  automationRun: {
    name: `invoicebot-scoped:${encodeURIComponent(invoiceId)}`,
    runId: randomUUID(),
    visibility: "shown"
  }
}
```

The name remains invoicebot-classified and makes an already-live scoped session
reconstructible from the host session list after dashboard restart. Correlation
still uses the unique `runId` only. Registration records `(cwd, invoiceId) →
sessionId`. No `flow:run` is emitted.

The pending registration record is discriminated: a flow dispatch carries a
`flow`; a scoped-chat spawn does not. The event handler emits `flow:run` only when
that field exists.

## Decision 4 — never return a spawn token as a session id

Existing flow dispatch may retain its historical spawn-token fallback. The new
bootstrap contract may not: its response field is `sessionId`. Spawn rejection,
throw, or bind timeout logs and returns `undefined`; the route returns an error
envelope.

## Decision 5 — endpoint validation and workspace initialization

The route reuses `badCwd`, requires a non-empty string `invoice_id`, and calls the
existing `ensureIntake(cwd)` workspace-touch hook. Malformed requests return HTTP
400. A well-formed request whose session cannot be produced returns HTTP 503 with
`{ error:"scoped session unavailable" }`. No consent gate: session bootstrap is
non-consequential and never dispatches a flow.

## Contract this change owns

Given valid `(cwd, invoice_id)`, the plugin returns a real session id that is
already live or safely auto-resumable, or a clear error. The returned session is
scoped to that invoice. Existing query/review/setup/rules, flow dispatch, run
mapping, and per-session WebSocket contracts remain unchanged.
