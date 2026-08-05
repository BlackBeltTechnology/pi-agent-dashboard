# Clean up async semantics in the server and bridge extension

## Why

53 floating promises sit in the two packages where "fire and forget" is least
safe: `packages/extension` (37) and `packages/server` (16). These are the
WebSocket message pump, the PTY/terminal paths, session spawn, and the process
tracker — the exact subsystems `debug-dashboard` exists to unstick, and the exact
failure signature its FAQ describes (silent unhandled rejection → a session that
never registers, a restart loop, a spawn that yields no card).

This is deliberately a **separate change** from `cleanup-lint-debt-mechanical`.
Its sibling is mechanical; this one is not. Every site here is a semantic
decision with three different wrong answers:

| Fix | Risk if wrong |
|---|---|
| `await` it | serializes a hot path; can deadlock a PTY read or stall the message pump |
| `void` it | silences a rejection that should surface — makes the bug *less* diagnosable, not more |
| `.catch(log)` | correct default, but wrong if the caller must observe failure |

A blanket codemod across these 53 sites would be a regression generator. The
change therefore treats each site as a reviewed decision with a recorded
rationale, not as a lint-satisfying edit.

## What Changes

- **Fix 37 `noFloatingPromises` findings in `packages/extension/src`** — the
  bridge message pump, RPC dispatch, session-state poll, heartbeat watchdog, and
  auto-namer paths.
- **Fix 16 `noFloatingPromises` findings in `packages/server/src`** — session
  lifecycle, process management, tunnel, and persistence paths.
- **Classify every site before editing it.** Each fix is one of `await`
  (ordering is load-bearing), `void` (genuinely fire-and-forget AND rejection is
  already handled downstream), or `.catch(<handler>)` (rejection must be
  observed/logged). `void` requires a stated reason — it is the only option that
  can hide a defect.
- **Prove the hot paths did not serialize.** The WS broadcast and message-pump
  paths carry existing load harnesses (`ws-broadcast-load-harness`); a fix that
  regresses their throughput is rejected, not merged.
- **No severity flips.** As with the sibling, turning the rule on belongs to
  `add-typeaware-lint-gate`.

## Capabilities

### New Capabilities

*(none)*

### Modified Capabilities

- `code-quality-loop` — discharges the remaining half of the ratchet's
  "cleanup lands first" precondition for `noFloatingPromises`.

## Non-Goals

- Any rule severity flip (`add-typeaware-lint-gate`).
- Any fix outside `packages/server` and `packages/extension`
  (`cleanup-lint-debt-mechanical`).
- Refactoring the async architecture. This change fixes unhandled rejections; it
  does not redesign the message pump, and it does not convert callback paths to
  promises.
- Adding observability. Where a `.catch()` needs a logger and none exists, use
  the existing logging path — new instrumentation is out of scope.

## Impact

- `packages/extension/src/**` — 37 sites, concentrated in the bridge.
- `packages/server/src/**` — 16 sites.
- **Behaviour risk is real and asymmetric**: an incorrectly-added `await` inside
  the WS message pump or a PTY read loop changes ordering and can stall a live
  session. This is the highest-risk change in the ladder.
- No protocol, persistence, or public API change intended.

## Open Questions

- **Should `void` be permitted at all here?** Banning it forces every site to
  either await or handle, which is safer but larger. Permitting it keeps the diff
  small but re-hides exactly the class of bug this change exists to surface.
- **Is there an existing rejection handler these promises already fall through
  to?** If the bridge installs a global `unhandledRejection` handler, some of the
  37 are already observed and only need `void` + a pointer to that handler. This
  needs checking before the classification pass, because it changes the correct
  answer for potentially dozens of sites.
- **Do the load harnesses actually cover the touched paths**, or do they need
  extending before they can serve as the no-serialization oracle?

## Discipline Skills

- `systematic-debugging` — the classification pass is evidence-first: determine
  what each promise's rejection currently does before deciding how to handle it.
- `review-code` — 53 semantic decisions in the highest-risk subsystems; every one
  needs a reviewer that can see intent, not just the diff.
- `performance-optimization` — the "did an `await` serialize a hot path"
  question is a measured one; use the existing WS load harness as the oracle
  rather than reasoning about it.
- `observability-instrumentation` — a `.catch()` that swallows silently is the
  same defect wearing a different hat; rejections must land somewhere visible.
- `doubt-driven-review` — before the classification convention stands, stress it;
  it decides 53 edits and is expensive to revisit afterwards.
