## Context

The `consolidate-platform-handlers` change (archived) moved OS-specific primitives into `packages/shared/src/platform/` and eliminated cross-package duplicates. But it stopped at the primitives layer. Every callsite that invokes an external CLI tool (git, openspec, npm, etc.) still builds its own `execSync("tool arg1 arg2")` inline. That means five independent files each carry:

- `windowsHide: true` (or forget it — the flashing-terminal bug)
- `timeout: N` (each picks its own N)
- `stdio: ["pipe", "pipe", "pipe"]` (or forget it)
- `JSON.stringify(path)` to escape shell args (or forget it)
- `try/catch` with bespoke error classification
- `stdout.trim().split(...)` parse logic per command

This repetition is why `session-diff.ts` flashes a cmd window on every session click: someone added a new spawn site, forgot `windowsHide`, and the test suite didn't catch it.

### Current state (post consolidate-platform-handlers)

```
packages/shared/src/platform/
  binary-lookup.ts       ← ToolResolver (where/which)
  process.ts             ← findPortHolders, killProcess, ...
  process-scan.ts        ← isProcessRunning, parseEtime
  shell.ts               ← detectShell
  commands.ts            ← openBrowser, isVirtualMachine
  index.ts               ← barrel

packages/server/src/
  session-diff.ts        ← execSync("git diff ...")          ← L0
  git-operations.ts      ← execSync("git branch ...")        ← L0
  package-manager-wrapper.ts ← execSync("npm root -g")       ← L0
  pi-resource-scanner.ts ← execSync("npm root -g")           ← L0
  tunnel.ts              ← execSync("zrok ...")              ← L0
  routes/system-routes.ts ← spawn("sh", ...)                  ← L0 (restart shell script)
  ...

packages/extension/src/
  git-info.ts            ← execSync("git rev-parse ...")     ← L0
  process-scanner.ts     ← spawnSync("wmic ...")              ← L0
  server-launcher.ts     ← spawn(node, ...)                   ← L0

packages/electron/src/lib/
  update-checker.ts      ← execSync("npm outdated ...")      ← L0
  doctor.ts              ← execSync("git ..."), curl, ...    ← L0
  server-lifecycle.ts    ← spawn(...)                         ← L0

packages/shared/src/
  openspec-poller.ts     ← spawnSync("openspec ...")          ← ~L3 (already centralized!)
```

**Observation:** `openspec-poller.ts` is already the pattern we want — it's the only place that knows how to call openspec, and it exposes `pollOpenSpec` / `pollOpenSpecAsync` as the tool-module API. We're generalizing that pattern to `git` and `npm`, and adding a shared runner so we don't rebuild the spawn-concerns plumbing once per tool.

## Goals / Non-Goals

**Goals:**
- Exactly one module in the repo (`platform/runner.ts`) knows how to spawn a subprocess. Platform awareness, `windowsHide`, timeouts, shell escaping, binary resolution, and error normalization live there.
- Zero direct `node:child_process` imports outside `platform/exec.ts` and `platform/runner.ts`. Enforced by a unit test.
- Every git, openspec, and npm invocation in the repo routes through a typed tool-module (`platform/git.ts`, `platform/openspec.ts`, `platform/npm.ts`) that has zero platform awareness and zero `child_process` references.
- Adding a new operation on an existing tool is ~3 lines (a Recipe object + a thin export).
- Adding platform-specific behavior (new OS support, timeout defaults, telemetry) is a change in ONE file (`runner.ts`) and every tool inherits it.
- Callers that don't warrant a tool module (one-off diagnostic commands, Electron lifecycle spawns) still import from the Layer 1 wrapper so they inherit `windowsHide: true`.

**Non-Goals:**
- Replacing `node-pty` in `terminal-manager.ts`. PTY handling is a different domain and the runner is not designed for it.
- Replacing the `sh -c` shell script logic used by `server-lifecycle.ts:launchViaCli` or the restart orchestrator in `restart-helper.ts`. Those build complex shell scripts; the Recipe pattern targets individual tool invocations, not script composition.
- Supporting long-lived processes with streaming stdout (the dashboard server, tmux sessions, zrok tunnels). Those stay with direct `spawn()` via the Layer 1 wrapper.
- Replacing git CLI with a native library (`nodegit`, `isomorphic-git`). That's a separate future decision; the Recipe pattern would make it a one-day migration when/if we want it.
- Rewriting `process-manager.ts` spawn-strategy selection. Strategies consume the runner; the runner doesn't own them.

## Decisions

### D1: Three layers, strict dependency direction

```
                 platform/git.ts, openspec.ts, npm.ts  (Layer 3: tool modules)
                                   │
                                   ▼ call run(recipe, input)
                         platform/runner.ts           (Layer 2: the runner)
                                   │
                                   ▼ use
                         platform/exec.ts              (Layer 1: safety-net wrappers)
                                   │
                                   ▼ use
                         node:child_process            (Layer 0: raw Node API)
                         ❌ forbidden outside Layer 1
```

Layer 3 imports Layer 2. Layer 2 imports Layer 1. Layer 1 is the only place `node:child_process` is imported in the monorepo. Inversions forbidden.

### D2: Recipes are pure data, never functions of platform

A Recipe is a `{ argv, parse, timeout?, tolerate?, ... }` object. The `argv` function takes a typed `input` and returns `readonly string[]` — it does not branch on platform. If a recipe genuinely needs per-OS argv, that's evidence the operation is actually two different operations — model them as two recipes (e.g. `LIST_PROCESSES_WMIC` vs `LIST_PROCESSES_PS`) and pick one at the Tool-module layer. The runner is deliberately not a "multi-OS dispatcher".

```ts
// GOOD — no platform awareness in the recipe
const GIT_DIFF: Recipe<{ path: string; ref?: string }, string> = {
  argv: ({ path, ref }) => ["git", "diff", ref ?? "HEAD", "--", path],
  parse: (out) => out,
  tolerate: [1],  // "no diff" exits 1 in some git configs — not an error
};

// NOT ALLOWED — platform branch inside a Recipe
// argv: ({ path }) => process.platform === "win32" ? [...] : [...]
```

This constraint is what makes Recipes pure data you can test, lint, and inventory.

### D3: The runner's defaults ARE the platform policy

Every Recipe gets these for free from the runner (no caller has to know or remember):

```ts
{
  windowsHide: true,          // always
  stdio: ["pipe", "pipe", "pipe"],
  timeout: 5000,              // overridable per recipe
  encoding: "utf-8",
  shell: false,               // argv array; never shell-interpolated
}
```

Explicit overrides are allowed (`recipe.timeout = 30000` for slow commands), but the defaults are what matter.

### D4: Error handling normalized via `Result<T>`

`run()` returns a `Result<T> = { ok: true; value: T } | { ok: false; error: ExecError }` instead of throwing. `ExecError` has a discriminant: `"not-found"` (binary missing), `"timeout"`, `"exit"` (non-zero + not-tolerated), `"spawn-failure"` (OS-level spawn failure).

Rationale: call sites today do `try { execSync(...); return X; } catch { return Y; }` for "best-effort" semantics. A typed `Result` surface makes the two outcomes symmetric and discoverable.

Convenience helper `unwrap(result, fallback)` for the common case "I don't care about the error, give me a default" — so `git.isGitRepo` reads as a single expression.

### D5: Binary resolution via ToolResolver, lazy

The runner calls `ToolResolver.which(argv[0])` on first use per-tool, and caches the resolved path per-process. Callers never need to resolve binaries themselves. If the tool isn't installed, `run()` returns `Result.error({ kind: "not-found" })` — never throws.

This means a missing `git` or `npm` degrades gracefully (callers get a typed "not found" result), instead of the current inconsistent mix of caught-throw vs uncaught-throw.

### D6: Tool modules are platform-blind thin wrappers

Each tool module exports:
1. A `*_RECIPES` registry (the data) — `const GIT_RECIPES = { diff: GIT_DIFF, status: GIT_STATUS, ... }`.
2. Typed function exports that wrap `run(recipe, input, ctx)`.

```ts
// platform/git.ts
export const GIT_RECIPES = { GIT_DIFF, GIT_STATUS, GIT_BRANCHES, ... };

export function diff(input: { path: string; ref?: string; cwd: string }): Result<string> {
  return run(GIT_RECIPES.GIT_DIFF, input, { cwd: input.cwd });
}
```

The reason for the registry: **external consumers (tests, linters, docs) can enumerate all operations of a tool as data.** Handy for generating API docs and for the no-`process.platform` lint.

### D7: Ban direct `child_process` imports outside Layer 1

A test file `packages/shared/src/__tests__/no-direct-child-process.test.ts` greps every `.ts` file under `packages/*/src/` (excluding `__tests__/`) for `from "node:child_process"` or `require("node:child_process")`. Allowed files: `packages/shared/src/platform/exec.ts` only. Test fails with a diff-style listing of violations if any are found.

This makes the architecture **self-enforcing** — anyone adding a new `execSync` anywhere automatically gets flagged in CI.

### D8: Phased migration, three shippable PRs

- **Phase 1 — Layer 1 wrapper + import migration** (lowest risk, highest urgency). Adds `platform/exec.ts`. Every `import { X } from "node:child_process"` in the repo becomes `import { X } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js"`. All callers inherit `windowsHide: true`. No behavior change, flashing-terminal bug fixed end-to-end. Add the import-ban test. Ships independently.
- **Phase 2 — Runner + first Recipe-based tool (`git.ts`)**. Adds `platform/runner.ts` + `platform/git.ts`. Migrates the 5 files with inline git calls to use `git.*` methods. Exercises the whole pattern end-to-end with a real tool.
- **Phase 3 — `openspec.ts` + `npm.ts`**. Absorbs `openspec-poller.ts`, adds `npm.ts`, migrates remaining 4 call sites. The existing `pollOpenSpec` API stays as a back-compat re-export.

Each phase passes its own test suite. Phase 1 is the urgent fix; Phase 2/3 can follow at their own pace.

### D9: One-off commands opt out, gracefully

Commands called from exactly one place with no reuse pressure (`sysctl -n hw.model`, `systemd-detect-virt`, `wmic bios`, `curl -sf .../health`) stay inline. They import `execSync` from `platform/exec.ts` (Layer 1) so they still benefit from `windowsHide: true`. Wrapping them as Recipes would be 30 lines of ceremony for a 1-line command.

Rule of thumb for creating a new tool module: **≥3 distinct subcommands OR ≥2 call sites**. Otherwise inline is fine.

## Risks / Trade-offs

- **Risk: migrating 25+ call sites in one change is error-prone**
  → Mitigation: phased migration (D8). Each phase is independently reviewable and shippable. Phase 1 has the fewest changes per file (just the import).

- **Risk: the Recipe abstraction is too rigid for some git command (e.g. `git log --since=... --until=...` with escaping)**
  → Mitigation: Recipes take a typed `input` that can be arbitrarily complex. If escaping is tricky, the `argv` function is still plain TS — it can do whatever. The guarantee is just "no shell interpolation"; argv array passing handles all escaping safely.

- **Risk: `Result<T>` return type is more verbose than throwing**
  → Mitigation: `unwrap(result, fallback)` helper for best-effort cases. Most existing callers already do `try/catch` — migrating to `if (!result.ok)` is equivalent.

- **Risk: the import-ban test breaks legitimate future spawn needs**
  → Mitigation: the ban is explicitly scoped to `node:child_process`. A new long-lived process or special case can add a new export to `platform/exec.ts` and be done; the ban prevents *sneaking in* a raw import without going through the central module.

- **Risk: ToolResolver caching in the runner makes tests harder to isolate**
  → Mitigation: runner exposes a `resetResolverCache()` test hook. Caller cache is scoped per-tool, not per-command, so a test that calls `git.diff` doesn't affect `npm.*` resolution.

- **Trade-off: three new files (runner, git, openspec, npm) for what COULD be one monolithic `tools.ts`**
  → Accepted. One-file-per-tool matches the house style (see `binary-lookup`, `process`, `process-scan`, `shell`, `commands` — each its own file). Discoverability beats line-count.

- **Trade-off: callers that want streaming stdout (long-lived processes) can't use Recipes**
  → Accepted. The runner is for spawn-and-parse-result operations. Long-lived processes (dashboard server, zrok tunnel, tmux) stay with direct `spawn()` via Layer 1. The Recipe pattern addresses the 80% case, not the 100%.

## Migration Plan

No data, config, or API migration. Pure internal refactor. Each phase passes tests and ships independently.

**Phase 1 rollback plan:** revert the PR; every call site returns to direct `child_process` imports and loses `windowsHide: true` again. Low risk to revert.

**Phase 2 rollback plan:** revert the PR; the 5 git call sites return to inline `execSync("git ...")`. Phase 1 stays in place; no flashing regression.

**Phase 3 rollback plan:** revert the PR; openspec/npm call sites return to their previous inline forms. Phase 1/2 unaffected.

## Open Questions

- **Should `git.ts` use a class or flat functions?**
  Leaning flat functions for consistency with the rest of `platform/`. Each function is a closure over `run(GIT_RECIPES.X, input, ctx)`. If a caller accumulates context (cwd, author), they can curry themselves. Decision deferrable.

- **Should `Result<T>` be a class with `.map`/`.flatMap` methods or a plain tagged union?**
  Leaning plain tagged union — no fp-ts, no class methods. Callers do `if (!result.ok) return null`. Keeps the surface minimal; we're not building a monad library.

- **Should the import-ban test list allowed exceptions in code or in a config file?**
  Leaning in the test file as a constant array. Two exceptions today (`exec.ts`, `runner.ts`). If it grows, move to config.

- **Should one-off commands like `curl -sf health` stay as CLI calls or become `http.get`?**
  That's arguably better (no curl dependency on Windows). But out of scope; tracked as a follow-up nit.

- **Should the runner support an `AbortSignal` from day one or defer?**
  Leaning defer. No current caller needs cancellation. Add it when the first caller asks.
