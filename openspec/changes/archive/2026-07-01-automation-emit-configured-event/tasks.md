## 1. Context seam — emitEventToSession

- [x] 1.1 Add `EmitEventToSessionFn` + `emitEventToSession` to `ServerPluginContext` interface + `ServerContextDeps` + `createServerPluginContext` wiring (`dashboard-plugin-runtime/src/server/server-context.ts`)
- [x] 1.2 Implement host hook in `server.ts` next to `abortSession`: trust gate (`priority <= 100`), empty/non-string `eventType` → `false`, else `piGateway.sendToSession(sid, { type:"plugin_emit_event", sessionId, eventType, data })`
- [x] 1.3 Update the 3 runtime test deps literals (loader, server-context-abort, server-context-service-seam) with `emitEventToSession`

## 2. Bridge — plugin_emit_event

- [x] 2.1 Add `msg.type === "plugin_emit_event"` handler in `bridge.ts`: guard `pi.events` + non-empty string `eventType`; `pi.events.emit(eventType, data ?? {})`
- [x] 2.2 Unit test: valid emit re-emits on pi.events; default `{}` data; missing eventType is a no-op

## 3. Action registry — event dispatch

- [x] 3.1 Add `ActionEvent` + optional `buildEvent` to `ActionRegistration`; make `buildPrompt?` optional; register-guard rejects an action without exactly one of buildPrompt/buildEvent
- [x] 3.2 `buildRunDispatch(automation, registry)` returns `{kind:"prompt",text} | {kind:"event",eventType,data}`; keep `buildRunPrompt` (optional-`buildPrompt` safe) for the prompt branch + legacy fallback
- [x] 3.3 Unit tests: event action → event dispatch; prompt action → prompt dispatch; null buildEvent → empty prompt; exactly-one-dispatch guard

## 4. Engine + index — event delivery (finalization unchanged)

- [x] 4.1 `RunContext` carries optional `emitEvent`; `startRunFor` resolves via `buildRunDispatch`
- [x] 4.2 `index.ts` register-correlation: event dispatch → `ctx.emitEventToSession`; prompt dispatch → `ctx.sendToSession` (once); finalize stays on `agent_end`

## 5. Flows plugin — flows.run event dispatch

- [x] 5.1 `flows.run` → `buildEvent { eventType:"flow:run", data:{ flowName, task } }`; malformed flow id → `null`
- [x] 5.2 Remove `flows.resume` and `flows.cancel`
- [x] 5.3 Update `ActionRegistrationLike` structural type (buildEvent); update tests (run-only; resume/cancel absent; malformed → null; registry-absent no-op)

## 6. Validation + docs

- [x] 6.1 Affected vitest suites green (runtime + extension + automation-plugin + flows-plugin)
- [x] 6.2 `tsc --noEmit` clean for automation-plugin + flows-plugin
- [x] 6.3 File-index rows for new/changed files (delegated per Documentation Update Protocol)
