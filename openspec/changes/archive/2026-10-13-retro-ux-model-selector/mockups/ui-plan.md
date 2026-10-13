# UI plan — retro-ux-model-selector

Mode: **preserve** (`anti-slop-redesign`). Profile: `product-ui`. Contract: root `ui-contract.md`. Method: `retro-ux-identity-connectivity` design D1–D5.
Board: `model-selector.html`. `tokens.css` is GENERATED (copied from the sibling retro changes). Proposed recipes in `mockup.css` are scoped to `.col.proposed` so the as-built replica (`asbuilt.css`, `.ab`) stays faithful.

## Surfaces → states

| Surface | Source | States (fixture ids) |
|---|---|---|
| Picker dropdown | `client/src/components/settings/ModelSelector.tsx` | `models`, `favs`, `nomatch`, `refreshing`, `empty`, `errors`, `roles`, `noroles` |
| Role ref in host triggers | `ModelSelector` trigger + `lib/roles/useRolePick.ts` + hosts: `chat/CommandInput.tsx`, `openspec/useOpenSpecRunConfigRow.tsx`, `grammar-plugin/GrammarSettings.tsx`, `automation-plugin/CreateAutomationDialog.tsx`, `blackhole-plugin/{ChainEditor,BlackholeSettings}.tsx` | `persistent` (assigned, unassigned), `once`, `notice`, `runconfig`, `automation`, `chain` |
| Roles settings | `roles-plugin/RolesSettingsSection.tsx` | `pills`, `setup`, `editor` |

Two role-ref semantics exist and the as-built UI does not tell them apart:
- **follows** (persistent `@role` stored): grammar, automation, Blackhole base + chain slots, roles page. Shown as `@fast → anthropic/claude-haiku-4-5 · low` in a 200 px truncated mono line.
- **once** (resolved at pick time, `useRolePick`): composer, OpenSpec run-config. Shown as the concrete model + "via @fast" at 10 px muted.

## Findings → rule → proposed decision

| # | Surface | As-built (cite) | Rule broken | Proposed |
|---|---|---|---|---|
| R1 | all hosts | role ref rendered 5 different ways (trigger `→ … · low`, Role tab `model · level`, chain summary 2 spans, roles pill `:level`, Used-by `owner · label`) | Nielsen #4 consistency | one **RoleRef** display: `@role` token (mono, bordered), model short name, level chip; full `provider/id` + level in `title` / accessible name |
| R2 | trigger | 200 px truncation cuts the model out of `@fast → anthropic/claude-haiku-4-5 · low` | Nielsen #1, #6 | RoleRef in the trigger: role token, short model id, level chip; provider moves to the title/accessible name |
| R3 | one-shot hosts | "via @fast" 10 px `--text-muted` | WCAG 1.4.3; type floor | "from @fast" 12 px `--text-secondary` |
| R4 | unassigned | picker "unassigned" `text-amber-400` 10 px; persistent trigger shows bare `@research`; Blackhole "role unassigned — keeping last model"; roles page "+ Add model" | palette ban; one state, four words | warning pill "No model assigned" everywhere; Used-by/chain "Role unassigned, keeps its last model" |
| R5 | statuses | Blackhole `detached — edited outside the dashboard`, Used-by `(detached)` / `(dangling)` raw codes | Nielsen #2 | warning pills "Detached" / "Role unassigned, keeps its last model"; reason + "Reattach to @coding" in a warning callout |
| R6 | notices | role-pick notices `--severity-warning-fg` text on page bg (fails nord 4.36:1); level-drop boxes with emoji `⚠️`/`⚠` and three phrasings | contrast; consistency | warning callout with icon; one sentence "Thinking level X isn't supported by MODEL, so the level was dropped." |
| R7 | picker rows | rows are `div onClick`; star `<button>` nested; keyboard only via the filter input with no `aria-activedescendant`; current model = `--accent-blue` text | WCAG 4.1.2, 1.4.3 (accent-as-text) | APG combobox + **grid** popup: rows `role="row"`, model + capabilities + star as gridcells, `aria-activedescendant`, current = check icon + `aria-selected` |
| R8 | picker | star + Favs toggle `text-amber-400` / `border-amber-400`; star aria-label hardcoded English | palette ban; i18n | star 32 px in `--text-primary` (filled vs outline carries state), translated name "Favorite <model>"; Favs toggle pressed = tint-blue, label "Favorites only" |
| R9 | picker meta | provider header 10 px `--text-tertiary`; `provider/id` sublabel 10 px muted; ctx chip + capability icons muted; `?` 9 px | type floor; WCAG 1.4.3 | header 12 px semibold `--text-secondary` (section-heading recipe; raised from the board's first 11 px in doubt-review cycle 2, re-probed 0); sublabel 11 px secondary; "assumed" text instead of `?`; sr-only capability text |
| R10 | picker states | refreshing muted text; "Close and reopen…" 10 px muted; footer 11 px muted; recovery link `--accent-blue` text | contrast; accent-as-text | `role="status"` spinner line; empty state headline + help + secondary "Open provider settings" button; footer warning pill + ghost "Open providers" button |
| R11 | tabs | Model tab has no `tabpanel`; tabs ~20 px tall | WCAG 4.1.2; tap-target | both panels `role="tabpanel"` + `aria-controls`; 32 px tabs; labels "Models" / "Roles" |
| R12 | trigger | `aria-haspopup="true"` (menu) for a dialog-like popover; ~20 px tall | ARIA; tap-target | `aria-haspopup="dialog"`, `role="dialog"` panel with a name; 44 px below `sm`, 32 px from `sm` |
| R13 | roles page | `@role` in `--accent-blue`/70 (accent-as-text), model `--text-muted`, `:level` accent/70; headings 10 px muted | contrast; type floor | RoleRef in pills; selected = tint-blue; section headings 12 px semibold secondary; subheading becomes 12 px help text |
| R14 | roles page | setup banner + unsaved dot use `var(--accent-warning, #f59e0b)` — **`--accent-warning` is defined nowhere**, so the hex always paints | hex ban (fallback always paints) | warning callout; "Unsaved" warning pill (text, not a dot) |
| R15 | automation dialog | "Thinking level comes from @coding — set it in Settings → Roles." does not say the model follows too | Nielsen #1 | "Follows @coding: model and thinking level change when the role changes. Edit it in Settings → Roles." |
| R16 | Blackhole | `BlackholeSettings.tsx:615,624,648` severity tokens with hex fallbacks (`#ef4444`, …) | hex literals (never paint: tokens defined) | drop the fallbacks |

## Protected (preserve)

`@role[:level]` grammar and every persisted value; `data-testid`s: `model-selector`, `model-selector-button`, `model-dropdown`, `model-filter`, `provider-filter`, `favs-only-toggle`, `model-row`, `model-fav-toggle`, `group-provider`, `model-empty`, `model-empty-refreshing`, `model-provider-settings-link`, `model-refresh-errors`, `model-tab-model`, `model-tab-role`, `role-list`, `role-row` (+ `data-role`), `role-resolution`, `role-unassigned`, `model-via-role`, `role-pick-notice` (+ `data-kind`), `run-config-*`, `grammar-llm-model-selector*`, `create-model-*`, `blackhole-chain-*` (+ `data-status`), `roles-*` (+ `data-status`); open-triggered refresh; favourites persistence; localStorage view state; Arrow/Enter/Escape keys in the filter; portal + flip positioning; the `ui:model-selector` public props.

## Verdicts

| Surface | Verdict |
|---|---|
| Picker dropdown | polish (R7–R12) |
| Role ref in hosts | redesign (R1–R6, R15) |
| Roles settings | polish (R13, R14) |
