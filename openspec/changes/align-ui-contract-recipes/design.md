## Context

See proposal.md, "Why". The approved board is `mockups/index.html`; its measurements, rubric and decisions are in `mockups/ui-plan.md`.

Current state that shapes the approach:

- **Plugin access.** Plugins reach shared UI only through the primitive registry: `useUiPrimitive(UI_PRIMITIVE_KEYS.x)`, with keys in `packages/shared/src/dashboard-plugin/ui-primitives.ts` and registration in `packages/client/src/main.tsx`. `dashboard-plugin-runtime` (the settings field kit) does not depend on `client-utils`.
- **`ui:status-pill`** is `client-utils/src/StatusPill.tsx`. Props are `{ state, text, icon?, tooltip? }`, with states `running | success | info | warn | error | muted`. Colours come from two raw `rgba()` maps chosen by a `MutationObserver` on `data-theme`. With no `icon`, no glyph renders.
- **Already on the recipe.** Services `StatePill` (`services-ui.tsx:14`) and vault `StatusPill` (`vault-ui.tsx:64`) already use the severity triple via vault's `TONE_PILL` map. Services pulls `Callout`, `TONE_PILL` and `VIcon` from `vault-ui.tsx`, so the two pages already share code through a sideways import.
- **Guard coverage.** `scripts/theme-token-guard.mjs` has three arms: fallback-form, undeclared token and accent-as-text. None of them sees raw palette classes (`bg-red-600`) or `rgba()` in a `style` prop. The rule that does is the file-list scan in `message-severity-tokens`, "No raw colour literals on aligned action surfaces".
- **`Dialog.tsx` and its spec drift.** `dialog-system` "Dialog visual baseline" names `bg-black/60` and `z-[60]`. The code already sits on the `z-dialog` layer (`Dialog.tsx:110`).
- **Overlapping change.** `add-pi-spec-driven-schema` (in flight) MODIFIES `dialog-system` "Dialog action button intents" so the primary fill becomes `--accent-solid`.
- **File sizes.** `SettingsPanel.tsx` holds 39 raw palette or `rgba` hits outside the rail, and `OpenSpecBoardView.tsx` holds 20. Neither file can go on a whole-file no-literal list.

## Goals / Non-Goals

**Goals:**
- Give each of pill, notice and inline action error one implementation that both core and plugins render.
- Bring the three components fixed in code (dialog, session actions menu, settings rail) to the board's proposed state without changing their props, testids or behaviour.
- Put every new or changed recipe file under a rule that fails on a raw colour.

**Non-Goals:**
- Changing `ui:status-pill`'s or `ui:dialog`'s TypeScript props.
- Re-theming the non-rail parts of `SettingsPanel.tsx` or the rest of `OpenSpecBoardView.tsx`.
- New theme tokens. Every recipe resolves through existing `--severity-*`, `--tint-*`, `--bg-*`, `--text-*` and `--accent-*` tokens.

## Decisions

### D1. The shared parts live in `client-utils`; plugins reach them through the registry

`client-utils` gains `Notice.tsx` and `ActionError.tsx` next to the existing `StatusPill.tsx`. The registry gains `UI_PRIMITIVE_KEYS.notice = "ui:notice"` and `UI_PRIMITIVE_KEYS.actionError = "ui:action-error"`, each with typed props in the contract map, and `main.tsx` registers them. Core surfaces import the components directly. `vault-ui.tsx`'s `Callout`/`ErrorLine` and `services-ui.tsx`'s `ServicesOperateCallout`/`ActionFailure` become thin wrappers or are deleted at their call sites.

Wave 2's `SettingsStatusPill` and `SettingsNotice` in `dashboard-plugin-runtime` resolve through `useUiPrimitive`, so the runtime kit keeps no colour map of its own.

- *Alternative: the runtime package owns them.* Rejected. Core would import a plugin-facing package, and `client-utils` already holds `ui:status-pill`, so there would be two homes.
- *Alternative: plugins import `client-utils` directly.* Rejected. It bypasses the registry seam that keeps plugin bundles host-version-independent.

### D2. The pill's colours come from tokens via classes; the theme observer goes

`StatusPill` maps `state` to a tone (`running→info`, `success→success`, `info→info`, `warn→warning`, `error→error`, `muted→neutral`) and renders the contract classes (`--severity-<tone>-{bg,fg,border}`). Classes resolve per palette with no JS, so `useIsLightTheme` and its `MutationObserver` are deleted.

When `icon` is unset, each tone renders a default MDI icon: `CheckCircleOutline`, `InformationOutline`, `AlertOutline`, `AlertCircleOutline`, `CircleOutline`, plus a spinning `Loading` for `running`. Icons render inline from `@mdi/js` paths so they appear on first paint.

The raw state stays in `data-status-pill` (existing attribute). A new optional `testId` prop is not added: the props stay frozen, and callers that need a testid wrap the pill.

- *Alternative: keep inline styles, read CSS variables.* Rejected. `var()` inside `style` works, but it keeps a per-state JS map that duplicates the contract.

**Services glyphs.** `StatePill` uses text glyphs (`● ◐ ◆ ▲ □`), and its spec requires state to be readable without colour. The services wrapper passes its glyph meaning through `icon` keys mapped to MDI equivalents. Its label text and `data-state` stay unchanged, so its tests keep passing.

### D3. The notice's anatomy is fixed; the raw error is a prop, never children

Props: `{ tone, title, why?, remedies?: {icon, text}[], actions?: ReactNode, detail?: string, testId? }`.

- `detail` renders only inside a closed `<details>` "Technical details" with a "Copy details" button.
- `role` is derived from tone: `alert` for error, `status` otherwise.
- Vault's `ConfirmImpact` (an inline `alertdialog`) is **not** a notice and is out of scope; it already meets the dialog row's confirm-impact rules.

### D4. The inline action error takes a message plus optional detail

Props: `{ id, message, detail? }`. It renders the recipe line; `detail` (server code or raw text) is reachable only through "Copy details". Services `ActionFailure` currently prints the server code first. It moves the code into `detail` and keeps its message, its `testId` and the code's testid on the copy payload holder, so the visible sentence becomes the message alone.

- *Trade-off:* the server code is no longer visible text. Tests that assert the code's testid text change to read the copy payload. This is intended (Nielsen #2).

### D5. Dialog fixes stay inside `Dialog.tsx`'s existing structure

| Part | Change |
|---|---|
| Backdrop | `bg-[var(--bg-overlay)]` |
| Panel | `rounded-xl border-[var(--border-secondary)] bg-[var(--bg-secondary)]` + raised elevation |
| Title | `text-lg` |
| Icon tile | severity triple; tone follows the dialog's danger intent, otherwise info |
| Close button | 44 px below `sm`, 36 px from `sm` |
| `Dialog.Action` / `Dialog.Cancel` | contract button heights and `font-semibold`; danger = `--tint-red-{bg,fg,border}`; primary = `--accent-solid` + white text |

Behaviour is unchanged: portal, focus trap, dismissal, sizes and flush mode. Every consumer (`ui:confirm-dialog`, `ui:searchable-select-dialog`, every plugin dialog on the primitive) inherits the fix with no call-site edit.

**Overlap with `add-pi-spec-driven-schema`.** Both changes MODIFY "Dialog action button intents". Their primary scenario is word-for-word identical; this change additionally changes danger. Whichever change archives second re-copies the requirement from the archived main spec and re-applies only its own difference. The z-index scenario in "Dialog visual baseline" is corrected to the `z-dialog` layer the code already uses.

### D6. Menu fixes are class-level in `SessionActionsPanel.tsx`

- Group heading: 10 px becomes 11 px semibold.
- `ITEM_BASE`: `min-h-[30px]` becomes `min-h-[36px] max-sm:min-h-[44px]`.
- Plugin items: `--text-tertiary` becomes `--text-primary`.
- Disabled reason: the trailing 10 px span becomes a block line under the label (`text-xs text-[var(--text-secondary)]`), still linked through `aria-describedby`.

The `More…` count and the expander row follow the item recipe. Group taxonomy, NEXT logic, folding, hover intent, placement and test hooks are untouched. The board's trailing destructive "Exit session" item already exists in the SESSION group; it is not moved.

### D7. Rail fixes are scoped to the rail block, guarded by a scoped scan

Only the `settings-nav-rail` subtree in `SettingsPanel.tsx` changes:

- Item colours: `--text-muted` becomes `--text-secondary`.
- Current item: raw `bg-blue-600/15` becomes `bg-[var(--bg-tertiary)]` + a 3 px `--accent-primary` inset bar (`before:` pseudo-element).
- Group labels: `--text-tertiary` becomes `--text-secondary`, semibold.
- Sub-item controls lose `--text-muted` (`:1437`). The "promoted to another group" plugin rows (`:1460`, the branch that never sets `aria-current`) drop `opacity-60` + `--text-muted` and use `--text-secondary`. They keep their de-emphasis through the trailing "↗ <group>" hint, now 12 px `--text-secondary`.
- Attention dots become 14 px severity icons with an `aria-label`. The raw `bg-amber-400` goes.

The no-raw-colour check for the rail runs on the rendered `settings-nav-rail` element in a component test, not on the file.

### D8. Guards

- `theme-token-guard`: add `packages/client-utils/src` to `SCAN_ROOTS`, record its current findings as baseline entries, and fix the ones this change touches (for example `Dialog.tsx`), shrinking the baseline.
- The `message-severity-tokens` file list gains:
  - `client-utils/src/StatusPill.tsx`
  - `client-utils/src/Notice.tsx`
  - `client-utils/src/ActionError.tsx`
  - `client-utils/src/Dialog.tsx`
  - `session/SessionActionsPanel.tsx`
  - `settings/ProviderHealthPill.tsx`
  - `packages/plugin-row-parts.tsx`
  - `settings/services/services-ui.tsx`
  - `settings/vault/vault-ui.tsx`
  - `settings/vault/OperateRequiredCallout.tsx`

  The existing scan, `packages/client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts`, gains these paths. No new script is added.

### D9. Contract and skills are edited after the code

`ui-contract.md` rows are copied from the board's "All proposed contract rows" page and amended with anything implementation changes, so the contract never describes code that doesn't exist yet. The skill edits (slot taxonomy, host design, mockup-loop binding) come last and only reference contract rows.

## Risks / Trade-offs

- **[Visual shift in every non-base palette]** Pills, dialogs and the rail change colour in 8 palettes. → Intended. Screenshots in base dark, base light and nord dark are attached to the PR, and the probe gates contrast.
- **[Default pill icons crowd tight rows]** For example `plugin-row-parts` in the plugin list. → A 14 px icon plus `gap-1`. The board measures it; the R8 overflow recipe is applied where a row wraps.
- **[`Dialog` restyle touches every dialog at once]** → No prop or behaviour change. Existing `Dialog.*.test.tsx` suites plus a new class-level test. A Playwright capture of one dialog per size on the harness.
- **[Merge conflict with `add-pi-spec-driven-schema` on `Dialog.tsx` and its spec]** → D5 rebase rule. The code change to the primary fill is one class, so the second change drops it if already present.
- **[Wave 2 already planned its own pill and notice]** → Wave 2's artifacts are amended in a separate, user-approved step. Until then the contract row names the shared parts, and wave 2's apply-time review catches a drift.
- **[Plugins pinned to an older host]** A plugin calling `useUiPrimitive("ui:notice")` against an old host gets no component. → The existing registry contract already handles missing keys; plugins must guard as they do for any new primitive.
- **[Tests asserting `rgba` inline styles on `StatusPill`]** → Updated to assert the tone class. The change is intended.

## Migration Plan

Client-only, with no protocol, settings or persisted-state change. The order lets each step be verified alone:

1. Primitives and registry keys.
2. Status pill retheme.
3. Notice and inline error.
4. Services and vault migration.
5. Remaining pills.
6. Dialog.
7. Menu.
8. Rail.
9. Guards.
10. Contract.
11. Skills.

Rollback is a revert; there is no data to migrate.

## Open Questions

- `ProviderHealthPill` renders a multi-line error under the pill (`provider-error-line`). Should that line become an inline action error or a notice? Either fits the specs, which only require the pill to use the shared recipe. Decide while implementing, after reading its call sites.
