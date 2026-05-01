## Why

The in-progress change `fix-multiselect-auto-cancel-on-dashboard` shipped a "Layer 1" fix consisting of four wiring pieces; three are correct, but the fourth — extending the TUI PromptBus adapter with a `multiselect` arm that calls `await originals.custom(...)` — **introduces a new, more visible regression** in headless dashboard mode. The dashboard now renders the `MultiselectRenderer` correctly (the user can see the dialog with checkboxes), but **<1 second later** the TUI adapter arm fires, awaits `originals.custom` which is a 3-line no-op in pi 0.70's RPC mode (`return undefined;` — see `~/.nvm/.../pi-coding-agent/dist/modes/rpc/rpc-mode.js:150-152`), and immediately calls `bus.respond({ cancelled: true, source: "tui" })`. The bus interprets this as "TUI adapter answered first, dismiss the dashboard render" and emits `prompt_dismiss`. The browser flips the renderer to `status: "dismissed"` ("Answered in terminal") before the user can click any checkbox.

Confirmed visually: user sent `kérek egy multiselectet`, the agent invoked `ask_user`, the dialog with five `Opció N` checkboxes appeared, and 1 second later the dialog was greyed out as `Answered in terminal` while the agent reported `Úgy tűnik, megszakítottad a választást (nem érkezett válasz)`. The bug is reproducible on every dashboard headless session running the current bridge.

The previous change's other three pieces (bridge `ctx.ui.multiselect` PromptBus patch, polyfill fallback chain, client `{values}` encoder) are sound and **must stay**. Only the TUI adapter arm and its supporting `originals.custom` capture need to go.

## What Changes

- **MODIFIED**: `packages/extension/src/bridge.ts` — REMOVE the `else if (prompt.type === "multiselect" && prompt.options && originals.custom) { ... }` arm that the `fix-multiselect-auto-cancel-on-dashboard` change added to the TUI adapter's `present()` switch (~line 891-905). This arm is the source of the auto-cancel bug.
- **MODIFIED**: `packages/extension/src/bridge.ts` — REMOVE the `custom: ctx.ui.custom?.bind(ctx.ui) as ...` capture from the `originals` object (~line 858). It is only consumed by the arm being removed; leaving it would be dead code.
- **MODIFIED**: `packages/extension/src/bridge.ts` — REMOVE the `import { MultiSelectList } from "./multiselect-list.js";` import that became unused once the TUI arm is gone. The `multiselect-list.ts` module itself stays — `polyfillMultiselect`'s legacy fallback path still uses it for non-bridge contexts.
- **MODIFIED**: `packages/extension/src/__tests__/multiselect-dashboard-routing.test.ts` — REMOVE the two regression-guard tests added by the previous change that assert `originals.custom` capture and the TUI multiselect arm string match (`prompt.type === "multiselect"` adjacent to `MultiSelectList`). Replace them with one inverse-guard test: `bridge.ts` MUST NOT contain `prompt.type === "multiselect"` adjacent to `originals.custom` (regression guard against re-introduction).
- **MODIFIED**: `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/specs/bridge-extension/spec.md` — REMOVE the "TUI adapter captures `ctx.ui.custom` for multiselect rendering" Requirement and its scenarios. The previous change is still in-progress (32/42 tasks); this edit happens before its archival, so the requirement never enters the base `bridge-extension` spec.
- **MODIFIED**: `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/specs/multiselect-dialog/spec.md` — REMOVE the "TUI adapter handles multiselect via MultiSelectList overlay" Requirement and its scenarios for the same reason.
- **MODIFIED**: `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/tasks.md` — mark tasks 4.1, 4.2, 4.3, 4.4 (TUI adapter multiselect arm) as REMOVED with a one-line reference to this change. Keep the rest of its task list intact.
- **MODIFIED**: `AGENTS.md` — update the `bridge.ts` row to drop the TUI multiselect mention (it never worked in RPC mode), and the `multiselect-polyfill.ts` row to clarify that the legacy `ctx.ui.custom` fallback is **TUI-session only** and is also a no-op in dashboard headless mode (so the polyfill effectively only has one working path: bus-routed primary).
- **NEW**: `packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts` — repository-level lint test in the spirit of `no-direct-process-kill.test.ts` that scans `packages/extension/src/bridge.ts` and fails if the source contains the patterns associated with the regression: `originals.custom` AND `prompt.type === "multiselect"` within the same file. This ensures a future refactor cannot silently re-introduce the broken arm.

This change explicitly does **not** revert the bus-routed `ctx.ui.multiselect` patch, the `polyfillMultiselect` fallback chain, the client `{values}` encoder, or the schema cleanup — those are all working correctly.

**Trade-off, made explicit**: a *pure-TUI* session (no dashboard attached, agent calls `ask_user(method="multiselect")`) will now wait the full 5-minute PromptBus timeout and resolve to `undefined`. This was already the case under the regression (`source:"tui"` cancel fired immediately, but in TUI it shouldn't have hurt because there was supposedly a TUI overlay). In reality `ctx.ui.custom` is a no-op even in pi 0.70's RPC mode, so the legacy "TUI overlay" path was never delivering a working dialog in any dashboard-spawned session. We accept the timeout as graceful degradation: an honest "no answer" beats a dishonest "user cancelled".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bridge-extension`: REMOVE the (in-progress, not-yet-archived) requirement that the TUI adapter capture `ctx.ui.custom` for multiselect rendering. The bridge's `ctx.ui.multiselect` patch (also added by the previous change) stays.
- `multiselect-dialog`: REMOVE the (in-progress, not-yet-archived) requirement that the TUI adapter handle multiselect via the `MultiSelectList` overlay. The "Bridge routes `ctx.ui.multiselect` through PromptBus" and "Dashboard encoder JSON-stringifies multiselect `values`" requirements stay.

## Impact

- `packages/extension/src/bridge.ts` — three line-range removals (import, originals.custom capture, TUI multiselect arm)
- `packages/extension/src/__tests__/multiselect-dashboard-routing.test.ts` — replace two source-regression assertions with one inverse guard
- `packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts` — new repo-level lint
- `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/specs/bridge-extension/spec.md` — remove one Requirement + scenarios
- `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/specs/multiselect-dialog/spec.md` — remove one Requirement + scenarios
- `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/tasks.md` — mark §4 tasks as superseded
- `AGENTS.md` — two row clarifications
- `CHANGELOG.md` `## [Unreleased]` — supersede note attached to the previous change's entry

No protocol break. No data migration. No client-side changes (the `MultiselectRenderer` and the `prompt-answer-encoder` are unaffected and continue working). The only behaviour delta is "pure-TUI multiselect session times out at 5 minutes instead of cancelling at <1 second" — which is the *correct* behaviour given that pi 0.70 RPC mode never had a working `ctx.ui.custom` to begin with.

## References

- pi-coding-agent RPC mode `ctx.ui.custom` source: `~/.nvm/.../@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-mode.js:150-152` — three lines: `async custom() { /* Custom UI not supported in RPC mode */ return undefined; }`.
- Previous change: `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/` — Layer 1 partial fix; this change supersedes its TUI-adapter pieces only.
- Live evidence (user 2026-04-30): screenshot showing dialog appearing with `Opció 1`–`Opció 5` checkboxes, then `<1s` later the same dialog showing `Multiselect példa  Answered in terminal` greyed out, while the agent text reports `Úgy tűnik, megszakítottad a választást (nem érkezett válasz)`.
- `packages/extension/src/bridge.ts:891-905` — current location of the offending `else if` arm (line numbers approximate; the `prompt.type === "multiselect"` substring is unique in this file).
