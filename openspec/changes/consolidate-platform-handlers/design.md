## Context

Platform branches in this codebase today:

```
17 production files, ~25 `process.platform === "win32"` branches

packages/shared/
  └── tool-resolver.ts            ← partial platform module (binary lookup only)
packages/server/
  ├── cli.ts                      ← findPortHolders, killProcess
  ├── process-manager.ts          ← tmux / sh-pipe / cmd /c / spawnHeadlessWindows
  ├── terminal-manager.ts         ← SHELL vs COMSPEC
  ├── tunnel.ts                   ← where/which zrok
  ├── editor-registry.ts          ← pgrep vs tasklist, where/which cli
  ├── editor-detection.ts         ← (migrated in fix-windows-server-parity)
  ├── headless-pid-registry.ts    ← kill -pid vs kill +pid
  ├── browser-handlers/
  │   └── session-action-handler.ts  ← isPiProcess, killHeadlessBySessionId
  └── routes/
      └── provider-auth-routes.ts ← open / xdg-open / start
packages/extension/
  └── process-scanner.ts          ← ps enumeration, etime parse, already has
                                     `_platform` injection (pattern seed)
packages/electron/
  ├── main.ts                     ← darwin dock, linux ozone hint, machine info
  └── lib/
      ├── server-lifecycle.ts     ← DUPLICATE jiti resolver (drift vector)
      ├── dependency-detector.ts  ← where/which, .cmd, login shell
      ├── doctor.ts               ← where/which tsx, .cmd
      ├── bundled-node.ts         ← node.exe vs node
      ├── tray.ts                 ← trayTemplate / .ico / .png
      └── app-menu.ts             ← darwin menu
```

The `fix-windows-server-parity` change fixed a Windows-launch bug that had to be patched in **two** places because `packages/electron/src/lib/server-lifecycle.ts:resolveJitiFromAnchor` duplicated logic in `packages/shared/src/resolve-jiti.ts`. Cross-package drift is the concrete hazard that motivates this refactor.

`ToolResolver` (packages/shared/src/tool-resolver.ts, 201 LOC) is the closest thing to a platform module today — it centralizes binary lookup, handles `where`/`which`, `.cmd` extension, managed-bin search, and login-shell fallback. It demonstrates the target pattern (context object, dependency injection, testable) but only covers one of six concerns identified in exploration.

## Goals / Non-Goals

**Goals:**
- Single location in `packages/shared/src/platform/` (plus `packages/electron/src/platform/`) for all cross-OS primitives, replacing ~25 scattered branches with ~8 named helpers.
- Eliminate cross-package duplication — `resolveJitiFromAnchor` deleted, Electron uses shared module.
- Each primitive takes an optional injectable `platform: NodeJS.Platform` parameter (defaulting to `process.platform`), enabling platform-targeted tests without `Object.defineProperty` mutation.
- Reduce `it.skipIf(win32)` test count where a paired Windows-side assertion is cheap.
- Zero behavior change visible to end users. REST, WebSocket, CLI, and config APIs unaffected.
- Each intermediate step ships green (tests pass on Windows, Linux, macOS).

**Non-Goals:**
- `process-manager.ts` strategy logic (tmux vs headless vs WSL). It **consumes** platform primitives but remains in-place; its decomposition is a separate concern (session spawn architecture) not a platform concern.
- WSL-specific spawn paths (explore item, not addressed here).
- ARM64 native-module audit (node-pty prebuilds — tracked separately).
- New platform support (FreeBSD, Android, etc.).
- Moving Electron presentation concerns (tray icon, menu) into `shared/platform/` — they import from `electron` and legitimately live in the Electron package.
- Changing the `ToolResolver` public contract in a way that requires callers to update their usage pattern (it gets renamed/re-homed, but its surface stays compatible during migration).

## Decisions

### D1: Two modules, one per execution context

`packages/shared/src/platform/` is pure Node (no `electron` or `fastify` or workspace-specific imports). `packages/electron/src/platform/` is for things that import from `electron` (nativeImage, Menu, app). Callers in server/extension import only from shared; Electron imports from both.

Alternative considered: one module in shared that exposes "Electron hooks" via a plugin/callback. Rejected — adds indirection for no benefit; tray icons are genuinely Electron-only, they should live in the Electron package.

### D2: Per-concern files, single `platform/` folder

Not one mega-file (`platform.ts`) — discoverability suffers at ~400 LOC. Not ten tiny files — import noise. Five concern-based files (`binary-lookup`, `process`, `process-scan`, `shell`, `commands`) plus `index.ts` barrel export. Each file matches a natural test boundary.

### D3: Platform is an injectable parameter, not global state

Every exported helper that depends on OS takes an optional `platform` parameter:

```ts
export function findPortHolders(
  port: number,
  opts?: { platform?: NodeJS.Platform; exec?: ExecFn }
): number[]
```

Production calls with no opts → reads `process.platform`. Tests pass `{ platform: "win32", exec: fake }` — no global mutation, no `Object.defineProperty` hack. This pattern is already used in `process-scanner.ts` (`_platform`) and `find-port-holders.test.ts` (`parseNetstatListeners(output, port, selfPid)`); we're standardizing it.

Alternative: class with `new PlatformResolver({ platform, exec })`. Rejected — adds ceremony for most call sites that only need one primitive. Keep it functional; if context accumulates, callers can build their own object.

### D4: `ToolResolver` renamed and re-homed, not deleted outright

`packages/shared/src/tool-resolver.ts` has ~6 internal callers. Moving it and deleting it in one step risks breaking things. Approach:

1. Create `packages/shared/src/platform/binary-lookup.ts` with the same public API.
2. Leave `packages/shared/src/tool-resolver.ts` as a one-line re-export: `export { ToolResolver, type ResolverContext } from "./platform/binary-lookup.js";`
3. Migrate callers one PR at a time to import from `platform/binary-lookup.js` directly.
4. Delete the old file in the final cleanup step.

Alternative: hard rename in one PR. Rejected — the re-export pattern gives reviewable intermediate states with no coordination.

### D5: Bottom-up migration (no top-level adapter)

Each concern migrates independently:

```
Step 1:  Create shared/platform/binary-lookup.ts (move tool-resolver)
Step 2:  Create shared/platform/process.ts
         + migrate cli.ts, headless-pid-registry.ts, session-action-handler.ts
Step 3:  Create shared/platform/process-scan.ts
         + migrate extension/process-scanner.ts, server/editor-registry.ts
Step 4:  Create shared/platform/shell.ts
         + migrate terminal-manager.ts
         + migrate process-manager.ts Windows spawn branch
Step 5:  Create shared/platform/commands.ts
         + migrate provider-auth-routes.ts (openBrowser)
         + migrate electron/main.ts (machineInfo)
Step 6:  Create electron/platform/{tray-icon,menu,node,app-lifecycle}.ts
         + migrate electron-specific call sites
Step 7:  DELETE packages/electron/src/lib/server-lifecycle.ts:resolveJitiFromAnchor
         + Electron server-lifecycle uses shared binary-lookup
Step 8:  Cleanup: delete tool-resolver.ts re-export; update AGENTS.md + docs
```

Each step is a shippable PR with its own test delta. Intermediate builds are green on all three OSes.

Alternative: big-bang single PR. Rejected — ~1,400 LOC of touched code, high conflict risk, difficult review, harder to bisect if a regression appears.

### D6: Test simplifications happen alongside each step

Where a test currently uses `Object.defineProperty(process, "platform", …)` or `vi.mock("node:child_process")` to exercise platform branches, migrate it to pass `platform: "win32"` as a parameter. Where a test is `it.skipIf(win32)` because the Unix fixture can't run on Windows, add a paired Windows-side `it.skipIf(win32 !== x)` test using the new primitives — unless the production code itself is Unix-only (e.g. login shell, which is explicitly gated in `tool-resolver.ts:55`).

Pattern illustration:

```ts
// BEFORE (test mutates global)
Object.defineProperty(process, "platform", { value: "win32", configurable: true });
expect(findPortHolders(8000)).toEqual([12345]);

// AFTER (injected)
expect(findPortHolders(8000, {
  platform: "win32",
  exec: () => "TCP    0.0.0.0:8000   0.0.0.0:0   LISTENING   12345",
})).toEqual([12345]);
```

### D7: Preserve `process-manager.ts` spawn strategy logic in place

`process-manager.ts` is 310 LOC with three strategies (tmux, headless, WSL), each with a Windows branch. The temptation is to extract all of it. Resist — the **strategy** (which path to take) is session-management logic, not a platform primitive. The *primitives* (how to spawn a detached process, how to build a shell command) come from `platform/`; the *choice* of tmux-vs-headless stays in `process-manager.ts`. This draws a clean seam: platform tells you "how to Windows spawn"; process-manager tells you "spawn as tmux or headless".

Concretely: `spawnHeadlessWindows` function today inlines Windows-specific `.cmd` handling and stderr capture. The `.cmd` handling moves to `platform/binary-lookup.ts` (already partly there via `resolveTsx`); the Windows spawn wrapper stays in `process-manager.ts` but calls `platform.resolvePi()` to get its command.

### D8: Electron package stays thin; heavy lifting in shared

Electron-specific concerns that DO go into `packages/electron/src/platform/`:
- Tray icon selection (uses `nativeImage.createFromPath`)
- Menu template (uses `MenuItemConstructorOptions`)
- Dock-hide behavior (uses `app.dock`)
- Ozone hint for Linux (uses `app.commandLine`)
- Bundled Node path (uses `process.resourcesPath`)

Electron concerns that get DELEGATED to shared:
- Binary lookup (where/which, .cmd) — use `shared/platform/binary-lookup`
- Jiti resolution — delete duplicate, use `shared/resolve-jiti`
- Machine info via `sysctl`/`systemd-detect-virt`/`wmic` — use `shared/platform/commands.ts:detectMachineInfo`
- `where`/`which` for tsx — use `shared/platform/binary-lookup`

### D9: No new runtime dependencies

All primitives use Node built-ins (`child_process`, `fs`, `os`, `net`, `http`). No `ps-list`, `find-process`, `shelljs`, or similar. The existing approach (shell out with platform-branching) is kept — just centralized.

## Risks / Trade-offs

- **Risk: The re-export wrapper for `tool-resolver.ts` is forgotten and stays forever**
  → Mitigation: final cleanup is a dedicated task (step 8) that grep-verifies no remaining imports of `tool-resolver.js` before deletion. Tasks.md has an explicit "delete re-export" step.

- **Risk: `process-manager.ts` extraction regresses tmux/WSL spawn**
  → Mitigation: extract only the *.cmd* and *binary lookup* parts in step 4; leave spawn-strategy logic untouched. Add a dedicated integration test that spawns a headless session on both Unix and Windows before and after the refactor.

- **Risk: Injectable platform parameter cascades into many function signatures**
  → Mitigation: only exported primitives take the parameter. Internal helpers inside `platform/` can read `process.platform` directly. Callers that need it can thread a single `platform` value down their call chain.

- **Risk: Electron platform module creates circular dependencies with `packages/electron/src/main.ts`**
  → Mitigation: `electron/platform/` imports from `electron` only, not from `electron/main.ts`. Main imports *from* platform, never the reverse. Enforced by directory layout (`main.ts` is a leaf, platform is a dependency).

- **Risk: Bundle size or tree-shaking regresses**
  → Mitigation: measure `dist/` bundle size before and after. Expect slight *decrease* because the Electron jiti duplicate is deleted. If bundle size grows, investigate why (likely accidental `import * as`).

- **Trade-off: 6–8 PRs vs. one big PR**
  → Accepted. Bottom-up is slower per wall-clock but each PR is small and reviewable. If a reviewer preferred squash-merge, the migration can collapse into a single PR at merge time while keeping the per-step commit history for bisection.

- **Trade-off: Two platform modules (shared + electron) vs. one**
  → Accepted. Electron-API concerns are genuinely Electron-bound; forcing them into shared would require a plugin/callback indirection. Two modules is the honest shape.

- **Trade-off: Injection-via-options vs. class-with-context**
  → Accepted injection-via-options. Most call sites need one primitive at a time; a class adds ceremony. Callers that accumulate context can build their own wrapper.

## Migration Plan

No data/config/API migration. Pure internal refactor.

Roll-out:
- Each of the 8 steps above is a reviewable PR.
- Between PRs: tests pass on Windows, Linux, macOS (the workflow runs all three).
- Rollback: revert the offending PR; earlier PRs are independent.
- After step 7, the `fix-windows-server-parity` follow-up item "collapse Electron duplication" is closed.

Timing estimate: 4–6 days of focused work, or longer spread across iterations. No hard deadline; the refactor can pause at any step boundary (each leaves the tree in a valid state).

## Open Questions

- **Should `shared/platform/` export a `createPlatform(ctx)` factory in addition to flat functions?**
  Factory enables pattern like `const p = createPlatform({ extraBinDirs }); p.which("zrok")`. Flat functions are simpler. Leaning: export both — factory for multi-call contexts, flat functions for one-offs. Decision deferrable to step 1.

- **Does `ToolResolver` (the class) survive, or flatten entirely?**
  The class owns context (`extraBinDirs`, `useLoginShell`, `processExecPath`) and exposes `which`, `resolvePi`, `resolveTsx`, `resolveNode`, `buildSpawnEnv`. Keeping it as a class is the lowest-churn path. Flattening to functions requires threading context through every call. Leaning: keep the class, rename-and-relocate only.

- **Is there value in a `platform.arch` companion now, anticipating the ARM64 follow-up?**
  Probably not — YAGNI until the ARM64 scope is actually pursued. Mention in docs that `platform/` is the natural home when it happens.

- **Do any *tests* actually exercise darwin-only paths (open `open(url)`, `sysctl`)?**
  Probably not — they'd need an actual macOS runner. Confirm during step 5. If not, tests for those paths can use the injectable-platform pattern to reach the darwin branch on any OS.
