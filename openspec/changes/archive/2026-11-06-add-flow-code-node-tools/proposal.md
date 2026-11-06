# Proposal

## Why

pi-flows code nodes (`code` / `code-decision` handlers) get a `CodeNodeContext` with no tool handle, so they spawn bare names off `PATH` through a login shell (`bash -lc`). They miss the dashboard's per-tool overrides and managed runtimes, and pick up profile noise (for example sdkman's `bad substitution` on macOS `/bin/bash` 3.2). The dashboard already resolves every external binary through its tool registry, and code nodes run in the same pi process as the flows-plugin bridge, so the plugin can hand them the registry without changing pi-flows or dashboard core.

## What Changes

- The flows-plugin bridge publishes a **flow-tools facade** over the dashboard tool registry on a process-global slot (`Symbol.for("pi-dashboard.flow-tools")`), on activate and every `session_start`.
- The facade covers **every registered tool by name**, not only bash: `has(name)`, `resolve(name)`, `run(name, args, opts)` (async, honours an `AbortSignal` and a timeout, never throws, `code: 127` when unregistered or unresolved), and `shell(script, opts)` (registry-resolved bash with no login profile).
- The flows-plugin bridge appends **one tool guideline to `flow_write`** (pi `systemPromptOptions.toolGuidelines`), only when `flow_write` is in the run's selected tools. It tells the model how code handlers reach the facade and that they must fall back when it is absent. It follows the roles-plugin `Agent` guideline pattern, so the guidance exists only while the flows plugin is enabled, in any project opened through the dashboard. Plain pi-flows never sees it.
- No change to pi-flows (`CodeNodeContext` stays as is), to dashboard core, or to the registry's tool set.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `flows-plugin`: adds requirements for the bridge-published flow-tools facade for code nodes, and for the dashboard-only `flow_write` tool guideline.

## Impact

- `packages/flows-plugin/src/bridge/`: new facade module, new guideline module, and wiring in `index.ts`.
- Consumes the existing `getDefaultRegistry()` / `resolveExecutor()` from `@blackbelt-technology/pi-dashboard-shared/tool-registry` (already a flows-plugin dependency). Registry behaviour is unchanged.
- Flow authors gain an opt-in API. Existing flows keep working unchanged. A flow that uses the facade must still run under plain pi-flows by falling back.
- Prompt surface: one extra `flow_write` guideline bullet while flow edit mode is on.

## Discipline Skills

- `security-hardening`: the facade spawns processes with caller-supplied args and env, and strips `BASH_ENV` / `ENV` (tasks 1.14, 1.15, 1.22).
- `performance-optimization`: the event-loop budget, since spawns must not block the pi process the bridge shares, and the 64 MiB output cap (tasks 1.12, 1.13, 1.17).
- `review-code`: a non-trivial new bridge module; review before commit.
