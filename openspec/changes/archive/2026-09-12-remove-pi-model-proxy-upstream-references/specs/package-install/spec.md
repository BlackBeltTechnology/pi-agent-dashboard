## MODIFIED Requirements

### Requirement: Pi-core source key uses a `pi-core:` prefix convention

Pi-core operations SHALL use a `source` string of the form `"pi-core:" + packageName`, where `packageName` is the full scoped npm name from `CORE_PACKAGE_NAMES` in `packages/server/src/pi/pi-core-checker.ts` — e.g. `"pi-core:@mariozechner/pi-coding-agent"`, `"pi-core:@earendil-works/pi-coding-agent"`, `"pi-core:@blackbelt-technology/pi-agent-dashboard"`. The prefix is a self-documenting convention; the dispatch decision is made by the `kind` field, not by source-string prefix matching.

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

### Requirement: `usePackageOperations` exposes a typed `coreUpdate` helper

The `usePackageOperations` hook SHALL expose `coreUpdate(name: string): void` that internally calls `packageQueue.enqueue({ source: "pi-core:" + name, kind: "pi-core", action: "update", scope: "global" })`. The `name` argument SHALL be the full scoped npm name (matching `PiCorePackage.name` from `GET /api/pi-core/versions`). The `scope: "global"` value is a non-meaningful placeholder for pi-core ops — the `/api/pi-core/update` endpoint does not consume `scope`; install location is determined server-side from `PiCorePackage.installSource`. This is the canonical way for components to enqueue a pi-core update.

The hook's existing methods (`install`, `remove`, `update`, `move`, `statusFor`, `messageFor`, `runningSource`, `queueDepth`, `clearOperation`, etc.) SHALL be preserved unchanged.

#### Scenario: coreUpdate enqueues a pi-core op

- **WHEN** a component calls `operations.coreUpdate("@mariozechner/pi-coding-agent")`
- **THEN** the queue's `running` (or `queue[]`) contains an entry with `source: "pi-core:@mariozechner/pi-coding-agent"`, `kind: "pi-core"`, `action: "update"`, `scope: "global"`

#### Scenario: Update All splits into N enqueues

- **WHEN** the user clicks "Update All" with 3 updatable Core packages (e.g. `@earendil-works/pi-coding-agent`, `@mariozechner/pi-coding-agent`, `@blackbelt-technology/pi-agent-dashboard`)
- **AND** the component invokes `operations.coreUpdate(name)` for each
- **THEN** the queue contains exactly 3 pi-core ops, processed FIFO
- **AND** each op POSTs `/api/pi-core/update` with `{packages: [oneScopedName]}`
- **AND** they are NOT batched into a single POST

### Requirement: Package queue dispatches by operation kind

The client `packageQueue` SHALL distinguish between two operation kinds:

- `"extension"` — install / remove / update of pi extensions, skills, prompts, or themes via `/api/packages/{install,remove,update}`. Async completion model (POST returns `202` with `operationId`; final state arrives via `package_operation_complete` WebSocket event).
- `"pi-core"` — update of pi core packages (`pi`, `pi-dashboard`, etc.) via `/api/pi-core/update`. Synchronous completion model (POST blocks until npm update finishes; final state is in the response body).

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

