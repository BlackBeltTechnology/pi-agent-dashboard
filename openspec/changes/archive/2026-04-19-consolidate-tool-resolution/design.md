## Context

The dashboard resolves eight distinct external dependencies (`pi`, `pi-coding-agent` module, `openspec`, `npm`, `node`, `tsx`, `git`, `zrok`, plus optional editors) across four packages. Each consumer uses one of three approaches:

1. **Direct `ToolResolver.which()`** (electron `dependency-detector`, server `editor-detection`) — returns an absolute path, no diagnostics.
2. **Platform Recipes** (`platform/npm.ts`, `platform/openspec.ts`, `platform/git.ts`) — runner internally calls `ToolResolver.which()` with a `resolverCache` Map keyed by binary name.
3. **Ad-hoc multi-strategy loaders** (`loadPiPackageManager()` in server *and* electron) — custom try/catch chains that silently swallow failures.

A Windows user with pi installed at `B:\Dev\Nodejs\global\node_modules\@mariozechner\pi-coding-agent\` and two `npm.cmd` entries on PATH reported `"pi-coding-agent is not installed"` — the server's `loadPiPackageManager()` swallowed three separate failures with no log, no UI signal, and no override path. Manual reproduction (see explore session) confirmed every individual step works standalone; the aggregate fails only inside the live server environment.

Existing infrastructure we can lean on:

- `ToolResolver` already encodes the lookup algorithm (managed → extraBinDirs → PATH → login-shell).
- `spec-driven/command-executor` already mandates that all `child_process` calls go through `platform/exec.ts` + `runner.ts`.
- `SettingsPanel` already has a tab architecture and REST-backed config read/write (`config-api.ts`).
- `doctor.ts` already does a manual diagnostic sweep, display-only, Electron-tray-only.

The core missing pieces are: a stateful registry, a diagnostic record, an override layer, and a UI surface.

## Goals / Non-Goals

**Goals:**

- One service owns every tool-resolution decision in the dashboard.
- Every resolution emits a structured diagnostic trail (strategies attempted, outcomes, winner) observable via REST.
- Users can override any tool's path from Settings without editing env vars or PATH.
- `loadPiPackageManager()` duplication collapses into one registered tool.
- `ToolResolver` stays untouched as the low-level PATH-search primitive.
- Migration is incremental — consumers can move to the registry file-by-file without big-bang risk.

**Non-Goals:**

- Not rewriting `ToolResolver`, `runner.ts`, or the Recipe API. Those are working primitives; the registry sits *above* them.
- Not implementing installers for tools the registry can't find (install flows stay in `dependency-installer.ts` / `package-manager-wrapper.ts`; the registry only *resolves*).
- Not per-workspace overrides. Tool paths are machine-level.
- Not replacing pi's internal binary resolution inside pi extensions. Scope is dashboard code.
- Not a real-time file-watcher on tool paths (rescan is explicit, on user action or server start).

## Decisions

### 1. Registry lives in `@blackbelt-technology/pi-dashboard-shared`

Both server and electron need it, and the existing shared package already hosts platform primitives. Placing it in `packages/shared/src/tool-registry/` keeps the layering consistent (shared → server/electron, never the other way).

**Alternative considered:** Server-only registry + electron IPC. Rejected — duplicates type definitions and makes the electron installer's pre-server bootstrap awkward.

### 2. Tool definitions are pure data, strategies are functions

```
interface ToolDefinition {
  name: string;                         // "pi", "pi-coding-agent", "openspec", ...
  kind: "binary" | "module" | "directory";
  strategies: Strategy[];               // ordered: override, managed, import, npm-global, where
  classify: (path) => Source;           // "override" | "managed" | "system" | "npm-global"
  validate?: (path) => boolean;         // optional: "dist/index.js exists", "binary is executable"
}
type Strategy = (ctx) => StrategyResult;
type StrategyResult = { ok: true; path: string } | { ok: false; reason: string };
```

Keeps the registry open to new tools without editing its core. Each strategy returns a reason on failure — that reason becomes the diagnostic line shown in the UI.

**Alternative considered:** A monolithic `resolvePi()` / `resolveOpenspec()` per tool. Rejected — that's exactly today's scatter, just moved.

### 3. `ToolRegistry.resolve(name)` returns a typed `Resolution` record, not just a path

```
interface Resolution {
  name: string;
  ok: boolean;
  path: string | null;
  source: "override" | "managed" | "system" | "npm-global" | null;
  tried: Array<{ strategy: string; result: "ok" | string /* reason */ }>;
  resolvedAt: number;
}
```

Today's callers that want "just the path" use `registry.resolve(name).path`. Callers that want the full trail (REST endpoint, doctor, error messages) get it from the same object. No separate "diagnose" API.

### 4. Cache is per-registry-instance, invalidated by `rescan()`

One `Map<string, Resolution>` inside the registry replaces:

- `resolverCache` in `runner.ts` (removed).
- `cachedGlobalRoot` in `npm.ts` (removed; `npm root -g` becomes a registered tool with kind `"directory"`).
- `piModuleCache` in `package-manager-wrapper.ts` (removed).

A single `rescan(name?)` clears one entry or all entries. Also invoked automatically on registered-override change and (as today) once per process start.

### 5. Overrides file: `~/.pi/dashboard/tool-overrides.json`

Separate from `config.json` because:

- Path overrides are **machine-local**. Users who sync their `config.json` (dotfiles repo, cloud backup) don't want `B:\Dev\...` paths following them across machines.
- It keeps `config.json` schema stable — the settings UI for tools writes to a different file.

Schema:

```json
{
  "version": 1,
  "overrides": {
    "pi":              { "path": "C:\\custom\\pi.cmd" },
    "pi-coding-agent": { "path": "D:\\dev\\pi-coding-agent\\dist\\index.js" }
  }
}
```

Atomic write via existing `json-store.ts`. Reads are lazy + cached, invalidated on `PUT/DELETE /api/tools/:name`.

### 6. `loadPiPackageManager()` becomes a registered `"module"` kind

Strategy chain for `pi-coding-agent`:

1. `override` — user-set path to `dist/index.js`, if any.
2. `bare-import` — `import("@mariozechner/pi-coding-agent")` (works when pi is a dep of the current package).
3. `managed` — `~/.pi-dashboard/node_modules/@mariozechner/pi-coding-agent/dist/index.js`.
4. `npm-global` — `<npm root -g>/@mariozechner/pi-coding-agent/dist/index.js` (with `@oh-my-pi` alias as a sibling strategy).

`resolveModule("pi-coding-agent")` returns the loaded ES module + the resolution trail. Server and electron both consume this single function.

### 7. REST endpoints live under `/api/tools`

```
GET    /api/tools              → { tools: Resolution[] }
GET    /api/tools/:name        → Resolution
POST   /api/tools/rescan       → { tools: Resolution[] }   body: { name?: string }
PUT    /api/tools/:name        → Resolution                body: { path: string }
DELETE /api/tools/:name        → Resolution (override cleared)
POST   /api/tools/diagnostics  → plain-text export         (for bug reports)
```

Auth: same guard as `/api/config` (localhost or authenticated). All endpoints return the registry snapshot post-change so the UI can refresh without a second round-trip.

### 8. Settings UI: new "Tools" section under the existing **General** tab

Not a new tab, to avoid tab proliferation. Expandable/collapsible section with per-tool rows:

```
┌─ Tools ─────────────────────────────────────────────────┐
│ Name                 Status  Source      Path           │
│ pi                   ✓       system      …\pi.cmd       │
│ pi-coding-agent      ✓       npm-global  …\index.js     │
│ openspec             ⚠ shim  system      …\openspec     │
│ npm                  ✓       system      …\npm.cmd      │
│ node                 ✓       managed     …\node.exe     │
│ git                  ✓       system      …\git.exe      │
│                                                          │
│ [Rescan all]  [Reset overrides]  [Export diagnostics]   │
│                                                          │
│ ▼ Expand to set override…                               │
└─────────────────────────────────────────────────────────┘
```

Row click expands a popover with `tried[]` trail + an override input (`<input type="text">` plus `<PathPicker>` reuse from the existing component).

### 9. Migration is incremental via a compatibility shim

During migration, `ToolResolver.which(name)` internally consults `registry.resolve(name).path` when the tool is registered, and falls back to its current PATH search when not. This lets each consumer migrate independently; unregistered tools (e.g. `zrok` before it's added) keep working unchanged.

## Risks / Trade-offs

- **Risk:** Registry initialization runs synchronously at server startup and blocks on `where`/`which` per tool. → **Mitigation:** Lazy resolution on first access per tool (already the pattern in `runner.ts`). Startup remains fast; rescan-all is the only batch operation.
- **Risk:** A bad user override could brick session spawn (e.g. user types a nonexistent path). → **Mitigation:** Strategy validation — if `override.path` fails `validate()`, the strategy records `invalid: <reason>` and falls through to the next strategy. Override is advisory, not mandatory. UI shows ⚠ on invalid overrides.
- **Risk:** Diagnostics leak filesystem paths to the UI / logs. → **Mitigation:** Paths already appear in server logs today; the registry doesn't add new secrets. The diagnostics export endpoint is auth-guarded like `/api/config`.
- **Risk:** Dropping `piModuleCache` means re-importing pi on every package operation. → **Mitigation:** Registry caches the resolved `path`; the module reference itself is held in a small LRU (max 4 entries) inside `resolveModule()`. Cache invalidation on rescan.
- **Risk:** Conflict with in-flight `fix-portable-windows-package-manager`. → **Mitigation:** This proposal explicitly supersedes it. The managed-install strategy becomes a registered strategy for `pi-coding-agent`; archive the older change after landing.
- **Trade-off:** Adding a layer on top of `ToolResolver` is more indirection. Accepted in exchange for observability, overrides, and eliminating two parallel detector implementations.

## Migration Plan

1. **Phase 1 — Additive:** Ship `ToolRegistry` + REST + Settings UI alongside existing code. Consumers unchanged. `registry.resolve()` is available but unused.
2. **Phase 2 — Opt-in:** Migrate `loadPiPackageManager()` (server + electron) to `registry.resolveModule("pi-coding-agent")`. This is the most visible win; the reported bug is unblocked here.
3. **Phase 3 — Sweep:** Migrate `runner.ts` `resolveBinary()` to call the registry for registered names, falling back to `ToolResolver.which()` for unregistered. Migrate `dependency-detector.ts` to thin wrappers.
4. **Phase 4 — Cleanup:** Remove the local caches in `runner.ts`, `npm.ts`, and the duplicate `loadPiPackageManager()`. Archive `fix-portable-windows-package-manager`.
5. **Rollback:** Each phase is independently revertable. Phase 1 is risk-free. Phase 2 rollback = revert the two `loadPiPackageManager()` files. Phase 3 rollback = restore `resolverCache`.

## Open Questions

- **Q1:** Do we version the overrides file (`version: 1`) so we can migrate its schema later, or keep it flat for now? *(Leaning toward versioned from day one — cheap insurance.)*
- **Q2:** Should `rescan` also re-run validation (e.g. `openspec --version`) to detect "binary present but broken"? Or is existence enough? *(Default: existence only; add a `verify` step per-tool if/when we see broken-binary cases in the wild.)*
- **Q3:** Do we want a CLI surface (`pi-dashboard tools list` / `tools set <name> <path>`) mirroring the REST API? *(Out of scope for this change; easy to add later.)*
- **Q4:** How should the registry handle tools the user hasn't installed but *could* (e.g. zrok on a fresh box)? Register with `ok: false, source: null` and let UI show "Not installed — [install]" linking to existing installer flows? *(Yes — registry is the single source of truth for "what the dashboard wants to find".)*
