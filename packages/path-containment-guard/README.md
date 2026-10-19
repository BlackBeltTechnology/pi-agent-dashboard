# @blackbelt-technology/pi-path-containment-guard

Opt-in, **fail-closed** pi extension for unattended sessions (for example plugin-spawned ones). It rejects:

- any `read` / `write` / `edit` / `grep` / `find` / `ls` call whose path resolves **outside** the configured `allowedRoots`;
- any tool listed in `deniedTools`.

It never prompts. A rejected call gets a coded tool error (`path_outside_roots: read /w/other/x — allowed roots: /w/repo`), so the model can correct itself.

It is **not** a sandbox: it is an argument-level control over pi's six path tools. See [Trust boundary](#trust-boundary).

## Loading

Load it explicitly — through pi's `-e <path>` flag or a plugin spawn's `scope.extensions`:

```ts
import { withPathContainmentGuard } from "@blackbelt-technology/pi-path-containment-guard";

ctx.spawnSession({
  cwd,
  scope: withPathContainmentGuard(
    { allowedRoots: [cwd], deniedTools: ["bash", "powershell"] },
    baseScope, // optional: your own scope — extensions/extensionConfig are merged, never lost
  ),
});
```

The helper returns a new scope (the base is never mutated) with the guard's entry file appended to `extensions` and its config added under `extensionConfig["path-containment-guard"]`. It throws when no `allowedRoots` entry is a usable absolute path, when a `deniedTools` entry is not a non-empty string, or when the base scope already has a guard entry. Importing it loads neither pi nor the extension.

**There is deliberately no `pi.extensions` entry in `package.json`.** A `pi install` of this package would otherwise load the guard in every session; with no config it fails closed and would block every path tool everywhere.

## Configuration (env contract)

The guard reads its config **once, at load**, from the `extensionConfig` env projection:

| Variable | Value |
|---|---|
| `PI_EXT_PATH_CONTAINMENT_GUARD_ALLOWED_ROOTS` | JSON array of absolute directory paths |
| `PI_EXT_PATH_CONTAINMENT_GUARD_DENIED_TOOLS` | JSON array of tool names (exact, case-sensitive match) |

The dashboard's spawn env never inherits `PI_EXT_PATH_CONTAINMENT_GUARD_*` from the host: only the spawn's own `extensionConfig` can set it.

### Fail-closed table

| Situation | Result |
|---|---|
| `ALLOWED_ROOTS` absent / not JSON / not an array / no valid entry | every path tool → `config_invalid` (other tools unaffected) |
| a single bad root entry (relative, empty, NUL, driveless on Windows, canonicalisation fails e.g. symlink loop) | ignored — fewer roots only ever rejects more |
| `DENIED_TOOLS` present but not JSON / not an array / has a non-string or empty entry | **every** tool → `config_invalid` (a dropped entry could lose an intended denial) |
| `DENIED_TOOLS` absent or `[]` | denies nothing |
| anything throws while the extension loads | the guard still registers; every call → `config_invalid` |
| anything throws while deciding a call (including a symlink chain longer than 40 hops, or a filesystem error such as `EACCES`) | `error` |

## Reason codes

Every block reason starts with one machine code: `tool_denied`, `path_outside_roots`, `invalid_path`, `config_invalid`, `error`. Each rejection also writes one log line to stderr with control characters (including U+2028/U+2029) escaped.

## What is checked

The target is resolved exactly as pi's own tools do (`~`, a leading `@`, Unicode spaces, `file://`, Windows shell paths, resolution against the session cwd, and for `read` the filename-variant fallback), then canonicalised — real paths for existing components, **dangling symlinks followed** to their target, link text resolved from the link's real parent. Containment is component-wise (never a string prefix); case is folded only when the volume folds case. `grep`/`find`/`ls` with no path check the session cwd.

Keep `allowedRoots` **inside the session cwd** to avoid interactive path-gate prompts: a target outside the cwd but inside `allowedRoots` passes the guard and may still prompt in the dashboard's own gate (the two are independent; a call runs only if neither blocks it).

## Trust boundary

- **Shell and code-executing tools are not path-checked.** `bash`, `powershell`, MCP tools and extension tools are only rejected by name. List every such tool in `deniedTools` — `bash`, `powershell`, `ctx_execute`-style sandboxes, subagent/spawn tools, `codemode` — and spawn with `scope.noMcp: true`. Neither `scope.tools` nor `--tools` confines nested `ctx.executeTool` calls or MCP tools; `deniedTools` does catch nested calls by name.
- **Co-loaded extensions** run with the process's full authority. The guard decides on the arguments its handler receives; an extension that rewrites a tool's arguments afterwards (for example image-fit swapping a path for a resized temp copy when it is listed before the guard) is outside this capability.
- **Respawn, don't `/reload`.** A module that fails to import on a session reload (syntax error, missing dependency) is dropped by pi before the guard's total factory can run, leaving the session unguarded. Plugins should respawn guarded sessions.

## Assumptions

- **No symlink following below a search root.** `grep`/`find` (rg/fd defaults) do not follow symlinks; the guard decides only on the search root. A pi version that followed them would need a deeper check.
- **TOCTOU.** A path canonicalised at check time can be swapped for a symlink before the tool opens it — the same limitation as the interactive path gate.
- **Roots are canonicalised once at load.** A root replaced by a symlink afterwards keeps its old canonical form, so targets through the new symlink are rejected (fails closed).
- **Windows `\\?\` readlink** text is not normalised: it canonicalises to a path no root contains, so it fails closed.

## Install footprint

The guard depends on `@blackbelt-technology/pi-dashboard-shared` (heavier than a standalone package) in exchange for a single, shared copy of the path resolver used by the dashboard's interactive path gate.
