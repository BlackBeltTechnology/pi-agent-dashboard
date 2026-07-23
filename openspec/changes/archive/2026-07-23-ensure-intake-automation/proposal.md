## Why

Uploaded invoices land in the drop folder via `engine.ingest(cwd, files)` even
when the workspace has **no inbound connector**. But the drop-folder **drain**
automation (`invoicebot-intake`, which runs the intake processing flow) was only
ever scaffolded as a side effect of connector setup. So an upload-only workspace
has nothing to drain the folder — and cannot even enable one, because
`POST /api/plugins/invoicebot/automation` (which flips only the `disabled` flag)
returns `404` when the `automation.yaml` does not exist yet.

The engine facade now exposes `ensureIntakeAutomation(cwd)` — idempotent, writes
ONLY the `invoicebot-intake` drain automation, **disabled**, non-fatal on FS
error, no flow, no events. The plugin must call it so that for any workspace the
plugin touches, the intake scaffold exists and is togglable. The engine
deliberately leaves the *who/when calls it* decision to the consumer; this change
makes that decision and wires the seam.

## What Changes

- Grow the `InvoiceEngine` port with one method:
  `ensureAutomation(cwd): Promise<{ automation: string[] }>`.
- Implement it in both bindings:
  - `RealInvoiceEngine` → delegates to the facade's `ensureIntakeAutomation(cwd)`.
  - `FakeInvoiceEngine` → `async () => ({ automation: [] })` (no-op; keeps the
    faux gate and any engine-less CI/worktree green).
- Call `engine.ensureAutomation(body.cwd)` from the routes layer **before
  dispatch**, at every workspace-touching handler — `query`, `review`, `setup`,
  `rules`, `POST /automation`, `GET /automation`, and `upload` — using the
  request `cwd` after `badCwd` passes. It is idempotent + `existsSync`-guarded,
  so calling it on first touch of a `cwd` is cheap and safe ("broad, not blind").
- **Exclude `GET /blob`**: a latency-sensitive ranged read of an already-retained
  original, with no workspace-configuration semantics — a scaffold write there is
  pure noise and would sit on every byte-range request.

## Discipline Skills

- `doubt-driven-review` — the choke-point placement is a cross-boundary decision
  (a filesystem write behind read-ish handlers like `query`/`GET automation`);
  confirm the invariant before it stands.

## Capabilities

### New Capabilities
- `invoicebot-intake-ensure`: the plugin ensures the disabled `invoicebot-intake`
  drain automation exists — via a new `ensureAutomation` port method — on first
  touch of any workspace `cwd`, across every workspace-touching route and
  excluding the blob stream.

### Modified Capabilities
<!-- None: purely additive. No existing route response or spec behavior changes;
     the ensure call is idempotent and does not alter any handler's return. -->
