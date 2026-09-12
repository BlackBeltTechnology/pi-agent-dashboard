# UI Plan — blackhole-model-picker-chains

Surface → tokens → states for `blackhole-model-picker-chains`.
Token authority: the `theme-system` skill + `packages/client/src/index.css`.
Mockup: `index.html` · states `registry=ok|pending|empty|unavailable` · `theme=dark|light`.

## Surface

Plugin settings section: `/settings/plugins/blackhole` (`packages/blackhole-plugin/src/client/BlackholeSettings.tsx`), specifically the **Base model** control and the **Worker models** fallback chains (`ChainEditor.tsx`).

## GROUND findings (shipped code & design decisions)

1. **ModelSelector and ThinkingLevelSelector primitives**:
   - Live in `packages/client/src/components/settings/ModelSelector.tsx` and `ThinkingLevelSelector.tsx`.
   - Exposed to plugins through `useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector)` and `useUiPrimitive(UI_PRIMITIVE_KEYS.thinkingLevelSelector)`.
   - ModelSelector trigger displays `provider/id` (or placeholder), with icon and chevron. Popover supports provider filtering, search, favorite toggling, capability badges (reasoning, context window).
   - In `pending`, `empty`, `unavailable` states, the primitive is **not mounted** (to avoid the shell primitive's autonomous catalogue recovery behavior). Instead, stored `provider/id` is rendered as plain text (`data-testid="blackhole-chain-<worker>-<i>-model"`), and add / base-model buttons render as disabled.
2. **Thinking Level Override**:
   - The shell primitive has no `inherit` state. Design D4 introduces a plugin-local checkbox: "Override thinking level".
   - Unchecked: thinking level is omitted from JSON payload (inherits blackhole default), displays subtle `(inherit)` text.
   - Checked: reveals `ThinkingLevelSelector` dropdown (`off|minimal|low|medium|high|xhigh`).
   - If a picked model has no reasoning support (`reasoning: false`), thinking drops to `["off"]` and a level-drop notice appears.
3. **Base Model**:
   - Single model picker row positioned above the worker chains.
   - Provides a "Clear" button that writes `baseModel: null`.
   - Any selection or clear is instantly reflected in all worker tails (`then base model · <id> → session model`).
4. **Recommended Defaults Action**:
   - One-click action staging up to 3 flash-class models (`flash` → `haiku` → `mini`) across distinct providers.
   - If any chain is currently non-empty, clicking opens a confirmation dialog before staging.
5. **Empty Chain State**:
   - When a worker chain has 0 entries, displays `blackhole-chain-<worker>-empty` stating the worker resolves to the base/session tail only, with an `+ Add model to <worker> chain` button beneath.

## Tokens (authoritative `index.css`)

| Element | Token | Dark | Light |
|---|---|---|---|
| Page background | `--bg-primary` | `#0c0e12` | `#f6f8fa` |
| Section / Card surface | `--bg-secondary` | `#14171f` | `#ffffff` |
| Input / Inset surface | `--bg-tertiary` | `#1c212c` | `#eef1f5` |
| Hover state | `--bg-hover` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.04)` |
| Borders | `--border-secondary` / `--border-subtle` | `#2a3142` / `#1f2430` | `#d0d7de` / `#eaeef2` |
| Primary text | `--text-primary` | `#f0f3f6` | `#1f2328` |
| Secondary text | `--text-secondary` | `#9aa4b2` | `#59636e` |
| Tertiary / Muted text | `--text-tertiary` | `#636d7e` | `#8c959f` |
| Brand accent | `--accent-primary` | `#3b82f6` | `#0969da` |
| Severity Info | `--severity-info-bg` / `-border` / `-fg` | color-mix tuned | color-mix tuned |
| Severity Warning | `--severity-warning-bg` / `-border` / `-fg` | color-mix tuned | color-mix tuned |
| Severity Error | `--severity-error-bg` / `-border` / `-fg` | color-mix tuned | color-mix tuned |
| Focus ring | `--focus-ring` | `rgba(59,130,246,0.6)` | `rgba(9,105,218,0.4)` |

## States

| id | Registry State | Base Model | Worker Chains | UI Behavior |
|---|---|---|---|---|
| A | `ok` (Default) | Configured (`gemma-4-31b-it`) | Populated | All pickers interactive, Add buttons active, Defaults active. |
| B | `ok` (Empty chains) | Unset | 0 entries (empty state) | Empty state messages shown, tails say `base model (unset)`, Add button active. |
| C | `pending` | Stored | Stored | Loading skeleton / spinner, pickers replaced by plain text, buttons disabled. |
| D | `empty` (0 models) | Stored | Stored | Callout banner "No credentialed models in registry", no retry button, controls disabled. |
| E | `unavailable` (503) | Stored | Stored | Callout banner "Model registry unavailable", Retry button present, controls disabled. |

## Layout & Accessibility Rules

- Minimum touch target: 44×44px or standard desktop compact density (32px) with ample click padding.
- Keyboard navigation: full Tab / Enter / Escape support for pickers, accordion details, add rows, and confirm modal.
- Text contrast: WCAG AA compliant (≥ 4.5:1 normal text, ≥ 3.0:1 UI components).
- Semantic tags: `<section>`, `<ol>`, `<li>`, `<details>`, `<summary>`, `aria-labelledby`, `role="group"`.
