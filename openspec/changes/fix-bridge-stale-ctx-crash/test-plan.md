# Test plan — fix-bridge-stale-ctx-crash

Derived from `specs/bridge-auto-start-lifecycle/spec.md`. The fix is one guard
helper applied at four call sites, so the risk is concentrated in two places:
the guard being too narrow (still throws) and the guard being too broad
(swallows real auto-start errors). Both get explicit rows.

`bridge.ts` is not directly importable in unit tests — the package's existing
idiom is a pure mirror (see `bridge-system-followup.test.ts`). Rows E1–E5
therefore exercise the extracted guard helper plus a mirrored callback wiring,
which is where the logic lives.

## Behaviour + error handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Late continuation never crashes | fault-injection (stale ctx) | L1 | automated | a ctx whose `ui` getter throws the pi invalidation Error | spinner teardown runs in a promise continuation | teardown returns normally; no throw; **no unhandled rejection** after flushing ~20 setImmediate cycles |
| E2 | Late continuation never crashes | fault-injection (stale ctx) | L1 | automated | same stale ctx | `notify` callback invoked with a failure message | call returns normally; message dropped |
| E3 | Late continuation never crashes | fault-injection (stale ctx) | L1 | automated | same stale ctx | spinner mount (`onLaunchStart`) runs | mount skipped; no throw |
| E4 | A live context is unaffected | decision-table (parity) | L1 | automated | an active ctx recording `ui` calls | mount → notify → teardown | each reaches `ctx.ui` with the same arguments as before; `setWidget` called with `undefined` on teardown |
| E5 | Auto-start logic errors still propagate | fault-injection (non-invalidation error) | L1 | automated | guard wrapping a fn that throws a plain `Error("boom")` from auto-start logic, not a `ctx.ui` access | error raised | error is NOT swallowed by the UI guard — it reaches the caller |
| E6 | Spinner interval cleared | state-transition | L1 | automated | teardown invoked twice, ctx stale on the second call | teardown runs | interval cleared exactly once; second call is a safe no-op |
| F1 | Prompt round-trip survives | end-to-end | L3 | automated | harness session, scripted `plain-text` scenario | user sends the prompt | scripted answer renders in the message DOM (this is `tests/e2e/faux-text.spec.ts`, currently RED — it goes green on the fix) |
| F2 | Prompt round-trip survives | end-to-end | L3 | automated | harness session, scripted `ask-select` scenario | user sends the prompt | the interactive option button renders (`tests/e2e/faux-ask.spec.ts`, currently RED) |

## Notes

- **Fails-on-revert teeth (mandatory).** E1 must go RED when the guard is removed
  from production source. Per `author-floating-promise-owner-tests`: assert both
  that the call did not throw AND that `process.on("unhandledRejection")`
  collected nothing after flushing, then verify `git diff` shows no production
  change once restored.
- F1/F2 are **existing** specs, not new ones. No new E2E spec is authored: the
  regression's whole signature is that these already-shipped specs fail. Their
  transition RED → GREEN against the docker harness is the acceptance gate.
- Run unit tests HOME-isolated: `HOME=$(mktemp -d) npx vitest run <paths>`.

## Outcome (implementation)

**E1–E6 green**, with fails-on-revert teeth proven: defeating `runUiSafely`'s
`try/catch` turns 5 of 8 tests RED (including E1's unhandled-rejection
assertion); restoring it returns them to green with `git diff` clean of
production changes.

**The crash is fixed**, verified in-container on the exact repro:

```
$ pi -p "[[faux:plain-text]] go" --model faux/faux-1
[dashboard] sendFlowsList: 1 flows, sessionId=019fe855
The quick brown faux jumps over the lazy dog.
                       <-- clean exit; previously a stale-ctx stack trace here
```

**F1/F2 remain RED — a SECOND, distinct fault.** With the crash gone, a
dashboard-spawned session still shows `Dashboard server failed to start:
readiness timeout`, the prompt stuck at `sending`, and the composer disabled.
That notice was present in the ORIGINAL failure too: this change stopped it from
killing the process, but it was never the delivery blocker.

### Correction — the delivery pipeline is NOT broken

A follow-up investigation disproved the "prompts are never delivered" reading
above. Driven through the REST API against the same container:

- `POST /api/session/spawn` → the session registers. An earlier "0 sessions"
  reading was a parsing mistake on my side: `/api/sessions` returns
  `{success, data:[...]}`, not a bare array.
- `POST /api/session/:id/prompt` with `[[faux:plain-text]] go` → the session
  answers (`tokensOut` 12) and returns to `idle`.

So spawn, bridge registration, prompt delivery and the faux model all work.

`Dashboard server failed to start: readiness timeout` is real but **cosmetic
here**: it is a stale `notifyLog` entry from a boot-time race in which the
bridge's `launchServer` readiness probe expires while the server is still
coming up (`autoStartServer` then does a single immediate `isDashboardRunning`
recheck and gives up). The server does come up, the bridge does connect, and a
session spawned once the server is healthy shows no warning at all. Worth
hardening (widen the recheck window), but it is not what fails the E2E specs.

**The remaining E2E failure is UI-level and NOT yet root-caused.** The spec
drives the composer, and the failure signature is an optimistic prompt stuck at
`sending` with the composer disabled — i.e. the browser client never settles the
send, even though the same prompt succeeds over REST. Next investigation starts
at the client's optimistic-prompt ack path and the browser↔server websocket, NOT
at the bridge, the faux provider, or session registration — all three are proven
healthy.
