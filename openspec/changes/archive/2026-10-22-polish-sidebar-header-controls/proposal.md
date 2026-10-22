# Proposal

## Why

The declutter change (`2026-10-22-declutter-sidebar-header`) shipped the grouped row 1, but not the look its mockup showed; the visual check was deferred post-merge, and this is its finding. Row-1 icons are bare 12–14 px glyphs with no hit box or hover fill. The Appearance trigger is the smallest and faintest (12 px `mdiPalette` in `--text-muted`, 2.59:1, below the 3:1 non-text floor). The Appearance dropdown is a 160 px list with an icon-only mode strip and a 10 px `--text-muted` heading, not the mockup's labelled panel. Below a 400 px header the connection chip collapses to a lone dot + chevron that says nothing about which server you are on.

## What Changes

Plan-proposal is driving this change.

- **Header icon buttons (size B).** One shared recipe for Discord, Appearance, Focus and Settings in row 1 and the filter funnel in row 2:
  - 28 px box (`size-7`, `rounded-md`) with an 18 px glyph in `--text-secondary`;
  - `--bg-hover` fill on hover and while open;
  - pressed state uses the contract's selected-chip recipe (`--accent-soft` / `--accent` / `--text-primary`), which replaces `FocusToggle`'s `text-blue-*` palette classes.
- **Room to keep the floors.** The extra width is paid for so the 280 px common state and the long-name case stay on one line. The 280 px one-line promise is narrowed to quiet remote access and an update count below 10; with a tunnel on, the right group wraps cleanly at about 280–300 px (user decision). The "every state at ≥ 400 px" promise is stated for a short server name, which is what #E4 measures. To pay for the width:
  - left-group gap `gap-1.5` → `gap-1`;
  - `headerExtra` gap `gap-2` → `gap-1`;
  - the collapsed chip shrinks to 32 px;
  - the Electron runtime update badge shows only its glyph in the header (the version stays in its tooltip and accessible name);
  - the chip's name cap becomes 96 px for a 400–479 px header and stays 160 px from 480 px;
  - the chip's "Offline" word shows from a 480 px header; narrower, the `…Off` glyph is the cue.
- **Appearance glyph.** `mdiPalette` → `mdiBrightness6`.
- **Appearance dropdown follows the mockup and the flyout recipe:**
  - up to 300 px wide, clamped to the viewport;
  - "Mode" and "Palette" headings (11 px `--text-secondary`);
  - a full-width segmented mode control with icon + visible label;
  - a two-column palette grid (one column when too narrow) with 36 px rows (44 px below `sm`): split swatch of the palette's real `--bg-primary` | `--accent-blue` and name; the active palette gets the selected-chip fill + border, bold text and `aria-pressed` (no check glyph, so names fit a phone column);
  - on a short viewport only the palette list scrolls.
  - Behaviour is unchanged.
- **Connection chip glyph.** A server-kind glyph replaces the bare dot:
  - `mdiLaptop` for the local dashboard (the "Local" entry, or a loopback host when the lookup misses, as on `127.0.0.1`) and `mdiServerNetwork` otherwise; labels and the menu are unchanged;
  - the dot becomes an `aria-hidden` top-right corner badge, clear of the `…Off` slash;
  - offline: the glyph switches to its `…Off` form in `--accent-red-text`, and the "Offline" word moves to that token too. The `connection-chip-offline-glyph` testid moves onto it; the separate `mdiCloudOffOutline` goes;
  - below a 400 px header: no name, no chevron, a 32 × 32 target;
  - the tooltip becomes "{server}: switch server", so a truncated or hidden name stays discoverable.
- **`server-selector` trigger sentence.** It was written before declutter and still describes a "Connected"/"Offline" word beside a dot. It is restated to defer the chip's visible content to `sidebar-header`. The identical sentence is patched into the in-flight `group-servers-by-identity` delta. That change gets `dependencies.yaml` `blocked_by: polish-sidebar-header-controls` (archive order), and this change re-checks the order at its own archive.
- **`ui-contract.md`** gains an `icon button (header)` recipe row with named exceptions: `tap-target` (28 px icon buttons, 32 px collapsed chip, sidebar header only), the divider-as-group-boundary gap, and `size-*` dimension steps.
- Mockup: mockups/header-icons-appearance (in this change)

Not in scope:
- session-card and folder-header icons;
- the question pill and `PiUpdateBadge` contents;
- the chip menu;
- theme state and persistence;
- the 280 px / 400 px floors themselves.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `sidebar-header`:
  - "Two-row header layout": the shared icon-button recipe, the glyph-only runtime badge, the chip-name cap, and 411 / 491 px widths in the common-state and worst-case scenarios;
  - "Appearance popover": glyph, labelled sections, two-column palette grid, 300 px width, mode stays visible while the list scrolls;
  - "Connection chip surfaces state that needs attention": server-kind glyph with a dot badge, `…Off` offline glyph at every width, the "Offline" word from 480 px, no name or chevron below 400 px.
- `server-selector`: "Server selector conforms to the UI contract and shows state in text" defers the trigger's visible content to `sidebar-header`. The accessible-name rule and every entry rule are unchanged.
- `theme-system`: "Sidebar action button contrast" names today's icon-only header buttons and moves them to the recipe colours (`--text-secondary` default, `--text-primary` hover). The old list (Pin, Install, Tunnel) left the header with declutter.
- `theme-gallery`: "Theme picker UI" drops "alongside the existing toggle", "small circles", "checkmark" and "palette icon".

## Impact

- Client only. Code:
  - `packages/client/src/components/primitives/header-icon-button.ts` (new);
  - `components/session/SessionList.tsx` (row-1 Discord/Settings, gap, funnel);
  - `components/session/FocusToggle.tsx`;
  - `components/settings/ThemePicker.tsx`;
  - `components/settings/ThemeToggle.tsx`;
  - `components/connectivity/ServerSelector.tsx` (chip glyph, `currentServerKind` helper);
  - `components/packages/RuntimeUpdateBadge.tsx`;
  - `App.tsx` (`headerExtra` gap).
- Tests to update:
  - `FocusToggle.test.tsx` (asserts `text-blue-400`);
  - `ThemePicker.test.tsx`, `ThemeToggle.test.tsx`, `PopoverFlip.adopt.test.tsx`;
  - `ServerSelector.chip.test.tsx`;
  - `RuntimeUpdateBadge.test.tsx` (asserts the version in `textContent`);
  - `SessionList.header-declutter.test.tsx`;
  - `tests/e2e/sidebar-header-fit.spec.ts`: #E3's common-state fixture labels the server "Local", not a long name; #E3 and #E4 gain 411 / 491 px; #E5's glyph/word split moves to "glyph always, word from 480".
- Baseline and size checks:
  - `scripts/theme-token-baseline.json` shrinks (`FocusToggle.tsx::blue`, and the `accentText` entries for `ThemeToggle.tsx` / `ThemePicker.tsx` `--accent-blue`);
  - `mdi-chunk-size.test.ts` has to stay green with four new MDI paths.
- i18n: 5 new keys (`common.appearancePalette`, `common.themeLight|System|Dark`, `connection.switchServerNamed`) in `en`, `zh-CN` and `hu`.
- Coupling, textual only; whichever lands second rebases:
  - `ServerSelector.tsx` is also reworked by `group-servers-by-identity` (the list model the kind reads). The kind sits in one helper, so the rebase re-points one function;
  - `add-bundle-immutable-health-flag` edits the `headerExtra` badge gating;
  - `device-key-mutual-check` relabels the current entry.
- No server, protocol, persistence or migration impact. Rollback = revert the client commit.

## Discipline Skills

- `review-code`: non-trivial client change across ≥ 3 components before commit.
- `doubt-driven-review`: the width budget (280 px, 411 px, Electron) is estimated from class strings and a replica; it must hold against `sidebar-header-fit.spec.ts`.
- No security, performance, observability or irreversible-migration trigger applies: client-only visual change, no new endpoint, no untrusted input, no persisted-format change.
