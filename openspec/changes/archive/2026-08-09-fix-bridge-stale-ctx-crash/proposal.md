# Fix the bridge's stale-ctx crash on the auto-start path

## Why

Every faux browser-E2E round-trip on `develop` is broken. A session accepts a
prompt, the model answers, and then the pi process **dies**. The dashboard shows
the prompt stuck at `sending` with the composer disabled.

Reproduced in the docker harness with an in-container headless run:

```
$ pi -p "[[faux:plain-text]] go" --model faux/faux-1
[dashboard] sendFlowsList: 1 flows, sessionId=019fe835
The quick brown faux jumps over the lazy dog.          <-- model is FINE
.../pi-coding-agent/dist/core/extensions/runner.js:360
            throw new Error(this.staleMessage);
Error: This extension ctx is stale after session replacement or reload. ...
    at ExtensionRunner.assertActive (.../runner.js:360:19)
    at get ui (.../runner.js:465:24)
    at stopSpinner (/app/packages/extension/src/bridge.ts:2553:11)
    at /app/packages/extension/src/bridge.ts:2610:21
```

The faux provider is not at fault — it produced its answer. The **bridge** is.

`autoStartServer(...)` (`packages/extension/src/bridge.ts:2555`) is a
long-running async operation. Its `.then()` / `.catch()` continuation, and the
`notify` / `onLaunchStart` / `onLaunchEnd` callbacks it invokes, all capture the
extension `ctx` and touch `ctx.ui`. That continuation can land **after** the
session has been replaced or reloaded.

Since pi 0.84 (adopted in `c4acfcc02`), `AgentSession.dispose()` calls
`extensionRunner.invalidate(...)`, after which **every `ctx.ui` getter throws**
(`runner.js` `assertActive`). Because the throw happens inside a floating-promise
continuation, nothing owns it — it surfaces as an unhandled rejection and takes
the process down.

Impact:

- **All faux E2E specs fail** (`faux-text`, `faux-ask`, and every spec that drives
  a prompt), so the L3 layer of the test pyramid is effectively offline. Verified
  failing on a clean `develop` tree with a fresh image build via the managed
  Playwright `globalSetup`; `smoke.spec.ts` passes, so the shell and WS are fine.
- Any real user session that reloads/forks/switches while the dashboard
  auto-start is still in flight can have its pi process killed.

This blocks the L3 gate of `unify-folder-status-capsule`, which is why it was
found; it is not caused by that change and is fixed separately here.

## What Changes

Guard every `ctx.ui` touch reachable from the `autoStartServer` continuation so a
stale ctx degrades to a no-op instead of throwing.

Staleness is **not observable**: `assertActive()` throws and pi exposes no
predicate (no `isActive` / `isStale` on the public surface). The only available
guard is to attempt the call and swallow the invalidation error. That is sound
here because all four call sites are UI presentation for a session that no longer
exists — there is nothing left to present to.

- `notify:` — reports auto-start progress/failure (this is what emitted the
  "Dashboard server failed to start: readiness timeout" line seen in the UI).
- `onLaunchStart` — mounts the launch spinner widget.
- `onLaunchEnd` and the `.then()` / `.catch()` safety net — both call
  `stopSpinner()`, which tears the widget down.

Non-goals: changing auto-start semantics, the spinner's appearance, or the
session-replacement lifecycle itself. No protocol or server change.

## Impact

- `packages/extension/src/bridge.ts` — one small guard helper plus its four call
  sites.
- Removes a crash that can kill any session whose auto-start is still in flight
  when the session is replaced or reloaded.

  **Correction:** an earlier draft of this line claimed the fix "restores the
  entire faux E2E suite". It does not, and it does not unblock
  `unify-folder-status-capsule` tasks 2.21–2.28. Follow-up investigation showed
  spawn, bridge registration, prompt delivery and the faux model all work over
  REST against the same container; the remaining E2E failure is client-side (an
  optimistic prompt stuck at `sending`). See the correction section in
  `test-plan.md`.
- Requires `npm run reload` (extension change), not a server restart.

## Discipline Skills

`systematic-debugging` (root-caused from the crash stack, already done),
`review-code` (extension lifecycle change before commit).
