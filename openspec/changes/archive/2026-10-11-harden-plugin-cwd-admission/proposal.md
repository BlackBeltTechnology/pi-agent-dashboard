## Why

In the Electron app the sidebar shows dozens of red `GET /api/mcp-client/effective?cwd=<worktree>` 403s. Each one is `cwd not allowed` for a worktree whose main repo **is pinned**, and the same request returns 200 a moment later. No access prompt ever appears. There are two defects:

1. **A probe timeout is reported as a refusal.** `isAllowedCwd` (`packages/shared/src/cwd-guard.ts`) admits a worktree by deriving its main checkout via git. `mainCheckoutPath` runs up to 10 **synchronous** probes with a 200 ms budget each, on the Fastify request path. One admission takes about 130–220 ms even on an idle machine (measured). On page load the sidebar requests about 25 *distinct* folder cwds, and their derivations serialize on the event loop, so under load a probe exceeds its budget. The runner returns a timeout as a `Result` error, and the probe adapter (`unwrap(…, undefined)`) makes it indistinguishable from "not a repo". The guard then answers `403 not-allowed`. The client caches that as "not tracked" until the session or pin list changes; the pill then refetches and may get another false 403, which produces the repeated rows. A second synchronous re-check in the mcp-client config writer repeats the same failure on writes.
2. **Plugin cwd refusals never reach the access-grant dialog.** `add-access-grant-dialog` registered the `cwd` plane (held, remedy = pin the directory), but only `file-routes:exists` calls `holdDenial`. Plugin routes (mcp-client, kb) refuse locally with a bare 403 carrying a "Pin this directory" hint. `ServerPluginContext` has no way to raise the dialog, so a user action on an unknown folder fails without asking.

## What Changes

- **Indeterminate ≠ refused.** A new *classified* checkout-root resolver reads each probe's `Result.error.kind` under per-probe rules, so a timeout or spawn failure is reported as *failed*, separate from "not a repo". In the classified form, a failed probe never falls through to a weaker rule. The shared guard gains async `admitCwd` → `admit | refuse | indeterminate`. Plugin routes answer `indeterminate` with `503 { error: "cwd-admission-unavailable" }` plus `Retry-After`, never `403`. The existing resolvers and every other consumer are unchanged.
- **Deleted directories are refused cheaply.** A cwd that does not exist and is not known is refused before any git spawn. It would otherwise show up as a spawn failure.
- **Request-path admission is async, bounded, and decided once.** Probes and canonicalization run asynchronously. Admissions share a global concurrency cap and a deadline that aborts in-flight git and frees the slot. Concurrent requests for one cwd share one derivation. Nothing is cached across requests. An `admit` carries a one-shot admission token that never crosses the wire; the mcp-client config writer and `/live` accept it instead of re-running the synchronous guard.
- **Clients retry a transient failure.** The mcp-client pill and folder page, and the kb folder row and stats, treat `503 cwd-admission-unavailable` as transient. They retry with jittered backoff (one chain per cwd), never mark the folder "not tracked" or "denied", and show an error with Retry only after exhaustion. A genuine 403 behaves as today.
- **Plugin cwd denials can raise the access dialog.** `ServerPluginContext` gains an optional `holdCwdDenial(request, reply, { cwd, origin })`, gated to first-party / trusted plugins.
  - It wraps `holdDenial({ plane: "cwd", … })`.
  - It never prompts for a missing, `.git`, or ungrantable subject, and accepts only a closed set of origins.
  - On `allow-always` it re-runs the real guard; on `allow-once` it mints a one-shot token for exactly that cwd.
  - It is called only by user-initiated write routes: mcp-client save / delete / enable / convert, and kb reindex / config PUT / source-trust POST. Background reads and WS actions never prompt.
  - The core `file-routes:exists` site switches to the same verdict rules, which replaces its pins-only check.
- **Static analysis keeps its barrier.** Routes branch on a sync predicate `admissionAllows(admission, cwd)`, which is added to `.github/codeql/extensions/cwd-guard.model.yml` as a path-injection barrier guard.
- **Diagnosable.** An `indeterminate` decision logs `[cwd-admission] indeterminate` with the cwd, the failed probes, and the decision wall time, at most once per cwd per 60 s (bounded map).

## Capabilities

### New Capabilities
- `plugin-cwd-admission`: the shared plugin cwd guard's tri-state contract (admit / refuse / indeterminate → 503), async bounded non-blocking derivation with no cross-request cache, the one-shot admission token, and the trusted-gated host `holdCwdDenial` seam that lets a plugin's user-initiated write route raise the `cwd` access plane.

### Modified Capabilities
- `kb-plugin-cwd-guard`:
  - **Known-folder admission** gains a third, non-admitting outcome (indeterminate → 503).
  - **Git-repo-main admission**: a *failed* probe yields `503`, not rejection.
  - **Uniform enforcement across entry points**: indeterminate is handled on REST and on `plugin_action`, and is ordered before any IO.
- `access-grant-registry`: **A resumed request re-runs the guard it was denied by** spells out the `cwd`-plane re-run: real path, existence, `.git`, and forbidden rule always; full membership only on allow-always; allow-once admits the single held request. This codifies existing `file-routes` behaviour and extends it to plugin holds.
- `git-checkout-root-resolution`: **Checkout roots are resolved as three distinct facts**. A classified form distinguishes a *failed* probe from *no repository*. The unclassified form keeps "no result".
- `kb-folder-slot`:
  - **KB cwd admission**: an undecidable cwd gets a 503.
  - **KB row reflects index state**: a 503 is retried and is never `denied`.
- `mcp-client-folder-section`:
  - **Folder pill on sidebar and worktree cards**: a 503 is retried and never recorded as "not tracked".
  - **Folder page cwd is guarded**: same rule for the page, which shows an error with Retry after exhaustion.

## Impact

- `packages/shared/src/platform/runner.ts`: `runAsync` takes an optional `AbortSignal` (additive).
- `packages/shared/src/platform/git.ts`: classified probe adapter, `checkoutRootsClassifiedAsync`, `bindCheckoutClassifiedAsync`. The existing exports and their outputs are unchanged.
- `packages/shared/src/cwd-guard.ts`: `admitCwd`, `admissionAllows`, `consumeAdmission`, semaphore, deadline, in-flight dedupe. `isAllowedCwd` is unchanged.
- `packages/mcp-client-plugin/src/server/routes.ts` and `src/core/{config-writer,service,types}.ts`; `packages/kb-plugin/src/server/{kb-routes,index}.ts`: switch to `admitCwd`; return 503 or a WS transient error; thread the token; call `holdCwdDenial` on write routes.
- `packages/mcp-client-plugin/src/client/{api,hooks}.ts` and the folder page; `packages/kb-plugin/src/client/kb-api.ts` and the stats store / row: transient 503 handling.
- `packages/dashboard-plugin-runtime/src/server/server-context.ts`, `packages/server/src/server.ts`, `packages/server/src/access/`, `packages/server/src/routes/file-routes.ts`: the trusted-gated seam and the shared verdict rules.
- `.github/codeql/extensions/cwd-guard.model.yml`: new barrier-guard row.
- **Compatibility:** additive wire and API change. It adds a 503 status with body and `Retry-After`, a WS error shape, and an optional `ServerPluginContext.holdCwdDenial`. The 403 bodies are unchanged. An older client renders a 503 as a generic error with no retry, where today it shows a false "not tracked" or "denied". Ship client and server together. There is no persistence or schema change.
- **Rollback:** revert. Behaviour returns to the false-403 state, and no stored state needs migrating.
- **Out of scope:** orphaned or deleted `.worktrees/*` directories (they stay 403); prompting on background reads; widening `host.knownFolderCwds`; non-route consumers of the `mcp-client.config` service (they keep the sync guard).

## Discipline Skills

- `security-hardening`: changes an authorization guard on an untrusted `cwd`. `indeterminate` must never admit; the token must be one-shot and must never cross the wire; the hold seam must be trusted-gated, must refuse `.git`, missing, and ungrantable subjects, and must re-run the guard on `allow-always`; the CodeQL barrier must stay modelled.
- `performance-optimization`: removes up to 2 s of synchronous event-loop blocking per request on the page-load burst. Measure before and after.
- `observability-instrumentation`: logs `indeterminate` admissions, since today a timeout is invisible.
- `doubt-driven-review`: adds a public `ServerPluginContext` API (`holdCwdDenial`).
- `review-code`: before commit.
