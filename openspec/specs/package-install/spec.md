## Purpose

Install, remove, and update pi packages (extensions, skills, themes, prompts) via REST + WebSocket. Surfaces a single-flight server contract with an FIFO client-side queue so multiple rapid clicks survive without orphaned spinners.
## Requirements
### Requirement: Server installs pi packages via PackageManager
The server SHALL expose `POST /api/packages/install` accepting `{ source, scope, cwd? }`. It SHALL use pi's `DefaultPackageManager` to install the package. For `scope: "global"` it installs to `~/.pi/agent/settings.json`. For `scope: "local"` it installs to `<cwd>/.pi/settings.json`. The endpoint SHALL return immediately with an `operationId` and stream progress via WebSocket.

#### Scenario: Install npm package globally
- **WHEN** client sends `POST /api/packages/install` with `{ source: "npm:pi-doom", scope: "global" }`
- **THEN** server calls `packageManager.installAndPersist("npm:pi-doom")` and returns `{ operationId }` with status 202

#### Scenario: Install npm package locally
- **WHEN** client sends `POST /api/packages/install` with `{ source: "npm:pi-tools", scope: "local", cwd: "/path/to/project" }`
- **THEN** server calls `packageManager.installAndPersist("npm:pi-tools", { local: true })` scoped to the given cwd

#### Scenario: Install git package
- **WHEN** client sends `POST /api/packages/install` with `{ source: "git:github.com/user/repo", scope: "global" }`
- **THEN** server installs via git clone and persists to settings

#### Scenario: Concurrent install rejected
- **WHEN** an install/remove/update operation is already running
- **THEN** server returns 409 Conflict

### Requirement: Server serializes package operations
The server SHALL allow only one package operation (install, remove, or update) at a time. Concurrent requests SHALL receive a 409 Conflict response.

#### Scenario: Second operation during active operation
- **WHEN** an install is in progress and another install request arrives
- **THEN** the second request receives 409 with message "A package operation is already in progress"

### Requirement: Package card reflects install state immediately
After a package install, remove, or update operation completes successfully, ALL instances of the installed packages list SHALL refresh automatically. The `useInstalledPackages` hook SHALL listen for `pi-package-event` DOM events and re-fetch the installed packages list when any operation completes with `success: true`.

#### Scenario: Install from browse updates card to installed state
- **WHEN** a package is installed via the Browse Packages section
- **THEN** the PackageCard for that package immediately shows "Installed" status
- **AND** no manual page refresh is required

#### Scenario: Uninstall updates card to uninstalled state
- **WHEN** a package is uninstalled from the Installed Packages section
- **THEN** the PackageCard in Browse Packages immediately shows the Install button
- **AND** no manual page refresh is required

#### Scenario: Cross-component state sync
- **WHEN** an install operation is triggered by one component (e.g., GlobalPackagesSection)
- **THEN** other components using `useInstalledPackages` (e.g., PackageBrowser) also update

### Requirement: Client queues package operations FIFO

The dashboard client SHALL maintain a single FIFO queue of package operations (install, remove, update) shared across all components. At most one operation SHALL be in-flight to the server at any time. Subsequent enqueued operations SHALL be POSTed to `/api/packages/install|remove|update` only after the previous operation's `package_operation_complete` WebSocket message arrives.

#### Scenario: Spinner survives a second click during an active install

- **WHEN** the user clicks Install on package A and, before A completes, clicks Install on package B
- **THEN** package A's row continues to show its spinner until A's `package_operation_complete` arrives
- **AND** package B's row shows a "queued" indicator until A completes, then transitions to spinner

#### Scenario: FIFO order across components

- **WHEN** the user clicks Install on A in the Recommended Extensions panel and then on B in the Packages tab before A completes
- **THEN** A is POSTed first, A completes, then B is POSTed — regardless of which component initiated each click

#### Scenario: Completion advances the queue

- **WHEN** the running operation's `package_operation_complete` WebSocket message arrives (either `success: true` or `success: false`)
- **THEN** the next queued operation is shifted from the queue and POSTed within one event-loop tick

#### Scenario: Idle queue accepts immediately

- **WHEN** the user clicks Install on a package with no operations running or queued
- **THEN** the operation is POSTed immediately without entering the queued state visibly

### Requirement: Per-source state is shared across components

The client SHALL expose per-source operation state (`idle | queued | running | success | error`) from a single source of truth. Multiple mounted components SHALL observe the same state for the same `source` string.

#### Scenario: Recommended panel reflects an op started in Packages tab

- **WHEN** an install for `npm:pi-flows` is started from the Packages tab
- **THEN** the matching card in the Recommended Extensions panel (if mounted) shows the same spinner and status text

#### Scenario: Component unmount does not orphan an op

- **WHEN** the component that initiated an install unmounts before completion
- **THEN** the operation continues to run on the server
- **AND** completion advances the shared queue and refreshes installed-packages lists

### Requirement: Duplicate enqueue is a no-op

When a `source` is already in the `queued` or `running` state, a subsequent enqueue request for the same `source` SHALL be ignored. The status pill SHALL remain on its current value.

#### Scenario: Double-click on Install button

- **WHEN** the user clicks Install on a package twice in rapid succession
- **THEN** exactly one operation is POSTed for that package

#### Scenario: Install all overlapping with manual click

- **WHEN** the user has clicked Install on package A, then clicks "Install all missing" which would also enqueue A
- **THEN** A is enqueued exactly once and runs exactly once

### Requirement: Queue retries once on 409 PackageOperationBusy

When the server returns HTTP 409 (`PackageOperationBusyError`) for an operation POSTed by the queue, the client SHALL re-queue the request at the head of the queue and retry once after at least 500 ms. A second 409 SHALL surface as an `error` state for that source.

#### Scenario: Transient 409 retried successfully

- **WHEN** the queue POSTs operation A and the server returns 409 because an unrelated subsystem briefly held the lock
- **AND** the lock is released within 500 ms
- **THEN** the queue retries A and A succeeds normally without user intervention

#### Scenario: Persistent 409 surfaces as error

- **WHEN** two consecutive POSTs for the same operation both return 409
- **THEN** the source enters `error` state with the server's error message
- **AND** the queue advances to the next item

### Requirement: Recommended Extensions exposes Install-all-missing action

The Recommended Extensions panel SHALL show an "Install all missing" button in its header. When clicked, the button SHALL enqueue every recommended entry where `activeInPi === false`, in manifest order, using each entry's `installed.scope` if present, otherwise the panel's current scope. The button SHALL be disabled when no missing entries exist or when every missing entry is already queued or running.

#### Scenario: Button enqueues all missing entries

- **WHEN** the recommended manifest contains 3 entries, 2 of which have `activeInPi === false`
- **AND** the user clicks "Install all missing"
- **THEN** the 2 missing entries are enqueued in manifest order
- **AND** the entry that is already active is not enqueued

#### Scenario: Button respects per-entry installed scope

- **WHEN** "Install all missing" enqueues an entry whose `installed.scope === "global"`
- **THEN** that entry's POST uses `scope: "global"` regardless of the panel's current scope toggle

#### Scenario: Button disabled when nothing to do

- **WHEN** every recommended entry has `activeInPi === true`
- **THEN** the "Install all missing" button is disabled
- **AND** its tooltip indicates nothing to install

#### Scenario: Button disabled while batch in flight

- **WHEN** "Install all missing" has just been clicked and all missing entries are now in `queued` or `running` state
- **THEN** the button is disabled
- **AND** becomes enabled again only if a new missing entry appears (e.g., via a `package_operation_complete` that uninstalls one)

### Requirement: PackageBrowser banner reports queue depth

The PackageBrowser status banner SHALL display the currently running operation's source plus the number of queued operations when the queue is non-empty.

#### Scenario: Single in-flight operation, empty queue

- **WHEN** one install is running and zero are queued
- **THEN** the banner reads "Installing &lt;source&gt;…" with no queue suffix

#### Scenario: Operation running with queued items

- **WHEN** one install is running and 2 are queued
- **THEN** the banner reads "Installing &lt;source&gt;… (2 queued)"

#### Scenario: Banner clears when queue empties

- **WHEN** the last running operation completes successfully and the queue is empty
- **THEN** the banner shows the existing 3-second success state, then hides — matching today's behavior

### Requirement: Queue matches completion regardless of POST/WS arrival order

The client queue SHALL correctly match a `package_operation_complete` WebSocket message to its in-flight operation regardless of whether the message arrives before or after the corresponding HTTP POST response has resolved. When `running.operationId` is `null` (HTTP response not yet parsed), the queue SHALL match by `source` instead. When `running.operationId` is set, the queue SHALL continue to match by `operationId`.

This requirement closes a race window: for fast operations (notably local-path installs that have no network round-trip), the server's WebSocket broadcast can arrive before `fetch()` resolves the HTTP response body. Strict `operationId` matching during that window silently discards legitimate completions, leaving the spinner stuck and the queue blocked.

The same matching rule SHALL apply to `package_progress` messages so progress updates during the same window are not lost.

#### Scenario: Completion arrives before HTTP response (fast install)

- **WHEN** the queue starts an install operation by POSTing to `/api/packages/install`
- **AND** the server broadcasts `package_operation_complete` with the issued `operationId` BEFORE the client's `fetch()` resolves the response body
- **THEN** the queue matches the completion by `source` (since `running.operationId` is still `null`)
- **AND** the running op transitions to `success` (or `error` per the message payload)
- **AND** the spinner clears within one render tick

#### Scenario: Completion arrives after HTTP response (normal install)

- **WHEN** the queue starts an install operation
- **AND** the HTTP response resolves first, setting `running.operationId` to the issued id
- **AND** the server later broadcasts `package_operation_complete` with that same id
- **THEN** the queue matches by `operationId` and completes normally

#### Scenario: Progress event during race window updates running message

- **WHEN** the queue is mid-POST for an operation whose `running.operationId` is still `null`
- **AND** a `package_progress` message for that operation arrives via WebSocket
- **THEN** the queue updates `running.message` based on the progress event using `source` to match
- **AND** later progress messages (after `operationId` is set) match by `operationId` as before

#### Scenario: Local-path install does not orphan its spinner

- **WHEN** the user clicks Install on a local-path source (e.g. `/home/user/my-extension`)
- **AND** the install completes server-side in milliseconds, faster than the HTTP response round-trip
- **THEN** the spinner clears on completion and does not remain in the `running` state indefinitely
- **AND** subsequent enqueues for any other source proceed normally

#### Scenario: Mismatched completion is still ignored

- **WHEN** a `package_operation_complete` arrives whose `operationId` does not match `running.operationId` AND whose `source` does not match `running.source`
- **THEN** the queue ignores the message and the running op is unaffected

### Requirement: Install confirmation dialog supports scope selection
The `PackageInstallConfirmDialog` SHALL accept the following props in addition to its existing props:

- `scope: "global" | "local"` — currently selected scope (controlled by caller).
- `onScopeChange?: (scope: "global" | "local") => void` — change handler; required when `lockScope` is undefined.
- `lockScope?: "global" | "local"` — when set, the dialog SHALL hide the scope radio and use the locked scope unconditionally.

When `lockScope` is undefined AND `onScopeChange` is provided, the dialog SHALL render a `Local | Global` radio group above the confirm button. Both options SHALL be selectable; the dialog SHALL NOT preflight whether the source is installable in either scope.

When `lockScope` is set OR when `onScopeChange` is not provided, the dialog SHALL NOT render the radio. The dialog SHALL pass the locked-or-static scope to the install action verbatim.

The default selection follows the caller's `scope` prop value.

#### Scenario: Settings caller locks scope to global
- **GIVEN** the dialog is opened from `SettingsPanel` with `lockScope="global"`
- **THEN** the scope radio SHALL NOT be visible
- **AND** confirming SHALL pass `scope: "global"` to the install action

#### Scenario: Pi Resources caller offers radio
- **GIVEN** the dialog is opened from `PiResourcesView` with `onScopeChange` provided and no `lockScope`
- **THEN** the scope radio SHALL be visible with both Local and Global options
- **AND** the default selection SHALL be the value of the `scope` prop
- **AND** the user SHALL be able to switch the selection before confirming

#### Scenario: Confirming with selected scope
- **WHEN** the user picks `Global` and confirms
- **THEN** the install action SHALL receive `scope: "global"` and `cwd: undefined`

- **WHEN** the user picks `Local` and confirms
- **THEN** the install action SHALL receive `scope: "local"` and `cwd: <current cwd>`

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

