# Tasks — make-invoice-session-canonical

> TDD: write each test FIRST, watch it fail, then implement the minimal code to
> pass. Every user-facing behavior also ships a faux, offline e2e.

## 1. Durable canonical identity via a dedicated store (session-link)

> Decision 1 = **Option B** (dedicated `cwd\0invoice_id → sessionId` store).
> Option A (reconstruct from session metadata) was falsified — see design.md.

- [x] 1.1 Test-first: resolving an invoice with a live canonical session reuses it (no spawn).
- [x] 1.2 Test-first: resolving an invoice whose only session is `ended` with an existing `sessionFile` returns that same id (no spawn).
- [x] 1.3 Test-first: after in-memory state is cleared (restart), resolution reconstructs the canonical id from the **dedicated store** (no spawn). Assert against a real store round-trip — NOT a `getSession`/`listAll` fake that fabricates `automationRun` (that fake would pass while real persistence stays broken).
- [x] 1.4 Test-first: `ended` canonical with a missing `sessionFile` re-spawns exactly one replacement and **re-points** the store.
- [x] 1.5 Implement: add the durable `cwd\0invoice_id → sessionId` store; record on spawn; read on cache miss; drop the `status !== "ended"` filter; keep the in-memory map as a fast-path cache. The store binding (not the `automationRun` stamp) authorizes dispatch for the invoice.
      NOTE: implemented as `canonical-session-store.ts` (file-backed, atomic tmp+rename, `~/.pi/dashboard/invoicebot/canonical-sessions.json`), wired as new `storeResolvedScopedSession` step in `ensureScopedSession`. New adoptions (store/restored/recorded/spawn) write-through to the store.

## 1b. Re-point the store to a resume successor

- [x] 1b.1 Test-first: resume an invoice's ended canonical session; after the successor registers, re-resolve ⇒ the store points at the **successor** id (not the stale ended id); still exactly one canonical.
- [x] 1b.2 Implement: a pending `cwd → invoice` re-point (mirroring `pendingAutomationRunRegistry`, keyed by cwd); on the successor's `session_register`, re-point the store (and optionally re-stamp `automationRun` in memory for the warm-path scan). Ties to task 5.4's bound-scope hint.
      NOTE: plugin-contained via `onEvent` (decoupled from server §5). Re-point armed when resolution returns an ended-restorable id; `hasPendingSpawnForCwd` guard + `boundSessionIds` prevent a sibling new-invoice spawn from consuming a pending re-point. 60s TTL.

## 1c. Canonical session must be scoped-profile (reject global/intake adoption)

- [x] 1c.1 Test-first: resolving an invoice whose ONLY recorded session is a global `invoicebot-intake` session SHALL NOT adopt it — it spawns a fresh scoped session instead (assert a `spawnScopedAndBind` call, and that the returned id is the scoped one, not the intake id).
- [x] 1c.2 Test-first: resolving an invoice with a live/restorable `invoicebot-scoped:<id>` session adopts/reuses it (no spawn).
- [x] 1c.3 Test-first: an `invoicebot:process` run bound to the invoice is accepted by the scoped gate; an `invoicebot-pull` / Ask session is rejected. (Note: a bound and an intake-spawned `invoicebot:process` run are indistinguishable from the session record, so the gate deliberately accepts only the stamped `invoicebot-scoped:<id>` name; a bound spawn is now stamped scoped (1c.5), and an unscoped/Ask session falls through to a scoped spawn — correct surface either way.)
- [x] 1c.4 Test-first: the `flow:run` **dispatch** path (`reuseTarget`) STILL reuses a live `invoicebot-intake` session (unchanged) — the scoped gate governs only the card identity, not dispatch.
- [x] 1c.5 Implement: `isScopedInvoiceSession(session, cwd, invoiceId)` gates `isUsableRecordedSession` + `linkedLiveScopedSession`; `reuseTarget`/`dispatchFlow` keep the looser `isInvoicebotSession`. The scoped gate is applied both when RECORDING the durable link and when READING it back, and a bound spawn is stamped `invoicebot-scoped:<id>`, so a global id is never stored or resurrected as canonical.

## 2. New invoice always spawns exactly one

- [x] 2.1 Test-first: an invoice with no canonical session spawns exactly one and records it as canonical.
- [x] 2.2 Implement: the no-link branch spawns once and records the canonical link (`spawnScopedAndBind` → onEvent records `canonicalStore.set` on bind).

## 3. Single-flight resolution

- [x] 3.1 Test-first: two concurrent resolutions for the same new invoice yield exactly one spawn and both return the same id.
- [x] 3.2 Implement: per-invoice in-flight promise guard (`inFlightByKey`, keyed by `cwd\0invoiceId`) around `ensureScopedSession`; concurrent callers join one bootstrap, key dropped on settle.

## 4. Honest lifecycle — no phantom-active

- [x] 4.1 Test-first: an invoicebot spawned session whose bridge closes (past the grace window) is finalized to `ended`, not left `active`.
- [x] 4.2 Implement: finalize invoicebot spawned sessions on genuine bridge close via the existing gateway close/grace handling.
      NOTE: already provided by `finalize-automation-run-on-session-death` — invoicebot dispatch + scoped spawns are stamped `kind:"automation"`, so the gateway ws-close path finalizes them to `ended` (no reconnect grace) and KEEPS them resumable. Locked by `canonical-session-finalize.test.ts` (asserts ended + kept + sessionFile). GAP (deferred): a RESUMED successor is not automation-kind until §5.4 reproduces spawn config, so its own close falls to the human grace window — functionally covered by §5's bridge-gate (resumes, never drops).

## 5. Send resumes when no live bridge (handleSendPrompt)

- [x] 5.1 Test-first: `send_prompt` to a canonical session with no live bridge auto-resumes and delivers the queued prompt (not dropped).
- [x] 5.2 Test-first: `send_prompt` to a live canonical session still delivers live (no resume).
- [x] 5.3 Implement: gate the resume branch on "no live bridge" rather than only `status === "ended"`.
      NOTE: `handleSendPrompt` now gates `promptSession && !piGateway.isSessionConnected(id)` (the established no-live-bridge signal, per event-wiring ghost-cleanup). Covers cleanly-ended AND phantom-active. Tests: `send-prompt-bridge-gated.test.ts`. Applies to ALL sessions (server-domain), not just invoicebot.
- [x] 5.4 Implement: when auto-resuming an invoice's canonical session, pass the bound-scope hint (the invoice identity) into the resume spawn, so the runtime can re-establish scope. (Runtime honoring it is external — see the `make-invoice-session-canonical` handoff.)
      NOTE: generic server-domain seam (the bug is universal — any plugin's spawn env is dropped on a continue-resume). Canonical store gains a reverse `scopeFor(sessionId)`; session-link exposes `resumeScopeEnv`; the plugin `provide`s it as `invoicebot:resumeScopeEnv`; `handleSendPrompt` consults an injected `resumeSpawnEnv` resolver (wired from `pluginServiceRegistry` through the browser gateway) and folds `{IB_TOOLSET,IB_INVOICE_ID}` into the continue-spawn env. Engine honoring the env on `--continue` (registered tools + start message) stays external. Tests: store `scopeFor`, `resumeScopeEnv`, handler env-pass.

## 6. Re-run reuses/resumes the canonical session (dispatchFlow)

- [x] 6.1 Test-first: dispatch for an invoice with a live canonical session delivers to it (no spawn).
- [x] 6.2 Test-first: dispatch for an invoice with an ended/bridgeless canonical session resumes it and delivers (no fresh one-shot spawn).
- [x] 6.3 Test-first: dispatch for an invoice with no canonical session spawns exactly one and records it as canonical.
- [x] 6.4 Implement: `dispatchFlow` resolves the canonical session and reuses/resumes it; new invoice still spawns.
      NOTE: committed 3ef4371a. Store-backed resolve → emit-to-live-bridge (reuse) → else resume transcript via `resumeSessionFile` (--continue), never a fresh one-shot; new invoice spawns + records. Added additive `PluginSpawnOptions.resumeSessionFile`.

## 7. Observability

- [x] 7.1 Add per-outcome logs at resolution: `reuse | resume | spawn | dedup-collapse | repoint`, each carrying invoice + session id (`invoicebot resolve <outcome>: invoice <id> → session <id>`). `finalize` is the gateway's lifecycle event (§4), not observable from this seam.

## 7b. A dispatch that did not start a flow FAILS (rejection consumption)

> Depends on the flow runtime emitting a **token-echoing structured rejection**
> (external — see the `make-invoice-session-canonical` flows handoffs). Until it
> lands, drive these tests with a faux rejection event.

- [ ] 7b.1 Test-first: `dispatchFlow` into a session already running a flow returns a **failure** (rejection carrying the caller token), not the session id.
- [ ] 7b.2 Test-first: `dispatchFlow` whose flow starts resolves with the session id (start echoes the token); a window with neither start nor reject times out as a failure.
- [ ] 7b.3 Implement: `dispatchFlow` mints a correlation token, puts it on the emitted `flow:run`, awaits bounded **started | rejected | timeout**, and surfaces rejection to the REST caller.
- [ ] 7b.4 Test-first: the `/<flow-name>` slash path settles the optimistic bubble with an **error** when the flow is rejected (not a silent `prompt_received`).
- [ ] 7b.5 Implement: return channel — bridge `pi.events.on(<rejection>)` → WS → server → plugin; carry the token on the slash-path `flow:run`; settle the bubble on reject.

## 7c. Recorded-session read boundary dedupes (shape-agnostic — lands now)

- [x] 7c.1 Test-first: `recordedSessionIdsFromDetails` returns each session id **once** given duplicate run rows for one session, ordered newest-run-first.
- [x] 7c.2 Implement: dedupe by session id keeping first occurrence after the existing sort. (No-op under today's row shape; correct under one-row-per-run.)

## 8. E2E (faux, offline)

- [ ] 8.1 Open the same invoice twice ⇒ exactly one session exists for it.
- [ ] 8.2 Stop the invoice's session, then send a message ⇒ it resumes and answers; the composer never gets stuck on "sending".
- [ ] 8.3 Stop the invoice's session, then re-run the invoice ⇒ the same canonical session is resumed (no second session spawned).
- [ ] 8.3a Open an invoice that was processed by the shared intake automation ⇒ the card shows the **invoice-scoped opener** (not the global Ask greeting) and a fresh scoped session is bound — the global intake session is never adopted.
- [ ] 8.4 Re-run into a session already running a flow ⇒ the operator sees a failure; the dispatch is not reported as success (faux rejection).

## 9. Verify

- [x] 9.1 `npm test` green (unit + faux). 10331 passed; the only failures are the pre-existing `@fastify/multipart` load gap (4 files, 0 tests) + `fs.watch` "attach returns false" integration (3 tests) — unrelated to this change.
- [ ] 9.2 E2E suite green. (Deferred — needs the docker/e2e harness; tracked with §8.)
- [x] 9.3 `openspec validate make-invoice-session-canonical --strict` passes.
- [x] 9.4 Restart round-trip: resolve → clear in-memory → resolve returns the same id from the store (no second spawn). Unit-covered by test 1.3 (real store round-trip after in-memory state cleared).
- [ ] 9.5 Resume round-trip: resolve → stop → send/re-run → store re-points to the successor; a further resolve returns the successor, not a new spawn. (Deferred — integration/manual round-trip; the mechanism is unit-covered by test 1b.1.)
