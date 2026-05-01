## Context

The previous change `fix-multiselect-auto-cancel-on-dashboard` correctly diagnosed that pi's `ExtensionUIContext` has no native `multiselect` method, and added a bridge-routed `ctx.ui.multiselect` patch that dispatches `bus.request({ type: "multiselect", ... })` so the dashboard's already-existing `MultiselectRenderer` can render the dialog. That part works end-to-end.

It also added — out of caution that "tisztán TUI sessions ne vesszenek el" — a multiselect arm to the bridge's TUI PromptBus adapter, intended to use the captured original `ctx.ui.custom` to render a `MultiSelectList` overlay in the terminal when `ctx.hasUI === true`. The plan was that on dashboard sessions the dashboard adapter would race-win, and on pure-TUI sessions the TUI adapter would render a working terminal overlay.

This plan rested on an assumption that **pi 0.70 RPC mode supports `ctx.ui.custom`**. It does not. The `~/.nvm/versions/node/v22.22.0/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/rpc/rpc-mode.js:150-152` source reads literally:

```javascript
async custom() {
    // Custom UI not supported in RPC mode
    return undefined;
},
```

Every dashboard-spawned headless session runs `pi --mode rpc`, so `originals.custom` is bound to this no-op. When the TUI adapter's multiselect arm awaits it, the promise resolves *immediately* with `undefined`, the arm interprets this as "user cancelled with Escape" and calls `bus.respond({ id, cancelled: true, source: "tui" })`. The PromptBus enforces first-response-wins across adapters, so the dashboard's already-rendered `MultiselectRenderer` is dismissed via `prompt_dismiss` before the user can click any checkbox. Total lag from dialog appearance to dismissal: < 1 second (one event-loop tick).

The user attached photographic evidence (2026-04-30): the dialog appears, then 1 second later the same dialog is greyed out with "Answered in terminal" status, and the agent reports "Úgy tűnik, megszakítottad a választást (nem érkezett válasz)".

## Goals / Non-Goals

**Goals:**

- Stop the auto-dismiss. After this change, a multiselect prompt on a dashboard headless session must reach the user, stay visible until the user clicks Submit or Cancel, and round-trip the selected `string[]` (or `[]` for empty selection, or `undefined` for cancel) back to the agent.
- Preserve the rest of `fix-multiselect-auto-cancel-on-dashboard`'s working pieces unchanged: the bus-routed `ctx.ui.multiselect` patch, the `polyfillMultiselect` fallback chain, the client `{values}` JSON encoder.
- Pin the regression with an inverse-guard repo lint so the offending `originals.custom`-with-multiselect pattern cannot be silently re-introduced.
- Keep the in-progress previous change archivable. Edit *its* spec deltas in place rather than creating an orphan "REMOVED Requirement" delta in this change — neither change has been archived yet, so the requirements never enter the base specs and the cleanup is local.

**Non-Goals:**

- Restoring multiselect on pure-TUI (no-dashboard) sessions. With pi 0.70 RPC `custom` being a no-op and the only realistic delivery path being the bus-routed dashboard adapter, there is no working in-tree way to render a multiselect overlay in a terminal that is not also paired with a dashboard. We accept the 5-minute timeout to `undefined` as graceful degradation. (The "TUI-only multiselect" use case was never actually exercised by anyone in this codebase; the test fixtures all set `ctx.hasUI = false` or mock `ctx.ui.custom` directly.)
- Patching pi-coding-agent upstream to make `ctx.ui.custom` actually work in RPC mode. That is a separate concern, would require coordinating with `@mariozechner`, and is unrelated to the user-visible bug.
- Rewriting the polyfill fallback chain. The current `if (typeof ctx.ui.multiselect === "function") { ... } else { ctx.ui.custom(...) }` shape is fine; the legacy `else` branch is now functionally dead in dashboard contexts but harmless. Removing it would make the polyfill less robust against future pi-coding-agent versions that *do* implement `custom` in RPC mode.

## Decisions

### Decision 1: Drop the TUI arm entirely instead of trying to detect RPC mode

Three options were considered:

| Option | Pro | Con |
|---|---|---|
| **(A) Drop the arm** | One-line removal in source, one-line addition to lint. Removes the entire failure mode. | Pure-TUI sessions lose multiselect (5-min timeout). |
| (B) Detect RPC mode and skip the arm | Theoretically preserves pure-TUI multiselect. | No clean detection API. Heuristic ("if `originals.custom` resolves synchronously to `undefined`, it's RPC") is timing-dependent and brittle. Adds machinery for a use case nobody exercises. |
| (C) Keep the arm but never `bus.respond` on `undefined` | Looks safe. | Indistinguishable from "user pressed Escape on TUI MultiSelectList" — would silently swallow legitimate cancels. Worse than (A). |

Choosing **(A)**. The pure-TUI degradation is acceptable per the Non-Goals. The complexity savings of (A) over (B) are large (a dozen lines of detection logic vs. a deletion).

### Decision 2: Edit the previous change's spec deltas in place, not write "REMOVED" in this change

The previous change `fix-multiselect-auto-cancel-on-dashboard` is `in-progress` (32/42 tasks). Its spec deltas under `openspec/changes/fix-multiselect-auto-cancel-on-dashboard/specs/` haven't been merged into the base `openspec/specs/` yet — that happens at archive time. So the "ADD Requirement: TUI adapter handles multiselect" line currently lives only in the in-progress delta file and has not yet entered the base spec.

If we wrote a "REMOVED Requirement: TUI adapter handles multiselect" delta in *this* change, the OpenSpec validator would complain because no such requirement exists in the base spec. The clean alternative is to edit the previous change's delta file directly — which is what this change does.

This is precedented: when a sibling in-progress change reveals that an earlier in-progress change's spec drafted a wrong requirement, the editor of the second change is expected to delete the wrong requirement from the first change's deltas, with a note in this change's tasks linking the two.

### Decision 3: Keep `multiselect-list.ts` and the polyfill's legacy fallback branch

Even though the legacy `ctx.ui.custom` + `MultiSelectList` fallback is functionally a no-op on pi 0.70 RPC, removing it would be a net loss:

- A future pi version may implement `ctx.ui.custom` in RPC mode (the comment "Custom UI not supported in RPC mode" reads as a known limitation, not a permanent design choice).
- A non-bridge embedding of `polyfillMultiselect` (e.g. another extension, or a downstream packager that uses `multiselect-polyfill.ts` directly) would lose its only fallback.
- The legacy branch costs nothing — it's unreachable when `ctx.ui.multiselect` is patched.

So we keep `multiselect-list.ts` and the polyfill's `else` branch unchanged.

### Decision 4: Use a lint test, not a comment, to prevent re-introduction

The TUI multiselect arm was reasonable on paper — "let's race the dashboard adapter against a terminal overlay". A future contributor could easily add it back. A `// DO NOT add a TUI multiselect arm` comment is fragile.

A repo-level lint test (`packages/extension/src/__tests__/no-tui-multiselect-arm-regression.test.ts`) that scans `bridge.ts` and fails on the offending pattern co-occurrence is robust, mirrors the existing `no-direct-process-kill.test.ts` and `no-raw-node-import.test.ts` precedents, and gives the contributor a clear failure message ("this pattern was removed in fix-multiselect-tui-arm-self-cancel because pi 0.70 RPC `ctx.ui.custom` is a no-op").

The lint matches if both substrings appear in `bridge.ts` *together*: `originals.custom` AND `prompt.type === "multiselect"`. Either alone is fine (e.g., `originals.custom` could come back if a future pi makes it work; `prompt.type === "multiselect"` is fine inside `(ctx.ui as any).multiselect = ...` patch). The combination is what we ban.

### Decision 5: Do not modify the `polyfillMultiselect` runtime debug logs added during diagnosis

The `[bridge.multiselect]` and `[multiselect-polyfill]` `console.warn` calls added during diagnosis are noisy but harmless. They can be removed in a follow-up cleanup change once we have several days of confidence that the fix holds. Keeping them in the first ship gives us a fallback diagnostic if the fix turns out to be insufficient.

(Update: removed by the previous change's `tasks.md §9.4` smoke-test loop. If they're still in `multiselect-polyfill.ts` at this change's pre-archive step, this change's `tasks.md §6` removes them as part of its cleanup.)

## Risks / Trade-offs

- **[Risk] Pure-TUI sessions lose multiselect** → Mitigation: explicitly accepted as graceful degradation. The legacy fallback was already a no-op in pi 0.70 RPC, so users running pure TUI today either weren't getting a multiselect anyway, or were getting one through some other (unmeasured) path. Once a future pi version restores `ctx.ui.custom` in RPC, the polyfill's legacy `else` branch will start working again automatically — no further code change required on our side.

- **[Risk] The lint test pattern is too strict / too loose** → Mitigation: the test asserts the *co-occurrence* of two specific strings. False positives are unlikely (the pattern is highly specific); false negatives (a future arm that uses different variable names) are possible but the test docstring documents the rule and the regression scenario clearly enough that a contributor reading it during a lint failure will understand and adapt.

- **[Risk] Editing the previous change's spec deltas creates cross-change history confusion** → Mitigation: this change's `tasks.md` explicitly lists the edits with file paths and one-line rationale. The previous change's `tasks.md` gets a "superseded by fix-multiselect-tui-arm-self-cancel" annotation on its §4 tasks. A future archivist working on either change will see the cross-link.

- **[Risk] The user expects the `ctx.ui.custom` legacy path to work and is surprised when pure-TUI multiselect times out** → Mitigation: AGENTS.md's `multiselect-polyfill.ts` row gets clarifying language ("legacy fallback is a no-op in pi 0.70 RPC mode and TUI-only sessions; effectively unreachable in dashboard sessions"). The CHANGELOG entry for the supersede mentions the trade-off explicitly.

- **[Risk] A subsequent fix to the previous change's `tasks.md §9.7` (live OpenAI test) re-validates body-level `oneOf` and we discover OpenAI accepts it after all** → unrelated to this change's scope; if it happens, a separate change re-adds the schema's `oneOf`. This change is purely about the runtime arm.

## Migration Plan

This change is a single-extension refactor with no protocol or data-model changes. Migration is:

1. Land this change.
2. Reload all connected pi sessions (`npm run reload` from the dashboard repo) so the bridge picks up the new code.
3. New sessions automatically get the fixed bridge.
4. No persisted state needs migration. No browser-side changes. No restart required for the dashboard server.

Rollback: `git revert` of this change's commit and `npm run reload` again. The previous change's other (working) pieces are unaffected by either direction.

## Open Questions

- **Should we also remove `multiselect-list.ts` from the extension package's tree-shaking root**, since the polyfill's legacy branch that uses it is now functionally dead in dashboard contexts? Probably not — it's a 122-line file with no runtime cost when unused, and it preserves option-value for future pi versions that fix `custom` in RPC mode. Leave it.

- **Should `polyfillMultiselect` log a warning when it falls into the legacy branch?** Could be useful for diagnosing "why is my multiselect timing out" if a future pi version regresses on `ctx.ui.multiselect`. Out of scope for this change; reasonable follow-up.

- **Should the live smoke tests from the previous change's `tasks.md §9.3-§9.7` be re-run after this change?** Yes — they are explicitly listed as cleanup in this change's tasks because they exercise the end-to-end path that this change unblocks.
