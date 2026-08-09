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
