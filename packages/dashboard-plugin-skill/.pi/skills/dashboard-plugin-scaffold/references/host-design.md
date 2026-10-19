# Host design for plugin UI

Derived from root `ui-contract.md`; update together. This is the
plugin-author subset of the dashboard's design contract. The full contract
lives in the dashboard repo root and is not published to npm; this file is.

A plugin renders inside the dashboard shell (slots, content views, settings
sections). It must look like part of the host in every theme the host ships.

## The one rule: paint through host tokens

The dashboard ships 9 themes × dark/light = 18 palettes. The `base` theme is
declared in `packages/client/src/index.css`; the other 8 palettes overwrite
the **same token names** at runtime. Paint with the tokens below and your UI
follows every palette. A raw colour literal (`#hex`, `rgb(`, `hsl(`, or a
Tailwind palette class like `text-green-400`) is correct in at most one of
the 18.

Use them as CSS variables: `color: var(--text-primary)`, or in Tailwind as
arbitrary values: `text-[var(--text-primary)]`, `bg-[var(--bg-secondary)]`,
`border-[var(--border-secondary)]`.

## Surfaces, text, borders

| Role | Token |
|---|---|
| page surface | `--bg-primary` |
| raised surface / card | `--bg-secondary` |
| inset surface / chip | `--bg-tertiary` |
| control surface | `--bg-surface` |
| hover wash | `--bg-hover` |
| code surface | `--bg-code` |
| modal scrim | `--bg-overlay` |
| primary text | `--text-primary` |
| secondary text (labels, timestamps, counts) | `--text-secondary` |
| tertiary text | `--text-tertiary` |
| decoration only (disabled, `aria-hidden`) | `--text-muted` |
| hairline / divider | `--border-primary`, `--border-secondary`, `--border-subtle` |
| strong border | `--border-strong` |
| primary action | `--accent-primary` |
| link | `--link`, `--link-hover` |
| focus ring | `--focus-ring` |

## Severity and status

- Any state message, badge or callout uses the severity family
  `--severity-<level>-{bg,fg,border}` with level = error, warning, success,
  info, neutral. Example: `--severity-error-bg`, `--severity-error-fg`,
  `--severity-error-border`.
- Session lifecycle state uses `--status-working`, `--status-idle`,
  `--status-error`, `--status-needs-you` on **shapes and dots only**, never as
  text colour. Put the status word in `--text-secondary` beside an
  `aria-hidden` dot.
- A tint fg (`--tint-blue-fg`) is only painted on its own tint bg
  (`--tint-blue-bg`), as a filled chip or button, never on a card surface.

## Coloured text

- When text must carry a hue, use the accent-text tokens
  `--accent-<hue>-text` (hue = purple, blue, green, orange, red, yellow), e.g.
  `--accent-blue-text`, `--accent-red-text`. They hold WCAG-AA 4.5:1 on the
  host surfaces.
- Never paint text with the fill accents `--accent-<hue>`: they carry no
  contrast guarantee.
- Hue is a secondary cue. Back it with a word, icon or shape.

## Role refs

Show an `@role[:level]` reference with the runtime's `RoleRef` component
(`import { RoleRef } from "@blackbelt-technology/dashboard-plugin-runtime"`),
never with your own markup: role token, short model id (the provider prefix stays
in a `sr-only` span so the full `provider/id` is in the text content), level chip,
and — for a one-shot pick — "from @role". With no model value it shows the
warning pill "No model assigned". Pass your translated strings through `labels`.
Binding statuses use one vocabulary: `detached` → "Detached", `dangling` → "Role
unassigned, keeps its last model" (warning pills; `ok` shows nothing). A non-modal
popover (the model selector) is `role="dialog"` with `aria-modal="false"`, no focus
trap, Escape closes — the documented exception to the modal-dialog rule.

## Settings sections

Build a `settings-section` body from the runtime field kit
(`import { … } from "@blackbelt-technology/dashboard-plugin-runtime"`), never
from native `<input type="checkbox">` / `<select>` or your own label/hint markup:

- Fields: `ToggleField`, `SelectField`, `NumberField`, `TextField`,
  `TextAreaField`; `FieldShell` wraps a custom control. `hint` is required
  (`null` = none).
- Grouping and messages: `SettingsGroup` (collapsible; its summary meta is
  12 px — the documented exception to the 11 px meta step, because it sits in an
  interactive summary), `SettingsNotice` (info / warning / error / success; see
  "Status, notice and action errors" below).
- Read-only and repeated content:
  - `SettingsStatusPill` — tone (success / info / warning / error / neutral) +
    a human word, never a raw enum; icon is decoration (contract row: *status
    pill*).
  - `SettingsItem` — one card per profile / instance / server / binding;
    `collapsible` keeps title and status visible while collapsed.
  - `SettingsFacts` — read-only term/value `<dl>`.
  - `SettingsTable` — read-only table that scrolls horizontally.
- The host chrome already shows the plugin title, id, status and an "Enabled"
  switch: never repeat them in the body, and never label an in-body switch
  "Enabled" — name what it controls.
- Configuration goes through the host Save bar (`useSettingsDraftSource`);
  only side-effect actions (tokens, Connect, Start/Stop) save immediately, with
  an error notice scoped to the item that failed.

## Status, notice and action errors

One implementation each, the same for core and plugins — import from
`@blackbelt-technology/dashboard-plugin-runtime`, never rebuild them:

- **Status pill** — `SettingsStatusPill`. Tone + a human word; the raw state goes
  in `status` (`data-status`), never in the visible text. Pass `spinning` with
  `mdiLoading` for an in-progress state (it stops under `prefers-reduced-motion`).
  The `ui:status-pill` intent primitive renders this same pill. Contract row:
  *status pill*.
- **Notice** — `SettingsNotice`. A short title saying what happened, an optional
  one-sentence why, then `remedies` (icon + sentence rows, links allowed; filter
  out remedy kinds you do not recognise), then `onRetry` (set `retrying` while it
  runs: the button disables and the notice reports `aria-busy`) and `details`
  ("Copy details": codes, HTTP status, bodies and stacks are copied, never
  rendered). Error tone announces as an alert, the others as a status. Contract
  row: *notice*.
- **Inline action error** — `SettingsActionError`. When an action the user can
  retry in place fails, show one plain sentence directly under the control that
  failed, point that control's `aria-describedby` at the error's `id` (unique per
  page), and put server codes in `details`. Do not report it only as a toast.
  Contract row: *inline action error*.

## Dialogs

Open a dialog with the `ui:dialog` primitive, never a hand-built overlay: it
supplies the scrim (`--bg-overlay`), the card-recipe panel, the title, the 44 px
close button, the focus trap and Escape handling. Footer: Cancel, then one action —
primary (`--accent-solid`) or danger (the `--tint-red-*` triple, never a raw red
fill). A destructive confirm names every item it affects and starts any risky
option unchecked. Contract row: *dialog*.

## Overlay pages and slot widgets

- **Overlay page** (`shell-overlay-route`, a full-screen route): receives `onBack`,
  so always offer a back control; paint on the page surface (`--bg-primary`) and
  build forms from the settings kit. A failed load is an error notice, not an
  empty state; show a skeleton while loading. Contract rows: *section heading*,
  *notice*, *loading / empty / first-run*.
- **Slot widget** (badges, action-bar buttons, folder and card sections): keep to
  the slot's compact footprint. A row of one primary text plus trailing chips
  wraps and truncates the text first (never clips a chip); chips are pills in a
  severity or tint triple; touch targets are 44 px below `sm`. Pick the slot from
  `slot-taxonomy.md` before designing. Contract rows: *chip / pill*, *action chip*,
  *row overflow*.

## Both modes

Every plugin surface works in dark and light. Check both, plus one non-`base`
palette, before shipping. Never branch on the theme in code to pick colours;
the tokens already switch.

## What a plugin must not add

- No own theme, palette, or `data-theme` handling.
- No own font stack or `@font-face`; inherit the host's.
- No global styles: no `:root`, `html`, `body` or bare element selectors, no
  CSS resets. Scope any CSS to your plugin's root element.
- No new CSS custom properties that shadow a host token name.

## Anti-slop profile

Plugin UI is product UI. If the anti-slop suite
(`@blackbelt-technology/anti-slop-frontend`) is installed, review plugin
surfaces with the `product-ui` profile: universal tells apply, marketing tells
and layout discipline do not, redesigns default to `preserve`, and image
direction is forbidden.
