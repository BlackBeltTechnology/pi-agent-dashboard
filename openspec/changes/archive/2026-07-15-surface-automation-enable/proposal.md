## Why

Invoice auto-processing silently never runs after install. The schedule
automations that fire the processing flows on a cadence are scaffolded with
`disabled: true` ("enable deliberately — no runaway") and nothing ever flips
them back — no REST route, no tool, touches the `disabled` field. The finance
operator has no surfaced way to turn automation on.

## What Changes

- Add a self-contained operator toggle to the invoicebot-plugin that flips the
  `disabled` field on a named invoicebot automation's on-disk `automation.yaml`.
- New route `POST /api/plugins/invoicebot/automation { cwd, name, enabled }` —
  a single-target, in-place flip. Reads the existing YAML, changes **only** the
  `disabled` field (surgical edit, preserves comments/formatting), re-validates,
  writes. The client never supplies a config. Rejects if the named automation
  does not exist (never creates on enable).
- New route `GET /api/plugins/invoicebot/automation?cwd` — discovery: returns
  `{ automations: [{ name, enabled }] }` for the workspace so the consuming UI
  renders one switch and enumerates targets without hard-coding automation
  names (`invoicebot-intake` / `invoicebot-pull`) client-side.
- No config-overwrite footgun: the flip is structurally a strict subset of a
  full config write, so it adds zero net attack surface. Auth is inherited from
  the dashboard's global `onRequest` gate like every `/api/plugins/*` route.

## Capabilities

### New Capabilities
- `invoicebot-automation-toggle`: REST surface to enable/disable invoicebot
  schedule automations in place — the single-target flip route, the discovery
  list route, in-place `disabled`-only mutation with re-validation, reject on
  missing/unknown automation, and the resulting-state response contract.

### Modified Capabilities
<!-- none: no existing archived capability's requirements change -->

## Impact

- **Code**: `packages/invoicebot-plugin/src/server/` — new route handlers +
  a YAML flip helper (direct filesystem read/write). First invoicebot route
  that does a direct FS write rather than wrapping the engine port, because no
  `ib_*` tool touches `disabled` (the engine `cadence` action only rewrites the
  `cron:` line).
- **No change to the automation-plugin.** Its `fs.watch` re-scans + re-arms the
  scheduler on any `automation.yaml` write within the ~300ms debounce window,
  regardless of which plugin wrote the file — a `disabled` flip takes effect
  live without a reload.
- **Consumer (out of scope here)**: a front-end toggle consumes these two
  routes; that lands as its own standalone change.
- **Known limitation (documented, not fixed here)**: a second, independent gate
  (`intake_paused`, engine soft-loop STOP) can still swallow processing even
  after automation is enabled. This route flips only the schedule gate; the two
  switches can contradict. Reconciling them is deferred to an optional engine
  cleanup — out of scope for this dashboard change.

## Discipline Skills

- `security-hardening`: route accepts client-supplied `cwd` + `name` and writes
  a file under them — path-traversal / name-escape validation and in-place-only
  mutation are the security surface.
- `observability-instrumentation`: a new endpoint whose effect (scheduler
  arm/disarm) happens asynchronously in another module — the response must make
  the resulting per-automation state plainly visible.
