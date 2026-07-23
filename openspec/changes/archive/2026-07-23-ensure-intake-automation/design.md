## Context

The `invoicebot-intake` drain automation is the thing that actually moves files
out of the drop folder into processing. Two consumers depend on its
`automation.yaml` existing:

1. **The drain** — needs the YAML present (and later enabled) to process the
   drop folder. Matters when files land: `upload`.
2. **The enable UI** — `POST /automation` flips `disabled` and `404`s if the YAML
   is absent; `GET /automation` must list the automation so a row is togglable.
   Matters when the automation panel renders: `query`, `GET /automation`.

The engine facade owns all `.pi/automation` scaffolding and the `disabled` flag.
The plugin must NOT duplicate the YAML write — it goes through the port.

```
ensureIntakeAutomation(cwd)  writes .pi/automation/invoicebot-intake/automation.yaml (disabled)
        │
        ├──▶ DRAIN        needs YAML present + enabled  → trigger: upload
        └──▶ ENABLE UI    POST flips `disabled` (404 if absent); GET lists it
                                                          → trigger: query / GET automation
```

## Decision — placement: "broad, not blind"

Assert the invariant *"for any cwd the plugin touches as a workspace, the intake
scaffold exists"* at the point `cwd` first becomes known (right after `badCwd`
passes), on **every workspace-touching handler**, and exclude only `GET /blob`.

| Route              | Ensure? | Rationale |
|--------------------|:------:|-----------|
| `POST /query`      | ✔ | UI's first touch — makes the toggle row exist before any upload |
| `POST /review`     | ✔ | Workspace-touching op |
| `POST /setup`      | ✔ | Workspace-touching op |
| `POST /rules`      | ✔ | Workspace-touching op |
| `POST /upload`     | ✔ | Files landing — the drain must exist to consume them |
| `POST /automation` | ✔ | Avoid `404`-on-flip of a not-yet-scaffolded YAML |
| `GET /automation`  | ✔ | List surfaces the disabled row so it can be enabled |
| `GET /blob`        | ✘ | Hot ranged read of an existing original; zero config semantics |

### Alternatives considered

- **Upload-only** — rejected: a user who opens the automation panel before their
  first upload sees no `invoicebot-intake` row, so cannot pre-enable it; the
  upload-only self-serve goal quietly fails.
- **Processing-relevant allowlist (upload/setup/review)** — rejected: an allowlist
  silently drifts. Add a new endpoint later, forget the ensure call, and the
  invariant develops an invisible gap. A single choke point expresses the
  invariant directly.
- **Literally every request (incl. blob)** — rejected: puts an idempotent-but-real
  `stat()` on the latency-sensitive byte-range streaming path for no semantic
  gain.

## Why it is safe on read-ish handlers

The engine call is idempotent, `existsSync`-guarded (every call after the first
is one `stat()`), and **non-fatal on FS error**. A `query` or `GET /automation`
handler cannot be broken by it, and the write is semantically just "this `cwd` is
now a known invoicebot workspace." The ensure runs after `badCwd(cwd)` passes and
before the handler's own dispatch/return, so it never changes a response shape.

## Binding split

- `RealInvoiceEngine.ensureAutomation(cwd)` → `facade.ensureIntakeAutomation(cwd)`
  (thin pass-through, same shape as `query/review/setup/rules/ingest`).
- `FakeInvoiceEngine.ensureAutomation(cwd)` → `async () => ({ automation: [] })`
  so the faux gate and engine-less CI/worktree runs stay green with no filesystem
  writes.
