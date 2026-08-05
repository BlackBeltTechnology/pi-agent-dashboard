## ADDED Requirements

### Requirement: Package queue dispatches by operation kind

The client `packageQueue` SHALL distinguish between two operation kinds:

- `"extension"` — install / remove / update of pi extensions, skills, prompts, or themes via `/api/packages/{install,remove,update}`. Async completion model (POST returns `202` with `operationId`; final state arrives via `package_operation_complete` WebSocket event).
- `"pi-core"` — update of pi core packages (`pi`, `pi-dashboard`, `pi-model-proxy`, etc.) via `/api/pi-core/update`. Synchronous completion model (POST blocks until npm update finishes; final state is in the response body).

Each entry in the queue (running, queued, error, success) SHALL carry a `kind` field. The default value when unspecified by callers SHALL be `"extension"` — every existing call site continues to work without modification.

`packageQueue.postOperation` SHALL switch on `kind` and dispatch to the corresponding endpoint and completion-tracking strategy. The 409-retry-once policy applies to both kinds uniformly.

#### Scenario: Default kind for extension call sites

- **WHEN** a caller invokes `packageQueue.enqueue({source: "npm:foo", action: "install", scope: "global"})` without specifying `kind`
- **THEN** the queue treats the op as `kind: "extension"` and POSTs to `/api/packages/install`

#### Scenario: Pi-core dispatch via explicit kind

- **WHEN** a caller invokes `packageQueue.enqueue({source: "pi-core:@mariozechner/pi-coding-agent", kind: "pi-core", action: "update", scope: "global"})`
- **THEN** the queue POSTs to `/api/pi-core/update` with body `{packages: ["@mariozechner/pi-coding-agent"]}`
- **AND** the queue does NOT POST to `/api/packages/update`

#### Scenario: Pi-core completion is signalled by the POST response

- **WHEN** a pi-core op's POST resolves with HTTP 200 and `body.data.results = [{name: "@mariozechner/pi-coding-agent", success: true}]`
- **THEN** the queue immediately calls `completeRunning(true)` and advances to the next queued op
- **AND** any `pi_core_update_complete` WebSocket event for the same op (which typically arrives BEFORE the POST response in practice — see scenario "Pi-core complete event is a no-op for the queue" below) SHALL be a no-op for the queue

#### Scenario: Pi-core failure surfaces as queue error

- **WHEN** a pi-core op's POST resolves with `body.data.results = [{name: "@mariozechner/pi-coding-agent", success: false, error: "boom"}]`
- **THEN** the queue records `errorBySource.set("pi-core:@mariozechner/pi-coding-agent", { message: "boom" })` and advances to the next queued op

### Requirement: The queue carries no package-manager knowledge

The client `packageQueue` SHALL NOT encode which package manager performs an install. Its pi-core request body SHALL contain only `{packages: [name]}` — no package-manager field, flag, or hint. The server owns that decision: `detectPackageManager(repoRoot)` resolves `pnpm` when `pnpm-workspace.yaml` or `pnpm-lock.yaml` is present and `npm` otherwise, and the pi-core updater targets a resolved install location (npm global prefix, or `~/.pi-dashboard/` for managed installs) rather than the repo tree.

This keeps the queue correct without modification when the server's package-manager selection changes. The queue's contract is transport plus state: it POSTs a package name and renders whatever the server reports.

#### Scenario: Pi-core request body carries only the package name

- **WHEN** the queue dispatches a `kind: "pi-core"` op for `@mariozechner/pi-coding-agent`
- **THEN** the POST body is exactly `{packages: ["@mariozechner/pi-coding-agent"]}`
- **AND** it contains no package-manager field, flag, or hint

#### Scenario: Package-manager choice changing server-side needs no queue change

- **GIVEN** the server switches the install it performs from `npm` to the repo's own package manager
- **WHEN** a pi-core op is dispatched
- **THEN** the queue's request shape, dispatch arm, and completion handling are unchanged
- **AND** any resulting error text is surfaced verbatim from `results[].error`

### Requirement: Only the busy lock produces a 409; other failures keep their own message

`POST /api/pi-core/update` distinguishes four response shapes. The queue SHALL map each to a distinct outcome and SHALL NOT flatten a non-busy failure into the generic busy message:

| Condition | HTTP | Body | Queue outcome |
|---|---|---|---|
| Busy lock held | 409 | `{success: false, error}` | retry once, then error with `body.error` |
| Unknown package name | 400 | `{success: false, error}` | error with `body.error`, **no retry** |
| Nothing resolved as updatable | 200 | `{success: true, data: {results: []}}` | **success** (no-op), not an error |
| Per-package failure | 200 | `{success: true, data: {results: [{success: false, error}]}}` | error with `results[0].error`, **no retry** |

The 409-retry-once policy SHALL apply only to the busy-lock shape. A package-manager-level failure — for example pi 0.82 requiring a `pnpm store prune` when a pnpm-installed core package's cached version has been removed — arrives as the per-package shape (HTTP 200), so it SHALL reach the row as its own distinguishable message. Retrying it would be futile (a 500 ms backoff cannot repair a pruned cache) and would replace the actionable text with generic busy wording.

#### Scenario: A pnpm cache-prune failure is distinguishable, not a 409

- **WHEN** a pi-core op's POST resolves with HTTP 200 and `body.data.results = [{name: "@earendil-works/pi-coding-agent", success: false, error: "ERR_PNPM_NO_OFFLINE_TARBALL … run `pnpm store prune` and retry"}]`
- **THEN** the queue records that exact error text for `"pi-core:@earendil-works/pi-coding-agent"`
- **AND** the message is NOT replaced by the busy text and is NOT `"Update failed"`
- **AND** the queue does NOT retry — exactly one POST is made

#### Scenario: An unknown package name surfaces its own 400 message

- **GIVEN** a client POSTs a core package name the server no longer resolves (reachable via the `@mariozechner` → `@earendil-works` core rename)
- **WHEN** the POST resolves with HTTP 400 and `{success: false, error: "Unknown package(s): …"}`
- **THEN** the queue records that message verbatim and does NOT retry

#### Scenario: An empty results array is a no-op, not a failure

- **GIVEN** a core row's `updateAvailable` flipped false between render and click
- **WHEN** the POST resolves with HTTP 200 and `body.data.results = []`
- **THEN** the queue completes the op as a success and clears `running`
- **AND** the row does NOT render an error

### Requirement: Pi-core source key uses a `pi-core:` prefix convention

Pi-core operations SHALL use a `source` string of the form `"pi-core:" + packageName`, where `packageName` is the full scoped npm name from `CORE_PACKAGE_NAMES` in `packages/server/src/pi-core-checker.ts` — e.g. `"pi-core:@mariozechner/pi-coding-agent"`, `"pi-core:@blackbelt-technology/pi-agent-dashboard"`, `"pi-core:@blackbelt-technology/pi-model-proxy"`. The prefix is a self-documenting convention; the dispatch decision is made by the `kind` field, not by source-string prefix matching.

The prefix SHALL appear in `running.source`, `queue[].source`, `errorBySource` keys, and `successBySource` keys for pi-core operations. Components rendering pi-core rows SHALL look up state using the prefixed source.

#### Scenario: Per-row state lookup uses the prefixed source

- **GIVEN** a pi-core update is running for `@mariozechner/pi-coding-agent`
- **WHEN** the Core sub-group of `UnifiedPackagesSection` calls `operations.statusFor("pi-core:@mariozechner/pi-coding-agent")`
- **THEN** the result is `"running"`

#### Scenario: Source prefix does not collide with extension dispatch

- **GIVEN** an extension whose source string starts with the literal characters `pi-core` exists in the npm registry (hypothetical — actual core package names are scoped, e.g. `@mariozechner/pi-coding-agent`)
- **WHEN** a user installs it via the recommended-extensions panel using `enqueue({source: "npm:pi-core-helper", action: "install", scope: "global"})`
- **THEN** the queue dispatches as `kind: "extension"` (default) and POSTs to `/api/packages/install`
- **AND** the source string `"npm:pi-core-helper"` does NOT match any pi-core op's source string (which always begins with the literal `"pi-core:"`, including the colon), so per-source state lookups stay correct

### Requirement: Package queue subscribes to both `pi-package-event` and `pi-core-event`

The `PackageQueue` constructor SHALL attach `window.addEventListener` for both `"pi-package-event"` (existing) and `"pi-core-event"` (new). The handlers SHALL be separate methods (or a single dispatcher with explicit branches) so the type-narrowing and shape-validation for each channel are readable in isolation.

`pi-core-event` messages SHALL be processed as follows:

- `pi_core_update_progress` with `{name, phase, message?}` — if `running.kind === "pi-core"` and `running.source === "pi-core:" + name`, the queue SHALL update `running.message` to `message ?? "<name>: <phase>"` and notify subscribers.
- `pi_core_update_complete` — no-op for queue tracking. Other consumers (e.g. `usePiCoreVersions`) MAY continue to listen on the same channel for their own purposes (e.g. version-list refresh) without contention.

#### Scenario: Pi-core progress event updates running message

- **GIVEN** the queue's running op is `{kind: "pi-core", source: "pi-core:@mariozechner/pi-coding-agent"}` with message `"Starting…"`
- **WHEN** a `pi_core_update_progress` event arrives with `{name: "@mariozechner/pi-coding-agent", phase: "output", message: "added 12 packages"}`
- **THEN** `running.message` becomes `"added 12 packages"` and subscribers are notified

#### Scenario: Pi-core progress for a non-running name is ignored

- **GIVEN** the queue's running op is `{kind: "pi-core", source: "pi-core:@mariozechner/pi-coding-agent"}`
- **WHEN** a `pi_core_update_progress` event arrives with `{name: "@blackbelt-technology/pi-agent-dashboard", phase: "output", message: "..."}`
- **THEN** the queue ignores the event; `running.message` is unchanged

#### Scenario: Pi-core complete event is a no-op for the queue (common-case timing)

- **GIVEN** the queue's running op is `{kind: "pi-core", source: "pi-core:@mariozechner/pi-coding-agent"}`
- **AND** the corresponding POST has not yet resolved
- **WHEN** a `pi_core_update_complete` event arrives via WebSocket (the COMMON case — the server broadcasts the WS event before returning the HTTP response, so the WS event nearly always reaches the client first)
- **THEN** the queue does NOT transition the running op based on the WS event
- **AND** the running op transitions only when the POST response resolves

### Requirement: Cross-kind ops are serialized by the queue

Because `packageQueue` is single-flight (at most one running op across all kinds), an extension install enqueued while a pi-core update is the running op SHALL enter the `queued` state and SHALL be POSTed only after the pi-core update completes. The reverse SHALL also hold: a pi-core update enqueued while an extension install is running SHALL queue.

This requirement closes the "cross-domain 409" UX bug class: today, a click on an extension install button while pi-core is updating produces a 409 response with red error text on the wrong-looking row.

#### Scenario: Extension install while pi-core updates → queued

- **GIVEN** the queue's running op is `{kind: "pi-core", source: "pi-core:@mariozechner/pi-coding-agent"}`
- **WHEN** a user invokes `operations.install("npm:pi-flows")` from the Recommended Extensions panel
- **THEN** the extension install enters the `"queued"` state
- **AND** no POST to `/api/packages/install` is made yet
- **WHEN** the pi-core update completes
- **THEN** the extension install transitions from `"queued"` to `"running"` and POSTs to `/api/packages/install`

#### Scenario: Pi-core update while extension installs → queued

- **GIVEN** the queue's running op is `{kind: "extension", source: "npm:foo"}` waiting on its `package_operation_complete` event
- **WHEN** the user clicks Update on a Core row, invoking `operations.coreUpdate("@mariozechner/pi-coding-agent")`
- **THEN** the pi-core op enters the `"queued"` state
- **AND** no POST to `/api/pi-core/update` is made yet
- **WHEN** the extension op completes
- **THEN** the pi-core op transitions from `"queued"` to `"running"` and POSTs to `/api/pi-core/update`

### Requirement: A click during a running operation enqueues and is visibly queued

No control that rides `packageQueue` SHALL be disabled merely because some *other* operation is running. Clicking such a control while an operation is in flight SHALL enqueue the work, and the affected row SHALL render a visible `queued` state, then `running`, then the result.

The governing principle is **no enabled click is silently lost**. A control that silently 409s and a control that is inertly disabled are the same defect: the UI failing to account for the click. A row whose own operation is already pending (`running` or `queued`) MAY disable its own action button, because that work is already registered and visibly reported — which is the opposite of losing it.

#### Scenario: Enqueue while running renders queued, not an error

- **GIVEN** a pi-core update for `@earendil-works/pi-coding-agent` is the running op
- **WHEN** the user clicks Update on a different Core row and on an extension row
- **THEN** neither button was disabled at click time
- **AND** both rows render a visible `queued` indicator
- **AND** no 409 error text is shown to the user
- **AND** no POST is issued for either until the running op completes

#### Scenario: A queued row reports itself as queued

- **GIVEN** a row's operation is in the `queued` state
- **THEN** that row's action button is labelled `Queued` and is disabled
- **AND** a tooltip explains it is waiting for the current operation to finish

### Requirement: Enqueue dedupes on the (source, action) pair

`packageQueue.enqueue` SHALL drop a request when the same **(source, action)** pair is already `running` or `queued`. It SHALL NOT dedupe on `source` alone: a different action against the same source is distinct work and SHALL be accepted.

This is what makes leaving row buttons enabled safe — a double-click cannot stack duplicate work, and "Update All" is idempotent under repeat clicks.

#### Scenario: Exact duplicate is dropped

- **GIVEN** `{source: "npm:foo", action: "update"}` is queued
- **WHEN** `{source: "npm:foo", action: "update"}` is enqueued again
- **THEN** the queue depth is unchanged

#### Scenario: Same source, different action is accepted

- **GIVEN** `{source: "npm:foo", action: "update"}` is queued
- **WHEN** `{source: "npm:foo", action: "remove"}` is enqueued
- **THEN** the queue depth increases by one

#### Scenario: Update All is idempotent mid-flight

- **GIVEN** the Core group has 2 updatable packages and "Update All" has been clicked once (1 running, 1 queued)
- **WHEN** the user clicks "Update All" again
- **THEN** the button was enabled
- **AND** the queue depth is unchanged

### Requirement: The queue drains strictly FIFO in enqueue order

Operations SHALL be POSTed one at a time in the order they were enqueued, regardless of `kind`.

#### Scenario: FIFO order across kinds

- **GIVEN** the running op is a pi-core update for package A
- **AND** a pi-core update for package B was enqueued, then an extension install for `npm:pi-flows`
- **WHEN** A completes
- **THEN** B becomes the running op and POSTs
- **AND** `npm:pi-flows` remains `queued`
- **WHEN** B completes
- **THEN** `npm:pi-flows` becomes the running op and POSTs to `/api/packages/install`

### Requirement: Move and Reset-to-npm are the only controls disabled while busy

The Move and Reset-to-npm controls SHALL be disabled whenever `packageQueue.isAnyRunning()` is true, and SHALL surface the reason via tooltip. No other package control SHALL be disabled on that basis.

**Recorded reason**: these two operations do not ride `packageQueue`. They register into `moveTracker` (`lib/nav/move-tracker.ts`) and POST directly. Their identity is `moveId`, not `source`, and they carry partial-success semantics (install at destination succeeded / remove at origin failed) that the source-keyed `statusFor(source)` contract cannot express without a second identity axis. Because they are unqueued they take the server busy lock directly **with no 409 retry**, so leaving them enabled mid-flight would reproduce exactly the silent failure this change removes. Disabling them is therefore the truthful option until they are migrated into the queue (out of scope here).

#### Scenario: Move and Reset disabled with a stated reason while any op runs

- **GIVEN** any package operation is the running op
- **THEN** the row's Move control is disabled
- **AND** the row's Reset-to-npm control is disabled
- **AND** both carry a tooltip stating they cannot be queued yet
- **AND** the same row's Update button remains enabled

#### Scenario: Move and Reset are live when idle

- **GIVEN** no operation is running
- **THEN** the Move and Reset-to-npm controls are enabled

### Requirement: Queue exposes `isAnyRunning()` for cross-domain UI primitives

The `packageQueue` SHALL expose a public method `isAnyRunning(): boolean` that returns `true` when any op (regardless of `kind`) is currently the running op, and `false` otherwise. Its sole consumer in this change is the `locked` signal that disables the Move and Reset-to-npm controls (see "Move and Reset-to-npm are the only controls disabled while busy").

`usePackageOperations` SHALL surface `isAnyRunning` on its return value.

#### Scenario: isAnyRunning during pi-core update

- **WHEN** a pi-core update is the running op
- **THEN** `packageQueue.isAnyRunning() === true`

#### Scenario: isAnyRunning during extension op

- **WHEN** an extension install / remove / update is the running op
- **THEN** `packageQueue.isAnyRunning() === true`

#### Scenario: isAnyRunning when idle

- **WHEN** there is no running op (queue empty, no in-flight POST)
- **THEN** `packageQueue.isAnyRunning() === false`

### Requirement: `usePackageOperations` exposes a typed `coreUpdate` helper

The `usePackageOperations` hook SHALL expose `coreUpdate(name: string): void` that internally calls `packageQueue.enqueue({ source: "pi-core:" + name, kind: "pi-core", action: "update", scope: "global" })`. The `name` argument SHALL be the full scoped npm name (matching `PiCorePackage.name` from `GET /api/pi-core/versions`). The `scope: "global"` value is a non-meaningful placeholder for pi-core ops — the `/api/pi-core/update` endpoint does not consume `scope`; install location is determined server-side from `PiCorePackage.installSource`. This is the canonical way for components to enqueue a pi-core update.

The hook's existing methods (`install`, `remove`, `update`, `move`, `statusFor`, `messageFor`, `runningSource`, `queueDepth`, `clearOperation`, etc.) SHALL be preserved unchanged.

#### Scenario: coreUpdate enqueues a pi-core op

- **WHEN** a component calls `operations.coreUpdate("@mariozechner/pi-coding-agent")`
- **THEN** the queue's `running` (or `queue[]`) contains an entry with `source: "pi-core:@mariozechner/pi-coding-agent"`, `kind: "pi-core"`, `action: "update"`, `scope: "global"`

#### Scenario: Update All splits into N enqueues

- **WHEN** the user clicks "Update All" with 3 updatable Core packages (e.g. `@mariozechner/pi-coding-agent`, `@blackbelt-technology/pi-agent-dashboard`, `@blackbelt-technology/pi-model-proxy`)
- **AND** the component invokes `operations.coreUpdate(name)` for each
- **THEN** the queue contains exactly 3 pi-core ops, processed FIFO
- **AND** each op POSTs `/api/pi-core/update` with `{packages: [oneScopedName]}`
- **AND** they are NOT batched into a single POST

