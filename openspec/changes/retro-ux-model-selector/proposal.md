## Why

#834 (`add-role-aware-model-refs`) shipped `@role[:level]` model refs across the UI without a mockup. It added a Role tab to the shared `ModelSelector` (+164 lines), a role-binding status in `RolesSettingsSection`, and role-aware pickers in about 8 hosts: the composer (`CommandInput`), the OpenSpec run-config row, `CreateAutomationDialog`, Blackhole settings and `ChainEditor`, grammar settings, and the roles settings page. One primitive appears in many contexts, so how a role ref reads (role name, resolved model, level, unbound or dropped-level notice) has to be the same everywhere. Contract breaks in the touched files (whole-file counts): `RolesSettingsSection.tsx` 5 palette classes and 2 hex, `ModelSelector.tsx` 4, `CreateAutomationDialog.tsx` 3, `BlackholeSettings.tsx` 3 hex. This is the fourth of four retro UX reviews.

## What Changes

- Mockup loop on develop, before the worktree (method: `retro-ux-identity-connectivity` design D1–D5). One board shows the `ModelSelector` primitive in every state plus each host's trigger in place, as-built replica and proposed version.
- States, as found while grounding: picker Models tab, favourites only, no match, refreshing, empty, provider refresh errors, Roles tab, no roles; role refs in hosts that **follow** a role (grammar, automation, Blackhole base and chain slots) and hosts that resolve a role **once** (composer, OpenSpec run-config), with unassigned, detached, dangling and level-dropped variants; roles settings pills, setup prompt, editor.
- A single role-ref display (role name, the model it resolves to, the level) used by every host trigger and by the roles settings "what follows each role" list.
- Contract conformance on the primitive, the roles settings section and the host triggers. The `CommandInput` scope is limited to the model-picker trigger and its dropdown, not the whole composer.
- Mockup: `mockups/model-selector.html` (in this change). Approved 2026-10-12, all 8 decisions; record in `mockups/audit.md`.
- Approved deltas: one `RoleRef` display (role token, short model id with the provider visually hidden, level chip) exported from `dashboard-plugin-runtime` and used by every role-ref surface; one-shot picks read "from @role"; one status vocabulary ("No model assigned", "Detached", "Role unassigned, keeps its last model") as warning pills, with reasons and "Reattach to @role" in callouts; role-pick and level-drop notices as warning callouts with one sentence; the model list as an APG combobox + grid with 32 px ★ cells and a check mark for the current model; picker states (status spinner, empty-state button, warning-pill footer, "Favorites only", "Models"/"Roles" tabs with tabpanels, 32/44 px targets, dialog semantics); the automation hint says the model and the level follow the role; baseline palette classes, the undefined `--accent-warning` hex, Blackhole hex fallbacks and 10 px / `--text-muted` information text moved to tokens.
- Protected: the `@role[:level]` grammar, persisted values, existing `data-testid`s (`ModelSelector`: `model-dropdown`, `model-filter`, `favs-only-toggle`…; `roles-*`; `run-config-*`; `grammar-llm-model-selector*`), and keyboard behaviour in the dropdown.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `model-selector`: MODIFIED "Selector SHALL provide a favorites filter and star toggles", "Model dropdown surfaces provider refresh failures", "Recovery link when genuinely empty", "Empty-and-errored state uses reopen-to-retry", "The model-selector primitive SHALL offer an opt-in Role tab", "Session model pickers SHALL resolve a role once", "Selector SHALL render capability badges with confidence"; ADDED shared `RoleRef` display, keyboard grid, UI-contract conformance.
- `role-model-bindings`: ADDED one binding-status vocabulary.
- `roles-settings-ui`: MODIFIED "Global role→model assignment" ("No model assigned" replaces "+ Add model"); ADDED UI-contract conformance (pills, Unsaved pill, callouts, headings, no `--accent-warning`).
- `blackhole-plugin-settings`: ADDED chain-slot role refs, level-drop callout, no hex fallbacks.
- `automation-content-view`: ADDED role hint naming both followed values.
- `grammar-settings-plugin`: ADDED readable model-required prompt.
- Pinned copy kept on purpose (design D8): the setup banner text (`dashboard-roles-ownership`) and the word "dropped" for level drops (`blackhole-plugin-settings`).

## Impact

- Client: `packages/client/src/components/settings/ModelSelector.tsx`, `packages/roles-plugin/src/RolesSettingsSection.tsx`, and the host triggers in `packages/client/src/components/chat/CommandInput.tsx`, `packages/client/src/components/openspec/useOpenSpecRunConfigRow.tsx`, `packages/automation-plugin/src/client/CreateAutomationDialog.tsx`, `packages/blackhole-plugin/src/client/{BlackholeSettings,ChainEditor}.tsx`, `packages/grammar-plugin/src/GrammarSettings.tsx`. New `packages/dashboard-plugin-runtime/src/RoleRef.tsx` (exported, like `SlotPill`), used by the client and the roles/Blackhole plugins. `ui-contract.md` and its derived `dashboard-plugin-scaffold/references/host-design.md` gain the `RoleRef` recipe.
- Tests: fixture `tests/e2e/fixtures/retro-ux/model-selector.ts` and `tests/e2e/retro-ux-model-selector.spec.ts` on the shared harness.
- Depends on `retro-ux-identity-connectivity` task 2.1.
- Rollback: a revert. No change to the stored format.

## Non-goals

- Role resolution, projection or the ref grammar.
- Restyling the rest of the composer.

## Discipline Skills

- `review-code`: before commit, since one primitive and about 8 hosts change.
- `doubt-driven-review`: on the shared role-ref display before it stands, because it becomes the one way roles are shown everywhere.
- No `performance-optimization`. The dropdown's catalogue refresh behaviour (`model-selector`: "Model list refresh on dropdown open") is unchanged.
