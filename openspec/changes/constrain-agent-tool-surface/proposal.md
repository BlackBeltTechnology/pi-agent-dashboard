## Why

Sessions spawned for the invoice workspace — the persistent "Ask" chat over the
whole invoice DB and every per-invoice flow session — currently inherit the full
default tool surface (`read`, `bash`, `edit`, `write`, `grep`, `find`, …). Nothing
stops the model from reading files outside its working directory, editing the
`flow.yaml` that defines its own behaviour, or being steered by injected
instructions inside untrusted invoice content into touching either. Because
invoices are external, untrusted input, this is a real prompt-injection surface,
not just an accidental-wandering risk.

## What Changes

- Spawned invoice-workspace sessions run with **built-in tools disabled** and
  only the workspace's own extension/custom tools (the `ib_*` surface) available.
  A model with no `bash`/`read`/`write`/`edit` has no instrument to leave its
  working directory or edit `flow.yaml`, and prompt injection cannot escalate
  past the tool surface actually granted.
- The restriction applies to **both** spawn paths — plugin-spawned per-invoice
  flow sessions and the client-spawned persistent "Ask" session — by keying the
  policy on the session's working directory rather than on which code path
  spawned it.
- A `tool_call` **guard** contains the remaining (extension/custom) tools: any
  tool call whose path argument resolves outside the working directory is
  rejected before it runs. With `bash`/exec gone, every filesystem access flows
  through a guarded tool call, so this guard is an **authoritative** cwd boundary
  in-process — no OS/VM/container needed to keep a session inside its cwd.
- Enforcement is a pi CLI flag (`--no-builtin-tools`) plus the guard, both
  injected at spawn. They have **no host prerequisites and behave identically on
  Windows, macOS, and Linux** — the guarantee holds on every host OS.
- Non-workspace sessions (ordinary dashboard sessions) are unaffected — the
  default tool surface is unchanged outside the guarded working directories.

### Out of scope (a different threat, optional)

- **OS-level isolation** (Gondolin micro-VM / container backend) is **not**
  needed for the cwd boundary — that is fully enforced in-process by tool
  removal + the `tool_call` guard above. OS isolation addresses a *different*
  threat: channels that never pass through a tool call (a native exploit of the
  pi process itself, or network exfil via a legitimately networked tool). It is
  optional and additive. It is also not uniformly available — **Gondolin has no
  Windows support** (upstream: *"supported on macOS and Linux"*), so any OS layer
  would need a per-platform backend (container/Docker on Windows). The inert
  `sandbox` spawn field is left untouched for that separate, optional work.

## Capabilities

### New Capabilities
- `spawned-session-tool-sandbox`: the policy and enforcement for disabling
  built-in tools on sessions spawned into a guarded working directory, applied
  uniformly across every spawn path and keyed on the working directory.

### Modified Capabilities
<!-- No spec-level requirement changes to existing capabilities; the underlying
     spawn plumbing (process-manager / plugin spawn hook) is implementation of
     the new capability's requirements and is detailed in design.md. -->

## Impact

- **Host spawn plumbing** — `packages/server/src/process-manager.ts`
  (`spawnPiSession`) gains options to disable built-in tools (`--no-builtin-tools`)
  and to load the `tool_call` cwd-containment guard extension (`-e`) for guarded
  directories.
- **cwd-containment guard** — a `tool_call` guard extension that rejects any
  remaining tool call whose path argument resolves outside the working
  directory, reusing the `file-read-containment` realpath + separator/drive-case
  normalization so it holds on Windows.
- **Plugin spawn hook** — `packages/server/src/server.ts` `spawnSession` hook and
  `PluginSpawnOptions` (`packages/dashboard-plugin-runtime`) carry the
  restriction for plugin-spawned sessions.
- **Generic spawn path** — the client-initiated spawn (`session-api` /
  `event-wiring`) that backs the "Ask" session applies the same policy by
  working directory, with no UI-side change required.
- **Guarded-workspace registry** — the invoicebot plugin registers its
  workspace working directory(ies) as guarded so the host can apply the policy
  regardless of spawn origin.
- No change to the invoice front-end.
- No new runtime dependency — the flag and the guard are in-process and
  cross-platform; no container or VM is required for the cwd boundary.
