## Why

The dashboard server crashes immediately when a top-level third-party dependency fails to resolve at module-load time. Real-world failures observed in `~/.pi/dashboard/server.log`:

- `Cannot find module 'fastify'`
- `Cannot find module '.../toad-cache/dist/toad-cache.cjs'` (fastify transitive dep)
- `Cannot find module '.../readable-stream/.../process/index.jsx'`
- `Cannot find module '@blackbelt-technology/pi-dashboard-shared/src/platform/exec.ts'`

These all happen during the static `import` chain `cli.ts → server.ts → fastify/…` *before any user code runs*. The existing `installCrashSafetyNet()` `uncaughtException` / `unhandledRejection` handlers can't catch them — the catch handlers themselves are inside modules that never finished loading.

The user-facing failure is severe: `http://localhost:8000` returns `ERR_CONNECTION_REFUSED`. The user has no in-band signal of what went wrong, and the bridge auto-start retries thrash because they keep hitting the same import-time crash.

The plugin loader is already failure-isolated (per `add-plugin-activation-ui`); this change extends the same "degrade, don't crash" principle to the **server-process-level** boundary above plugins.

## What Changes

**NEW** `packages/server/src/recovery-server.ts` — pure `node:http` HTTP server, **zero third-party imports**. The strict-builtins constraint is non-negotiable: this module exists precisely to handle the case where third-party imports are broken.

Exports:

- `parseModuleNotFoundError(err): string | null` — pure helper; extracts the missing-module identifier (bare name or absolute path) from `ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND` / `Cannot find module|package 'X'` shapes.
- `isModuleNotFoundError(err): boolean` — predicate gating recovery entry.
- `detectInstallLayout(scriptPath?): "electron" | "npm-global" | "monorepo" | "unknown"` — pure classifier over `process.argv[1]`.
- `suggestedReinstallCommand(layout)` — pure mapping to the right reinstall command per layout.
- `buildRecoveryHtml(info)` — pure HTML renderer (inline CSS + JS, no React).
- `startRecoveryServer(info)` — binds `info.port` via `http.createServer`, serves:
  - `GET /` → recovery HTML (status, suggested fix, retry/reinstall buttons)
  - `GET /api/health` → `{ ok: false, mode: "recovery", missingModule, error, suggestedFix, layout }`
  - `POST /api/recovery/retry` → respawn `cli.ts` detached + `process.exit(0)`
  - `POST /api/recovery/reinstall` → run `npm install [-g …]`, stream stdout/stderr to console + return last 30 lines in response
  - Fallthrough → recovery HTML (so SPA-style URLs don't 404)

Side effects:
- Writes `~/.pi/dashboard/last-recovery.json` snapshot (timestamp, port, missingModule, error message, stack, layout, scriptPath) for diagnostics tooling.
- On `EADDRINUSE` at recovery-bind time, the server logs and exits with code `2` (don't loop indefinitely if something else holds the port).

**MODIFY** `packages/server/src/cli.ts`

- The static `import { createServer, type ServerConfig } from "./server.js"` is replaced with a **type-only** import: `import type { createServer as _CreateServerType, ServerConfig } from "./server.js"`. Type-only imports are fully erased at runtime by tsc/jiti, so they cannot trigger module-resolution.
- Inside `runForeground(config)`, the runtime `createServer` is loaded via dynamic `import("./server.js")` inside a try/catch. On `isModuleNotFoundError(err)`, the function calls `startRecoveryServer({ port, error, missingModule })` and returns a never-resolving Promise so the event loop stays alive.
- All other errors propagate as before (no behavioural change to non-recovery startup paths).

**NEW** `packages/server/src/__tests__/recovery-server.test.ts` — 19 tests covering:

- Module-name extraction (bare, absolute path, `Cannot find package` variant, legacy `MODULE_NOT_FOUND`, null/undefined safety).
- `isModuleNotFoundError` recognition + rejection of unrelated errors.
- Install-layout detection (npm-global, monorepo, unknown).
- Suggested-reinstall-command mapping per layout.
- `buildRecoveryHtml` XSS-escape contract (script tags and attribute injection both escaped).
- Live integration: `GET /`, `GET /api/health`, fallthrough route — all bound to an ephemeral port.

**Out of scope**
- Shared-package (`@blackbelt-technology/pi-dashboard-shared/*`) resolution failures *that occur in `cli.ts` top-level imports themselves*. Those would need a separate shim above `cli.ts`. In practice these are far less likely because shared modules are first-party and ship with the dashboard install.
- Frontend "recovery banner" in the React app — the recovery page is a dedicated standalone HTML, the React app never loads in recovery mode.
- Electron wizard-specific recovery (the wizard has its own fallback paths).
- Recovery for partial failures *after* the server has started (already handled by the plugin loader + crash-safety net).

## Impact

- **Happy path**: one extra dynamic `import()` call in `runForeground`. Cost is negligible (JIT-cached after first call).
- **Failure path**: `http://localhost:8000` now serves a status page instead of refusing connections. User can self-recover via the Reinstall button or be guided by the suggested command.
- **Diagnostics**: `~/.pi/dashboard/last-recovery.json` gives tooling and bug-report flows a structured snapshot of the failure.
- **Logs**: Clear banner `══ Pi Dashboard — entering RECOVERY MODE ══` makes log-grep trivial.
