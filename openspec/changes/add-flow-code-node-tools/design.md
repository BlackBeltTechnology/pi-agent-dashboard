# Design

## Context

See proposal.md for the motivation. These facts shape the approach:

- **Code nodes run in the pi process.** pi-flows builds a fixed `CodeNodeContext` (`signal`, `cwd`, `logger`, `setSummary`, `flowName`, `stepId`, `task`) and loads the handler with a dynamic `import()` (`../pi-flows/extensions/flow-engine/execute-code-step.ts:124-138`; type at `extensions/flow-engine/types.ts:417-425`). It has no extension point for extra context.
- **The flows-plugin bridge runs in that same process.** It is a pi extension with a default-export `activate(ctx)` (`packages/flows-plugin/src/bridge/index.ts:55-75`). It is registered only while the plugin is enabled (`flows-plugin` spec, "disabled … bridge entry SHALL be deregistered").
- **The registry is a lazy process singleton.** `getDefaultRegistry()` builds it once and publishes it on `globalThis[Symbol.for("pi-dashboard.tool-registry")]` (`packages/shared/src/tool-registry/default-registry.ts:49-58`). `resolveExecutor(name)` returns `argv`, the resolved path plus any interpreter prefix (`packages/shared/src/tool-registry/registry.ts:232-244`). `resolve()` and `resolveExecutor()` throw `UnknownToolError` for an unregistered name (`registry.ts:152`, `:234`). `list()` resolves every definition, with results cached per tool (`registry.ts:140-160`). The flows plugin already imports from the shared package (`bridge/index.ts:33`).
- **There is a precedent for resolving bash from the registry.** The `!` / `!!` escape resolves `bash` from the registry and spawns the absolute path via `pi.exec` (`packages/extension/src/command-handler.ts:1536-1580`). It runs `bash -c` (a non-login shell, so no profile is sourced at exec time) and injects env as `export` lines (`:1561-1578`). The login shell (`-lc`) appears only in `ToolResolver`'s resolution fallback (`packages/shared/src/platform/binary-lookup.ts:416-433`).
- **Spawn conventions.** `platform/exec.ts` `spawn` wraps Node's with `windowsHide: true` (`packages/shared/src/platform/exec.ts:207-213`; `command-executor` spec). `platform/process.ts` `killProcessGroup(pid)` kills a detached POSIX child's whole group (SIGTERM, then SIGKILL) and uses `taskkill /F /T` on win32 (`packages/shared/src/platform/process.ts:277-320`).
- **Session lifecycle.** pi emits `session_shutdown` (including before `/reload` and session replacement) for releasing session-scoped resources, and `session_start` after (pi `docs/extensions.md:60,135,163`).
- **Registry kinds.** Not every tool is a spawnable binary. `kind: "module"` resolves to a module entry or directory, and `env` / `docker-image` probe kinds may carry a null or non-path value (`tool-registry` spec, "Resolution.path"; `packages/shared/src/tool-registry/types.ts:54-70`). `resolveExecutor` returns `argv: []` when resolution fails (`registry.ts:236-238`). `platform/runner.ts` `buildSpawnEnvForArgv(argv0, env)` merges caller env over the process env and adds `ELECTRON_RUN_AS_NODE` when `argv0` is an Electron execPath (`packages/shared/src/platform/runner.ts:184-198`). It does not augment PATH. `ToolResolver.buildSpawnEnv(base)` prepends the managed bin, node bin and common user bin dirs, and strips Electron vars (`packages/shared/src/platform/binary-lookup.ts:153`, `:260-290`).
- **pi renders tool guidelines for any selected tool.** `buildRules` emits `toolGuidelines[name]` for every name in `selectedTools`, plugin tools included, and dedupes identical rules (`@earendil-works/pi-coding-agent/dist/core/system-prompt.js:31-59`). `flow_write` is selected only while pi-flows edit mode is on (`../pi-flows/extensions/flow-engine/index.ts:408`, `edit-flow-config.ts`).
- **A dashboard-only guidance pattern already exists.** The roles plugin bridge appends one `toolGuidelines.Agent` bullet in `before_agent_start`, only when `Agent` is selected (`packages/roles-plugin/src/bridge/index.ts:50-63`; header lines 1-13 cite add-plugin-bridge-contributions D12/D13). pi renders `toolGuidelines` with the tool. `before_agent_start` mutations of `systemPromptOptions` are shared across handlers (pi `docs/extensions.md:208`).

## Goals / Non-Goals

**Goals:**
- Code handlers can run any registered tool through the registry's resolution (overrides, managed runtimes, bundled bash) without a login shell.
- The model learns about the facade only when it can author flows (`flow_write` selected) and only while the dashboard flows plugin is loaded, whatever the project.

**Non-Goals:**
- No change to pi-flows (`CodeNodeContext` is untouched) and no new registry tool definitions (`pnpm` and `pi-dashboard` stay unregistered; `shell()` reaches them via PATH).
- No access gating beyond what code nodes already have. Handlers can already spawn anything through `node:child_process`.
- No migration of existing flows such as the local `update-dashboard` flow.

## Decisions

**D1 — Publish on a dedicated global slot rather than extending `CodeNodeContext`.**
The bridge writes the facade to `globalThis[Symbol.for("pi-dashboard.flow-tools")]`.
- *Alternative:* add `ctx.tools` in pi-flows. Rejected: it changes another package and ties pi-flows to the dashboard.
- *Alternative:* handlers read the raw `pi-dashboard.tool-registry` slot. Rejected: that exposes the full `ToolRegistry`, including `register` and `rescan`, and it is unset until something calls `getDefaultRegistry()`. The bridge calls it itself, so the dedicated slot is always populated while the plugin is active.

**D2 — Expose a narrow facade (`list` / `has` / `resolve` / `run` / `shell`), not the registry.**
Handlers get read and run access only. `run` uses `resolveExecutor(name).argv` so Node-script tools receive their interpreter prefix, the same as the dashboard's own spawns. Every registry call is inside try/catch: `UnknownToolError`, `toArgv` failures and resolution errors map to `null` (`resolve`) or `ok: false, code: 127` (`run` / `shell`). An empty `argv` (failed or path-less resolution) also maps to 127. `resolve()` returns the resolved `path` only when it is an absolute filesystem path. Probe kinds that carry `null` or a non-path value (`env`, `docker-image` refs) return `null`. It does not include an interpreter prefix, so the guideline directs handlers to execute through `run`, never by spawning a `resolve()` path. `run` on a non-executable kind (for example a module directory) fails at spawn and resolves `ok: false`. It never throws. The facade has **no `list()`**. The registry's `list()` resolves every definition synchronously on first call, and some probes spawn (for example `docker image inspect`, up to 10 s), which would block the event loop D3 protects. A non-resolving names accessor would need a `packages/shared` change, which is out of scope. Handlers address tools by name. Resolving one named tool is still synchronous, but bounded to that tool's strategy chain and cached afterwards. The facade has no `rescan`: each pi process keeps its own cache, the same as the dashboard bridge's own lookups.

**D3 — `run` and `shell` are async (`child_process.spawn`), not `spawnSync`.**
Handlers run on pi's event loop, which also drives the dashboard bridge (heartbeats, event forwarding). A long synchronous spawn, such as an install or a build, would stall the bridge and can trip the gateway heartbeat timeout. The spawn uses `platform/exec.ts` `spawn` (`windowsHide: true`, `shell: false`, stdio `ignore`/`pipe`/`pipe`). Env is `buildSpawnEnvForArgv(argv[0], { ...new ToolResolver().buildSpawnEnv(process.env), ...opts.env })`: dashboard PATH augmentation, caller overrides on top, and `ELECTRON_RUN_AS_NODE` re-added only when `argv[0]` is an Electron execPath. Tools installed only in the managed dir, such as `pnpm` under `shell("pnpm install")`, are therefore found the same way the dashboard's own spawns find them. On POSIX the child is spawned `detached` (its own process group) so that a timeout or abort, via `killProcessGroup(pid)`, also reaches grandchildren (for example `pnpm` under `shell("pnpm install")`). On win32 it is not detached, and `killProcessGroup` delegates to `taskkill /F /T`. A `timeoutMs` that is not a positive finite number means no timeout. An already-aborted signal resolves `ok: false, code: 130` without spawning. Termination sends SIGTERM to the group, then SIGKILL after a 1 s grace, so the call resolves within 2 s (`killProcessGroup` with `timeoutMs: 1000`). Output is capped at a fixed 64 MiB per stream, matching the `maxBuffer` existing local flows already use. The cap is not configurable, to keep the surface small. Exceeding it kills the group and resolves `ok: false` with the captured prefix. The promise always resolves and never rejects.
- *Alternative:* `spawnSync`, which is simpler. Rejected for the reason above.

**D4 — `shell` runs bash with `--noprofile --norc -c` and no `BASH_ENV` / `ENV`.**
This keeps profile output (for example sdkman on macOS bash 3.2) out of results and makes runs deterministic. It matches the `!` / `!!` escape, which also runs non-login `-c`. Inherited `BASH_ENV` / `ENV` are removed from the child env, because non-interactive bash would source them despite `--noprofile --norc`. A caller that sets them explicitly in `opts.env` keeps them. The cost is that PATH changes made only in profiles are not applied. The D3 PATH augmentation covers managed tools, and handlers can pass `opts.env`.

**D5 — The guideline comes from the flows-plugin bridge via `toolGuidelines.flow_write`.**
This follows the roles-plugin `Agent` pattern, adding a content dedupe that the roles plugin lacks (`packages/roles-plugin/src/bridge/index.ts:58-59` appends blindly). That matters because a stale and a current bridge generation can both fire after `/reload`. The bullet is added only when `selectedTools` contains `flow_write`, inside try/catch. Scope: the model sees it in any project opened through the dashboard while pi-flows edit mode has `flow_write` active. Authoring flows is the only moment the guidance is actionable.
- *Alternative:* `prepareLoadout` description replacement. Rejected: it requires owning an orchestrating tool and replaces the whole description.
- *Alternative:* editing the manage-flows skill. Rejected: the skill is project-local and ships without the dashboard.

**D6 — Publish on activate and every `session_start`; clear on `session_shutdown`.**
The publish is an idempotent overwrite. The bridge deletes the slot in an idempotent `session_shutdown` handler, so a `/reload` or session replacement after the plugin is disabled leaves no stale facade. The re-enabled path re-publishes on the next `session_start`.

## Risks / Trade-offs

- [The global slot is an unversioned contract] → The facade shape is small and specified. Additions must be backward compatible. The guideline text is the only documentation the model sees, so it is the single source.
- [A handler written against the facade breaks under plain pi-flows] → The guideline carries the literal guard snippet (`const tools = globalThis[Symbol.for("pi-dashboard.flow-tools")]; if (tools) { … } else { /* fallback */ }`), not only prose. The slot being absent is the defined signal. Nothing enforces it at runtime; that is accepted, since pi-flows is out of scope.
- [`shell` skips profile PATH, so a tool installed only via profile hooks is not found] → Accepted. Use `run` for registered tools, or pass `opts.env.PATH`.
- [Large outputs] → A per-stream cap. Beyond it the child is killed and the result is `ok: false`.
- [Handlers cannot enumerate tools] → Accepted. `list()` was dropped to avoid a blocking resolve-all. The guideline names common tools, and `has(name)` checks one.
- [First resolution of one named tool runs synchronously] → Bounded to that tool's chain and cached per process. Only probe kinds that spawn (`docker-image`) are slow, and those are not useful to `run`.
- [Only flow authors see the guideline (`flow_write` selected)] → Accepted scope. Existing flows keep their own spawning until re-authored.
