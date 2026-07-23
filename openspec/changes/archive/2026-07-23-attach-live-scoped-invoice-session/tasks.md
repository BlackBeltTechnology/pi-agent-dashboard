# Tasks: attach-live-scoped-invoice-session

## 1. `ensureScopedSession` (`session-link.ts`)

- [x] 1.1 Add `ensureScopedSession(cwd, invoiceId): Promise<string | undefined>`
      to `SessionLink`; add an async `resolveRecordedSessionIds(cwd, invoiceId)`
      dependency backed by the engine's `view:"runs"` result.
- [x] 1.2 Key links by `(cwd, invoiceId)`. Reuse only a cwd-matched invoicebot
      session that is not ended and is bound to the exact invoice (local link or
      encoded flow-less `automationRun.name`).
- [x] 1.3 Check recorded session ids newest-first: active/idle/streaming → reuse;
      ended + `existsSync(sessionFile)` → return as auto-resumable; absent/dead
      file → continue.
- [x] 1.4 Spawn a fresh flow-less session with guarded scoped env and
      `automationRun { name:"invoicebot-scoped:<encoded-id>", runId, visibility:
      "shown" }`; correlate by runId, record the link, emit no `flow:run`, return
      only the registered session id.
- [x] 1.5 Spawn throw/rejection/bind timeout logs and returns `undefined`; never
      return a spawn token as `sessionId`. Preserve existing dispatchFlow behavior.

## 2. Endpoint + engine wiring

- [x] 2.1 Add `POST /api/plugins/invoicebot/scoped-session`: validate `cwd` and
      non-empty `invoice_id`, call `ensureIntake(cwd)`, then
      `deps.ensureScopedSession`; return `{sessionId}` or 503
      `{error:"scoped session unavailable"}`. No consent gate.
- [x] 2.2 In `index.ts`, wire `resolveRecordedSessionIds` through
      `engine.query(cwd,{view:"runs",invoice_id})`, selecting valid ids newest
      first by `started_at`, and pass `sessionLink.ensureScopedSession` to routes.

## 3. Tests

- [x] T1 Reuse an exact, live linked/restored scoped session; reject ended,
      wrong-cwd, unrelated-invoice sessions.
- [x] T2 Recorded runs: latest live id reused; latest ended id with a real temp
      session file returned; missing file skipped.
- [x] T3 Spawn fallback carries exact env/guard/encoded metadata, emits no
      `flow:run`, correlates by runId, and returns the registered id.
- [x] T4 Spawn rejection/throw/bind timeout returns undefined (never spawnToken).
- [x] T5 Endpoint success, malformed cwd/invoice_id (400), unavailable (503),
      and `ensureIntake` invocation. Test authored in `routes.test.ts`; execution
      deferred/manual by operator because declared `@fastify/multipart` is absent
      from `node_modules`.
- [x] T6 Engine runs adapter selects valid session ids newest-first and ignores
      malformed rows.

## Validate

- [x] V1 `openspec validate attach-live-scoped-invoice-session --strict` passes.
- [x] V2 Session-link/adapter tests 17/17 and `npm run build` pass. Route-suite
      execution deferred/manual by operator because `@fastify/multipart` is
      absent from `node_modules`; route assertions are authored.
