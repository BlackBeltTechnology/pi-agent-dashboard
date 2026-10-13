## Context

Shared method: `retro-ux-identity-connectivity` design.md (D1–D5). This file records only what differs.

Hosts touched by #834: `CommandInput.tsx` (composer picker), `useOpenSpecRunConfigRow.tsx`, `CreateAutomationDialog.tsx`, `BlackholeSettings.tsx` and `ChainEditor.tsx`, `GrammarSettings.tsx`, `RolesSettingsSection.tsx`, plus the primitive `ModelSelector.tsx` and `useRolePick.ts`.

## Decisions

### D1. Board = primitive plus host matrix
Row 1 shows the primitive in every state. Rows 2 and on show each host trigger holding the same three refs (a concrete model, `@role`, an unbound `@role:level`), so any differences between hosts are visible at a glance.

### D2. Shared role-ref display: `RoleRef` in `dashboard-plugin-runtime` (approved)
`RoleRef` is presentational (strings in, markup out, no fetch), so it is a direct export of `@blackbelt-technology/dashboard-plugin-runtime` (`src/RoleRef.tsx`), the same route `SlotPill` takes. The client (`ModelSelector`) and the roles and Blackhole plugins all already depend on the runtime. It is NOT a `plugin-ui-primitive-registry` key: that spec forbids plugins from calling `useUiPrimitive` to render their own state, and the roles page and chain summary render their own state.
Props: `role` (`@name`), `model?` (`provider/id`), `level?`, `mode?: "follows" | "once"`. `follows` renders the role token, the model id and a level chip; `once` renders the model id and "from @role". The provider prefix is in the DOM as visually hidden text, so the accessible name and `textContent` keep `provider/id` (existing assertions such as `ModelSelector.test.tsx:557` and `OpenSpecRunConfig.test.tsx:64` keep passing) while the visible text stays short. An unresolved role renders the warning pill "No model assigned".

### D3. Composer scope is the picker only
`CommandInput.tsx` has 17 palette classes, mostly in older composer code. This change touches only the model-picker trigger and its dropdown. The rest of the composer is a separate review.

### D4. Two role semantics are made visible
Hosts that store `@role` (grammar, automation, Blackhole base and chain slots, the roles page) **follow** the role and show the role token; hosts that resolve once (`useRolePick`: composer, OpenSpec run-config) show the concrete model with "from @role". Before this change both showed the same `→` string or a 10 px "via" hint.

### D5. Model list: combobox + grid
Rows hold a ★ button, so `role="listbox"`/`option` is invalid (interactive content inside an option; same lesson as the identity-connectivity server selector). The APG combobox-with-grid-popup pattern keeps typing in the filter, moves rows with ArrowUp/Down via `aria-activedescendant`, and reaches the ★ cell with ArrowRight. Existing Enter/Escape handling and `data-testid="model-row"` stay.

### D6. One status and notice vocabulary
`ok` shows nothing; `detached` → "Detached"; `dangling` → "Role unassigned, keeps its last model"; unassigned → "No model assigned". Level drops read "Thinking level X isn't supported by MODEL, so the level was dropped." in the roles editor and the chain editor ("dropped" is the word `blackhole-plugin-settings` already pins); the one-shot pick keeps its own wording because the level is left unchanged there, not cleared.

### D7. Copy changes that break assertions on purpose
Listed in task 3.10. `data-testid`s and `data-status`/`data-kind`/`data-role` attributes are unchanged, so most tests keep working.

### D8. Pinned copy is reused where the approval allows
The roles setup banner keeps "No roles have been set up — set up now" (pinned by `dashboard-roles-ownership`), the level-drop word stays "dropped" (pinned by `blackhole-plugin-settings`), and the "Unsaved" pill is the base requirements' "dirty marker". "+ Add model" and the `?` capability marker are replaced, so `roles-settings-ui` "Global role→model assignment" and `model-selector` "capability badges with confidence" are MODIFIED.

Note: OpenSpec refuses renamed scenarios inside MODIFIED blocks, so "Assumed capability shows question marker" keeps its name while its body now requires the word "assumed".

Note: the approval record numbers decisions 1–8; they map to findings R1–R16 in `ui-plan.md`, not to these design numbers.

## Risks / Trade-offs

- [Shared component in the runtime] → presentational only; a runtime import of the client is forbidden (runtime boundary), so `RoleRef` must not import from `packages/client`.
- [~8 hosts change at once] → each host keeps its test ids; L1 tests per host plus one L3 cross-host comparison.
- [`retro-ux-plugin-settings-forms` also adds files to the runtime] → no overlap (`settings-fields.tsx` vs `RoleRef.tsx`); both add an export to `src/index.ts`, resolved at rebase.

## Migration Plan

None. Rollback is a revert.
