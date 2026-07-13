## Context

Sessions spawned into the invoice workspace inherit the full default tool surface.
The workspace is the working directory where invoice flows run and where the
persistent "Ask" chat operates over the whole invoice DB. Two distinct spawn
paths land there:

- **Plugin spawn** — the invoice plugin's session-link spawns a per-invoice flow
  session via the host `spawnSession` hook (`packages/server/src/server.ts`),
  which calls `spawnPiSession` (`packages/server/src/process-manager.ts`).
- **Generic client spawn** — the front-end's "Ask" session is created through
  the ordinary client spawn path (`session-api` / `event-wiring`), which also
  calls `spawnPiSession`.

Both bottom out at `spawnPiSession`, which today builds the pi CLI argument list
from a `strategy` (and optional model) only.

The runtime facts that make this tractable:

- pi's CLI exposes `--no-builtin-tools` / `-nbt` — *"Disable built-in tools but
  keep extension/custom tools enabled."* Custom `ib_*` tools survive it, so no
  tool enumeration and no engine-side change are needed. It has no host
  prerequisites and behaves identically across host OSes.
- pi itself documents that in-process tool restriction is hardening, not a
  boundary; only an OS/VM/container boundary truly contains untrusted content.
  That boundary is deliberately **out of scope** for this change (see D3).

## Goals / Non-Goals

**Goals:**

- Remove the built-in filesystem/shell tools from every session spawned into a
  guarded working directory, so neither honest wandering nor prompt-injected
  instructions can read outside the working directory or edit `flow.yaml`.
- Cover both spawn paths with one policy, keyed on the working directory.
- Work identically on Windows, macOS, and Linux with no new dependency.
- Leave ordinary (non-workspace) dashboard sessions and their tools untouched.

**Non-Goals:**

- No change to the engine or to the invoice front-end.
- Not enumerating or curating the `ib_*` allowlist — built-in drop keeps custom
  tools automatically.
- **No OS-level isolation boundary** (VM/container) — out of scope as a
  separate, optional layer (see D3); it is NOT required for the cwd boundary,
  which is enforced in-process.
- Not wiring the inert `sandbox` spawn field — left untouched for that separate,
  optional OS-isolation work.
- Not restricting network egress (a property of the optional OS-isolation
  layer, out of scope).

## Decisions

### D1 — Disable built-in tools via `--no-builtin-tools`, not a tool allowlist

Use `--no-builtin-tools` rather than `--tools <ib_...>`. It keeps every
extension/custom tool without naming any, so the policy does not drift when the
`ib_*` surface changes and no cross-module tool list is duplicated. **Alternative
considered:** an explicit `--tools` allowlist owned by the plugin — rejected as
brittle and duplicative of engine-owned tool names.

### D2 — Guard by invoice-bot origin OR guarded cwd, applied inside `spawnPiSession`

Goal: **every** session the invoice bot spawns is guarded. Enforcement lives at
the single choke point all spawns share (`spawnPiSession`), which guards a
session when EITHER condition holds:
- **origin** — the spawn is invoice-bot-originated (the plugin marks its own
  spawns as guarded), so a plugin spawn is guarded even in an unregistered cwd;
- **cwd** — the spawn's working directory is one the invoice plugin registered as
  guarded (covers the client-spawned "Ask"/Kérdezz session, which goes through
  the generic path where the host cannot see plugin origin).

For a guarded session `spawnPiSession` injects `--no-builtin-tools` + the
tool-call cwd guard. The union of origin ∪ cwd guarantees the per-invoice main
sessions, the Kérdezz session, and any other invoice-bot spawn are all covered,
with no UI change. **Alternative considered:** cwd-only — rejected because a
plugin spawn into an unregistered cwd would slip through; origin closes that.
**Alternative considered:** require the front-end to opt the "Ask" session in —
rejected because it drags the UI into a security policy and leaves the generic
path as a bypass.

> Note: cwd is a legitimate basis for a *policy* decision here. The documented
> "never correlate by cwd" footgun concerns matching a spawn back to a specific
> session; applying a uniform restriction to all sessions in a directory has no
> such ambiguity.

### D3 — The cwd boundary is enforced in-process (tool removal + tool_call guard); OS isolation is NOT required for it

The working-directory boundary is delivered by two in-process, cross-platform
mechanisms — **no OS/VM/container boundary is needed to keep a session in its
cwd**:

1. **Remove the escape primitives** — `--no-builtin-tools` drops `bash`/exec and
   the general filesystem built-ins. This is the crucial step: pi calls
   in-process tool restriction *"hardening, not a boundary"* only because a
   `bash`/exec tool can spawn a subprocess that does raw syscalls an in-process
   hook never sees. With no such primitive, that bypass does not exist.
2. **Guard the remaining tool calls** — a `tool_call` hook rejects any remaining
   (extension/custom) tool call whose path argument resolves outside the cwd,
   before it executes. Since every filesystem access now flows through a tool
   call the hook inspects, the hook is an **authoritative** cwd boundary, not
   mere hardening. This reuses the same mechanism the engine already ships as an
   "agent guard" and mirrors the existing `file-read-containment` realpath +
   separator/drive-case normalization so it holds on Windows.

OS-level isolation (e.g. the Gondolin micro-VM, or a container backend) is
**out of scope** here not because it is deferred work the boundary depends on,
but because it addresses a *different* threat: channels that never pass through
a tool call — a native exploit of the pi process itself, or network exfil via a
legitimately networked tool. It is optional and additive. (It is also not
uniformly available: Gondolin has **no Windows support**, so any OS layer would
need a per-platform backend.) The inert `sandbox` field is left untouched for
that separate, optional work. **Alternative considered:** treat an OS boundary
as required for cwd-containment — rejected: once bash/exec are gone, the
tool_call guard already contains the filesystem in-process, cross-platform.

### D4 — `spawnPiSession` gains one explicit option

`spawnPiSession` accepts an option to disable built-in tools. The plugin spawn
hook and the generic path both leave the actual decision to the working-directory
check inside `spawnPiSession`, keeping the CLI-flag construction in one place.

### D5 — Why remove built-ins entirely: capability-by-constrained-tool

Dropping built-ins wholesale (rather than curating a `--tools` allowlist) is not
a blunt instrument; it reflects the intended agent contract: the agent acts
**only through dedicated, purpose-scoped tools**, never a general-purpose
shell/filesystem tool. Any job the agent legitimately needs is expressed as a
constrained tool with a typed contract. Writes are denied by default; a job that
must produce a file is performed by a dedicated subagent whose write is scoped to
a specific path and whose other write/bash side effects are denied by an agent
guard. Because every needed capability already lives in that tool surface, the
correct enforcement at the session boundary is to remove the built-in surface
outright — an allowlist would only reintroduce an unconstrained escape path for
no functional gain. **Alternative considered:** retain a scoped built-in such as
`read` — rejected: deterministic reads (document parsing, DB access) run in
engine code within flow nodes, not via an agent tool, so a retained built-in
buys nothing and widens the surface.

## Risks / Trade-offs

- **The in-process guard is authoritative only once bash/exec are removed** →
  the cwd boundary holds in-process because no subprocess-spawning primitive
  remains to bypass the `tool_call` guard (see D3). The only residual — needing
  an OS boundary — is non-tool channels (a native exploit of the pi process,
  network exfil via a legitimately networked tool), a separate, optional concern.
  Mitigation: keep the built-in surface empty so the guard stays authoritative.
- **Over-broad guarding** → marking a directory guarded restricts *every*
  session there, including one a developer opens manually. Mitigation: only the
  plugin-owned workspace directory is registered; ordinary directories are never
  guarded.
- **A workspace tool legitimately needing a built-in** → if any flow step relied
  on a built-in tool at the model layer (evidence indicates none do — flows do
  filesystem work in engine code, not via model tools), it would break.
  Mitigation: verify no model-layer built-in tool use before enabling.

## Migration Plan

1. Add the guarded-directory registry + `spawnPiSession` option handling behind
   the working-directory check.
2. Register the plugin workspace as guarded; confirm both the per-invoice and
   "Ask" sessions spawn with built-in tools disabled on each target OS.
3. Rollback: unregister the guarded directory (restores prior full-tool
   behaviour) — no schema or data migration involved.

## Open Questions

- Confirm the exact working directory the plugin passes for per-invoice vs. "Ask"
  sessions (same workspace root, or per-invoice subdirectories?) — decides the
  granularity of the guarded-directory registry.
- Does `flows.editFlow: false` (already present in the workspace settings)
  overlap with the `flow.yaml`-edit protection here, and should the two be
  reconciled or documented as independent layers?
