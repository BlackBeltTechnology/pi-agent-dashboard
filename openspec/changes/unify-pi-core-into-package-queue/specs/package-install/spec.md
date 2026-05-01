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

- **WHEN** a caller invokes `packageQueue.enqueue({source: "pi-core:pi", kind: "pi-core", action: "update", scope: "global"})`
- **THEN** the queue POSTs to `/api/pi-core/update` with body `{packages: ["pi"]}`
- **AND** the queue does NOT POST to `/api/packages/update`

#### Scenario: Pi-core completion is signalled by the POST response

- **WHEN** a pi-core op's POST resolves with HTTP 200 and `body.data.results = [{name: "pi", success: true}]`
- **THEN** the queue immediately calls `completeRunning(true)` and advances to the next queued op
- **AND** any subsequent `pi_core_update_complete` WebSocket event for the same op SHALL be a no-op for the queue

#### Scenario: Pi-core failure surfaces as queue error

- **WHEN** a pi-core op's POST resolves with `body.data.results = [{name: "pi", success: false, error: "boom"}]`
- **THEN** the queue records `errorBySource.set("pi-core:pi", { message: "boom" })` and advances to the next queued op

### Requirement: Pi-core source key uses a `pi-core:` prefix convention

Pi-core operations SHALL use a `source` string of the form `"pi-core:" + packageName` (e.g. `"pi-core:pi"`, `"pi-core:pi-dashboard"`). The prefix is a self-documenting convention; the dispatch decision is made by the `kind` field, not by source-string prefix matching.

The prefix SHALL appear in `running.source`, `queue[].source`, `errorBySource` keys, and `successBySource` keys for pi-core operations. Components rendering pi-core rows SHALL look up state using the prefixed source.

#### Scenario: Per-row state lookup uses the prefixed source

- **GIVEN** a pi-core update is running for `pi`
- **WHEN** the Core sub-group of `UnifiedPackagesSection` calls `operations.statusFor("pi-core:pi")`
- **THEN** the result is `"running"`

#### Scenario: Source prefix does not collide with extension dispatch

- **GIVEN** an extension named `pi-core` exists in the npm registry (hypothetical)
- **WHEN** a user installs it via the recommended-extensions panel using `enqueue({source: "npm:pi-core", action: "install", scope: "global"})`
- **THEN** the queue dispatches as `kind: "extension"` (default) and POSTs to `/api/packages/install`
- **AND** the source string `"npm:pi-core"` does NOT match any pi-core op's source string `"pi-core:..."`, so per-source state lookups stay correct

### Requirement: Package queue subscribes to both `pi-package-event` and `pi-core-event`

The `PackageQueue` constructor SHALL attach `window.addEventListener` for both `"pi-package-event"` (existing) and `"pi-core-event"` (new). The handlers SHALL be separate methods (or a single dispatcher with explicit branches) so the type-narrowing and shape-validation for each channel are readable in isolation.

`pi-core-event` messages SHALL be processed as follows:

- `pi_core_update_progress` with `{name, phase, message?}` — if `running.kind === "pi-core"` and `running.source === "pi-core:" + name`, the queue SHALL update `running.message` to `message ?? "<name>: <phase>"` and notify subscribers.
- `pi_core_update_complete` — no-op for queue tracking. Other consumers (e.g. `usePiCoreVersions`) MAY continue to listen on the same channel for their own purposes (e.g. version-list refresh) without contention.

#### Scenario: Pi-core progress event updates running message

- **GIVEN** the queue's running op is `{kind: "pi-core", source: "pi-core:pi"}` with message `"Starting…"`
- **WHEN** a `pi_core_update_progress` event arrives with `{name: "pi", phase: "output", message: "added 12 packages"}`
- **THEN** `running.message` becomes `"added 12 packages"` and subscribers are notified

#### Scenario: Pi-core progress for a non-running name is ignored

- **GIVEN** the queue's running op is `{kind: "pi-core", source: "pi-core:pi"}`
- **WHEN** a `pi_core_update_progress` event arrives with `{name: "pi-dashboard", phase: "output", message: "..."}`
- **THEN** the queue ignores the event; `running.message` is unchanged

#### Scenario: Pi-core complete event is a no-op for the queue

- **GIVEN** the queue's running op is `{kind: "pi-core", source: "pi-core:pi"}`
- **AND** the corresponding POST has not yet resolved
- **WHEN** a `pi_core_update_complete` event arrives via WebSocket
- **THEN** the queue does NOT transition the running op based on the WS event
- **AND** the running op transitions only when the POST response resolves

### Requirement: Cross-kind ops are serialized by the queue

Because `packageQueue` is single-flight (at most one running op across all kinds), an extension install enqueued while a pi-core update is the running op SHALL enter the `queued` state and SHALL be POSTed only after the pi-core update completes. The reverse SHALL also hold: a pi-core update enqueued while an extension install is running SHALL queue.

This requirement closes the "cross-domain 409" UX bug class: today, a click on an extension install button while pi-core is updating produces a 409 response with red error text on the wrong-looking row.

#### Scenario: Extension install while pi-core updates → queued

- **GIVEN** the queue's running op is `{kind: "pi-core", source: "pi-core:pi"}`
- **WHEN** a user invokes `operations.install("npm:pi-flows")` from the Recommended Extensions panel
- **THEN** the extension install enters the `"queued"` state
- **AND** no POST to `/api/packages/install` is made yet
- **WHEN** the pi-core update completes
- **THEN** the extension install transitions from `"queued"` to `"running"` and POSTs to `/api/packages/install`

#### Scenario: Pi-core update while extension installs → queued

- **GIVEN** the queue's running op is `{kind: "extension", source: "npm:foo"}` waiting on its `package_operation_complete` event
- **WHEN** the user clicks Update on a Core row, invoking `operations.coreUpdate("pi")`
- **THEN** the pi-core op enters the `"queued"` state
- **AND** no POST to `/api/pi-core/update` is made yet
- **WHEN** the extension op completes
- **THEN** the pi-core op transitions from `"queued"` to `"running"` and POSTs to `/api/pi-core/update`

### Requirement: Queue exposes `isAnyRunning()` for cross-domain UI primitives

The `packageQueue` SHALL expose a public method `isAnyRunning(): boolean` that returns `true` when any op (regardless of `kind`) is currently the running op, and `false` otherwise. This primitive enables future cross-domain UI work (e.g., disabling all package-mutation buttons while any op is running) without committing to that work as part of this change.

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

The `usePackageOperations` hook SHALL expose `coreUpdate(name: string): void` that internally calls `packageQueue.enqueue({ source: "pi-core:" + name, kind: "pi-core", action: "update", scope: "global" })`. This is the canonical way for components to enqueue a pi-core update.

The hook's existing methods (`install`, `remove`, `update`, `move`, `statusFor`, `messageFor`, `runningSource`, `queueDepth`, `clearOperation`, etc.) SHALL be preserved unchanged.

#### Scenario: coreUpdate enqueues a pi-core op

- **WHEN** a component calls `operations.coreUpdate("pi")`
- **THEN** the queue's `running` (or `queue[]`) contains an entry with `source: "pi-core:pi"`, `kind: "pi-core"`, `action: "update"`, `scope: "global"`

#### Scenario: Update All splits into N enqueues

- **WHEN** the user clicks "Update All" with 3 updatable Core packages
- **AND** the component invokes `operations.coreUpdate(name)` for each
- **THEN** the queue contains exactly 3 pi-core ops, processed FIFO
- **AND** each op POSTs `/api/pi-core/update` with `{packages: [oneName]}`
- **AND** they are NOT batched into a single POST

