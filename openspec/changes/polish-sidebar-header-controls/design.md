# Design: polish-sidebar-header-controls

## Context

Row 1 (`data-testid="header-app-bar"`) is `packages/client/src/components/session/SessionList.tsx:2858`:

- `flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5`.
- Left group `flex gap-1.5 items-center` (`:2863`):
  - `PiLogo` (24 px);
  - the Discord `<a data-testid="discord-btn">` (`:2868`; `Icon size={0.6}`, `--text-tertiary`, no box);
  - an `aria-hidden` divider;
  - `<ThemePicker />` (`:2881`);
  - `<FocusToggle />` (`:2882`).
- Right group `ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1`:
  - `QuestionStack`;
  - `{headerExtra}`;
  - the Settings button (`:2893`; `size={0.6}`, `--text-tertiary`).
- `headerExtra` comes from `packages/client/src/App.tsx:2297`: `flex items-center gap-2` around the update badge (`PiUpdateBadge`, or `RuntimeUpdateBadge` in Electron) and the only `ServerSelector`.
- Row 2 (`header-filter-bar`, `:2899`) has the filter funnel `:2944` (`rounded p-1`, `size={0.6}`, `--text-secondary`).

`RuntimeUpdateBadge` (`components/packages/RuntimeUpdateBadge.tsx:26-36`) renders an arrow plus the version string (for example "0.12.3"). `PiUpdateBadge` renders an arrow plus a count.

Component details today:
- `FocusToggle` (`components/session/FocusToggle.tsx:24-30`): `rounded px-0.5`, 0.6 glyph, pressed `text-blue-400 bg-blue-500/15` (Tailwind palette classes; `FocusToggle.test.tsx:28` asserts `text-blue-400`; `scripts/theme-token-baseline.json` counts `FocusToggle.tsx::blue: 2`).
- `ThemePicker` (`components/settings/ThemePicker.tsx`):
  - trigger: `mdiPalette size={0.5}` in `--text-muted`, `p-0.5` (`:75`);
  - dropdown: `min-w-[160px] py-1 rounded-lg overflow-y-auto` (`:93`), positioned by `usePopoverFlip`, `estimatedWidth: 200` (`:20`);
  - "Mode" heading: `text-[10px]` `--text-muted` (`:99`), with `<ThemeToggle />` below it;
  - palette rows: a vertical list of `theme-option-<id>` (`:118`) with two round inline-`style` swatches (`:121-128`), the active row marked by `--accent-blue` text + `mdiCheck`;
  - palette select: `setThemeName` + `closeToTrigger` (`:112-113`).
- `ThemeToggle` (`components/settings/ThemeToggle.tsx:7-31`): hard-coded English labels used only as `title`; three `p-0.5` buttons with `size={0.5}` glyphs, `aria-pressed`, `theme-light|system|dark`. Its only mount is inside `ThemePicker`.

Connection chip (`components/connectivity/ServerSelector.tsx`):
- trigger `connection-chip` (`:446`), `min-h-8 px-2 gap-1.5`, `hover:bg-[var(--bg-tertiary)]`;
- an `h-2 w-2` dot (`:452`);
- name `max-w-[160px] truncate @max-[399.98px]:hidden`;
- offline: the word (≥ 400 px) or `connection-chip-offline-glyph` `mdiCloudOffOutline` (< 400 px, `:458`);
- `connection-chip-tone`, `tunnel-btn-badge`, and a chevron (`:476`).

`currentEntry` (`:403`) is found with the raw key from `:254` (`${currentHost}:${currentPort}`), but `buildServerEntries` (`:66-88`) dedups with `canonicalLoopbackHost`. On a `127.0.0.1` origin the seeded row is `localhost:<port>`, so `currentEntry` is `undefined` and `isLocal` is lost.

Width estimates in this design come from the mockup replica (`mockups/header-icons-appearance/index.html`) and the real class strings. They are estimates. `tests/e2e/sidebar-header-fit.spec.ts` (#E3 279/280/320/440/500, #E4) is the gate. Its common-state fixture labels the current server "Local" (`installCommonState`), not the spec's ">30 character" name; a task fixes that.

## Goals / Non-Goals

**Goals:**
- Readable row-1 icons with ≥ 3:1 glyph contrast.
- An Appearance dropdown that follows the `ui-contract.md` flyout panel/heading recipe and the mockup's labelled sections.
- A collapsed connection chip that still tells local from remote.
- Every spec floor, testid and keyboard rule keeps holding, including Electron and long server names.

**Non-Goals:**
- The `tap-target` floor for row 1 (D7).
- Card and folder icons.
- Chip menu content.
- Theme persistence.
- The pre-existing row gap `gap-x-2` between groups.

## Decisions

### D1 · One header icon-button recipe, size B
`components/primitives/header-icon-button.ts` exports:
- `HEADER_ICON_BTN` = `focus-ring relative inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] aria-expanded:bg-[var(--bg-hover)] aria-expanded:text-[var(--text-primary)] aria-pressed:border aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent-soft)] aria-pressed:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed`;
- `HEADER_ICON_SIZE = 0.75` (18 px).

The pressed look is the contract's selected-chip recipe (`ui-contract.md:120`, "Pressed chips (sidebar toggles …)").

Tailwind scans literal classes in `.ts` sources; `components/connectivity/connectivity-ui.ts` (`BTN_*`) is the precedent.

Consumers:
- Discord `<a>`, Settings and the funnel (`SessionList.tsx`);
- `FocusToggle`, which drops `text-blue-*`; its test and the theme-token baseline shrink with it;
- the `ThemePicker` trigger.

The left group becomes `gap-1`, the tighter end of the within-group rule (`ui-contract.md:138`).

*Rejected:*
- C (32 px box): about 288 px is needed to fit on one line.
- `gap-0.5`: outside the within-group rule.
- A React component: Discord is an `<a>`, Focus owns pressed/disabled state, and the funnel has a badge child.

### D2 · Room for B in row 1
Today's left group is about 98 px:

| Item | Width |
|---|---|
| Logo | 24 |
| Discord | 14.4 |
| Divider | 1 |
| Palette trigger (`p-0.5` + 12) | 16 |
| Focus (`px-0.5` + 14.4) | 18.4 |
| 4 × `gap-1.5` | 24 |

B makes it 125 px (24 + 3 × 28 + 1 + 4 × `gap-1`) and Settings grows by 13.6 px. To keep the floors:

1. **`headerExtra` gap `gap-2` → `gap-1`** (`App.tsx:2297`). The wrapper is not a logical group; it only carries the two `App`-owned controls.
2. **The collapsed chip is 32 px** (D5), about 9 px narrower than today.
3. **`RuntimeUpdateBadge` is glyph-only in the sidebar header.** The version moves to its `title` and accessible name ("Dashboard {v} available", already its tooltip text). A visible version at ≥ 400 px wrapped the Electron long-name case (version ≈ 61 px, and more on the beta channel). `PiUpdateBadge` keeps its count.
4. **The chip name cap follows the header:** `max-w-24` (96 px) for a 400–479 px header, `@min-[480px]:max-w-40` (160 px, today's cap) from 480 px.
5. **The "Offline" word shows from a 480 px header** (today from 400 px). Between 400 and 479 px the `…Off` glyph is the cue. Without this, the worst state at a 400 px header wraps (about 413 px vs 376 px; today about 366 px).

Row-1 estimates. Content = header − 24 px. Widths come from the class strings; `QuestionStack` ≈ 34 px, `PiUpdateBadge` ≈ 39 px.

| State | Header (content) | Total |
|---|---|---|
| Common, browser | 269 (245) | 125 + 8 + 39 + 4 + 32 + 4 + 28 = 240 |
| Common, Electron (glyph-only badge ≈ 29) | 269 (245) | 230 |
| Common, long name | 400 (376) | 125 + 8 + 39 + 4 + chip (16 + 18 + 6 + 96 + 6 + 11 = 153) + 4 + 28 = 361 |
| Common, long name | 480 (456) | chip 217 → 425 |
| Worst case ("Local", the #E4 fixture) | 389 (365), collapsed chip ≈ 69 | 125 + 8 + 34 + 4 + 39 + 4 + 69 + 4 + 28 = 315 |
| Worst case ("Local") | 400 (376), chip ≈ 124 without the word | 370 |
| Worst case ("Local") | 480 (456), chip ≈ 167 with the word | 413 |

The 280 px slack is about 5 px. Two common variants exceed it:

- a remote-access tone glyph (tunnel on): +19 px → about 257 px;
- a two-digit update count: +6 px → about 246 px.

Today the tunnel case fits (about 231 px). **Decision (user, planning): the 280 px one-line promise is narrowed** to quiet remote access (local-only or LAN-only) and an update count below 10. In those two variants the right group wraps onto line 2 at about 280–300 px. It never clips. The `sidebar-header` "Two-row header layout" text says so.

The "every state at ≥ 400 px" promise is likewise stated for a short server name (≤ 8 characters, the #E4 fixture's "Local"). A long name in the worst state wraps at every header width, today and after this change: at a 480–489 px header it needs about 545 px.

The mockup measured `gap-0.5`, so `gap-1` is not covered by its frames. Font metrics differ between macOS (mockup), Linux Chromium (Docker gate) and Windows Electron. #E3/#E4 are the gate; the fallback is `px-2` on row 1 (+8 px).

### D3 · Appearance glyph `mdiBrightness6`
A half-filled sun: one solid shape at 18 px.

*Rejected:*
- `mdiThemeLightDark`: noisy at 18 px.
- `mdiCircleHalfFull`: already `GroupByChip.tsx:52`'s "group by status" glyph.
- A glyph that follows the current mode: the monitor reads as "display".
- A live swatch: no other row-1 control shows its value as an image.

Not imported anywhere in the client today.

### D4 · Appearance panel
Panel:
- `@container flex flex-col w-[300px] p-1.5 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] shadow-lg`;
- `maxWidth` / `maxHeight` / `minHeight` from `usePopoverFlip` on the panel;
- `estimatedWidth` 200 → 300.

300 px is inside the flyout recipe's 220–320 range (`ui-contract.md:213`). The recipe's `min-w-[220px]` is not applied: on a very narrow viewport the clamp wins.

On a 375 px phone the trigger sits at about x = 77, so `maxWidth` ≈ 290 px and each column is about 137 px. That leaves about 93 px for a name with no check glyph; "Tokyo Night" at `text-sm` is about 76 px.

Mode section, not scrolling:
- heading "Mode" in the flyout heading recipe (`text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]`);
- `ThemeToggle` as a three-column grid in a `--bg-primary` / `--border-primary` well. Each button is `min-h-9 max-sm:min-h-11 text-xs font-semibold` with icon + visible label;
- the pressed button uses the selected-chip recipe (`--accent-soft`, `--accent` border, `--text-primary`).

Palette section:
- heading "Palette";
- a `min-h-0 overflow-y-auto` grid `grid grid-cols-2 @max-[239.98px]:grid-cols-1 gap-0.5`, so on a short viewport the mode section stays visible and the grid scrolls;
- each row: `flex items-center gap-2 min-h-9 max-sm:min-h-11 px-2 rounded-md border border-transparent text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]`, so the active row's `--accent` border does not shift content;
- a 18 × 14 split swatch (palette `--bg-primary` | `--accent-blue` for the resolved mode, the same inline-`style` theme data as `ThemePicker.tsx:121-128` today) with a 1 px `--border-secondary` inset ring;
- the name, truncated as a last resort.

Active row: `aria-pressed="true"` + the selected-chip recipe (`--accent-soft` fill, `--accent` border) + `font-semibold`. The border is the shape cue, so there is no check glyph: in a 137 px column it would truncate "Tokyo Night".

Testids `theme-toggle`, `theme-light|system|dark` and `theme-option-<id>` stay, so the keyboard-open selector `[data-testid="theme-toggle"] [aria-pressed="true"]` (`ThemePicker.tsx:31,57`) still works.

Items stay toggle buttons, not `role="menuitem"`: the panel is a disclosure with a pressed-state group (spec "Header popovers are keyboard operable"). Following the flyout recipe means its panel, heading and item sizing; the menu role is not adopted.

The one-column fallback (`@max-[239.98px]` on the content box) triggers when the panel is under 254 px, i.e. below a viewport of about 339 px.

New i18n keys in `en`, `zh-CN` and `hu` (with D5's `connection.switchServerNamed`, five in total):
- `common.appearancePalette` ("Palette");
- `common.themeLight`, `common.themeSystem`, `common.themeDark` (today hard-coded English titles). They become the visible labels and the titles.

Mode labels at narrow widths: each cell is about 92 px; "Rendszer" (hu) at 12 px is about 56 px plus the icon, so it fits.

### D5 · Connection chip: server-kind glyph with a dot badge
Kind:
- `kind = (currentEntry?.isLocal ?? isLoopbackOrigin(currentHost)) ? "local" : "remote"`, in one helper `currentServerKind(currentEntry, currentHost)` beside `buildServerEntries`;
- the `currentEntry` lookup itself is not changed. Canonicalising `:254`/`:403` would relabel a `127.0.0.1` origin "Local" and desync the menu's `isCurrent` (`:507`) and probe skip (`:302`): a behaviour change this change does not make. The fallback covers the miss for the glyph only;
- `currentServerKind` strips IPv6 brackets before `isLoopbackOrigin` (`new URL(...).hostname` is `"[::1]"`, while `LOOPBACK_HOSTNAMES` holds `"::1"`);
- a remote server reached through a localhost port-forward shows the laptop glyph. That matches how the selector already classifies it (the seeded Local row).

Glyph:
- `mdiLaptop` / `mdiServerNetwork`, offline `mdiLaptopOff` / `mdiServerNetworkOff`, at `size-4.5` (18 px);
- in a `relative inline-flex` span `data-testid="connection-chip-glyph"` with `data-kind` and `data-offline`;
- offline glyph colour `--accent-red-text`, the on-surface accent text ramp (`theme-gallery`; per palette in `themes.ts`). `--status-error` has no contrast guarantee, and `--severity-error-fg` is a tint-pair token, not for bare surfaces. The "Offline" word moves to the same token (today `--status-error`, `ServerSelector.tsx:458`).

The status dot becomes an `aria-hidden` `size-2` corner badge at the top-right. The `…Off` slashes run from top-left to bottom-right, so a bottom-right badge would cover the shape cue. It keeps its current `--status-idle` / `--status-error` fills and gets a `ring-2 ring-[var(--bg-secondary)]` separator.

The `connection-chip-offline-glyph` testid is kept: while offline, the glyph's inner wrapper carries it at every width. The `mdiCloudOffOutline` element is removed.

The "Offline" word shows only from a 480 px header (D2). #E5 (`sidebar-header-fit.spec.ts:169,179`) asserts the old split, glyph < 400 / word ≥ 400, and is rewritten to: glyph always while offline, word from 480.

Below a 400 px header:
- the name and chevron are hidden;
- the chip is `@max-[399.98px]:min-w-8 @max-[399.98px]:px-1.5 @max-[399.98px]:justify-center`, a 32 × 32 target.

At ≥ 400 px the layout is glyph · name (D2 cap) · Offline (≥ 480 px) · tone · badge · chevron.

The `title` becomes "{server}: switch server" (new key `connection.switchServerNamed`), so the full name is in the tooltip wherever it is truncated or hidden.

The chip's internal `gap-1.5` stays inside one control, so it is component padding, not a group gap (named in D7).

Unchanged: `aria-haspopup="menu"`, `aria-expanded`, the accessible name (server, connection and remote-access state), the menu, and the tone and badge testids.

*Rejected:* A (`mdiServer` + chevron) wraps at 280 px; B (`mdiServer`, no chevron) is the same width as C but carries less information.

### D6 · Spec collision with `group-servers-by-identity`
`server-selector` "conforms to the UI contract and shows state in text" still says the trigger shows "Connected" / "Offline" beside a dot (`openspec/specs/server-selector/spec.md:141`). That has been stale since declutter.

This change restates the trigger sentence: visible content per `sidebar-header`, decorative glyphs and the dot `aria-hidden`, accessible name with "connected" / "offline".

`group-servers-by-identity` (0 tasks done) MODIFIES the same requirement (`openspec/changes/group-servers-by-identity/specs/server-selector/spec.md:92`). It gets the identical sentence in this planning commit. Its block also carries identity entry states and route chips, so the blocks differ in other text, and a whole-block MODIFIED makes archive order matter.

Two guards:
1. `group-servers-by-identity/dependencies.yaml` declares `blocked_by: polish-sidebar-header-controls`. It is advisory: ship-it warns, headless runs continue, interactive runs ask.
2. This change's tasks carry an archive-time check: if `group-servers-by-identity` is already archived, rebuild this delta from the then-current main block, changing only the trigger sentence. The result no longer depends on order.

If this change is dropped, delete the yaml and restore that delta's original trigger sentence (said in the yaml).

### D7 · Contract row and the tap-target exception
`ui-contract.md` gains an `icon button (header)` recipe row with the D1 string, reference `SessionList` row 1.

Named exceptions, recorded in the row:
- **Target size.** The row-1 icon buttons are 28 px, and the collapsed chip is 32 px. Both are below `tap-target` (44 px below `sm:`; the icon buttons are also below 32 px from `sm:`). Reason: the 280 px one-line floor; C does not fit. The row-2 funnel follows the same recipe to match the row-2 control height. It has no width floor of its own, so it is a consistency choice; row 2 grows by about 2 px (funnel 28 vs input 26).
- **Gestalt gap.** The divider, not a `gap-3` gap, carries the brand | tools boundary in the left div (about 9 px total), because a `gap-3` split costs 16 px the 280 px floor does not have.
- **Sizes outside the spacing list.** `size-7` / `size-4.5` are dimension steps, not spacing; the row says so.
- **Right-side gaps.** `headerExtra` `gap-1` equals the right group's `gap-1`, and the pre-existing `gap-x-2` between the left and right groups is below the contract's `gap-3`; the 280 px budget has no room for either.
- **Flyout departures** (recorded in the flyout row as a "disclosure variant" note):
  - no `min-w-[220px]` (the clamp wins);
  - `overflow-y-auto` on the palette grid, not the panel;
  - pressed toggle buttons, not `role="menuitem"`;
  - item `px-2`, not `px-3`, for the two-column fit.
- The trigger keeps `aria-haspopup="true"`, as today.

`host-design.md`'s rule to update the plugin-author copy together applies only to recipes plugins use. The header icon button is core-only, and the row says so.

### D8 · Where design overrides the mockup
The mockup board is the visual source, but it was drawn before review. This design supersedes it on:
- left-group gap (`gap-1`, not 2 px);
- panel width (300 px, not 268);
- pressed and active looks (selected-chip recipe, not `--tint-blue` / `--bg-tertiary` + ring);
- offline glyph colour (`--severity-error-fg`);
- no check glyph on the active palette (border + weight instead);
- badge at the top-right;
- "Offline" word from 480 px;
- the mockup's row-1/row-2 border (the spec forbids one);
- its `rgba(...)` / `#fff` literals (mockup-only; never copied).

## Risks / Trade-offs

- **[Budget is estimated]** #E3/#E4/#E5 run first in the worktree.
  - #E4 gains 411 px and 491 px.
  - The #E3 long-name case cannot be made on `localhost`: the current entry there is always the seeded "Local" row. The first test task is a spike: load the harness through a non-loopback alias of the same listener (`127.0.0.2`, outside `LOOPBACK_HOSTNAMES`) and stub `/api/known-servers` to give that host a > 30 character label. If the harness cannot be reached that way, ship-it hands back with `SHIP_IT_BLOCKED.md`; the long-name widths are not silently skipped.
  - Fallback: `px-2` on row 1.
- **[Archive order across worktrees]** The `group-servers-by-identity` worktree (`.worktrees/os-group-servers-by-identity`) is behind `develop` and does not have the patched sentence or its `dependencies.yaml` until it merges `develop`; ship-it's `develop` merge brings them in. The archive-time task in this change is ordered last, under an "Archive" heading, so apply does not tick it early.
- **[Truncated name 400–479 px]** The name truncates at 96 px. → Full name in `title`, the accessible name and the menu's current entry.
- **[Electron version not visible]** The runtime badge shows only its glyph. → The version is in the tooltip and accessible name; clicking the badge opens the same update flow as today.
- **[No chevron when collapsed]** The chip reads like an icon button below 400 px. → `aria-haspopup="menu"` plus the "Switch server" tooltip. Accepted with variant C.
- **[Swatch half blends]** The active palette's own `--bg-primary` sits about 1.1:1 on the panel. → The inset `--border-secondary` ring outlines the tile; other palettes' halves differ from the panel.
- **[Halo]** The badge ring is `--bg-secondary`, so it shows as a thin halo on chip hover (`--bg-tertiary`) and under the YOLO tint. → Cosmetic, 2 px. The YOLO legibility probe (sidebar-header YOLO requirement) covers the chip glyphs.
- **[Other changes touching the same surface]** `add-bundle-immutable-health-flag` task 4.1 edits the `headerExtra` badge gating, and `device-key-mutual-check` task 7.23 relabels the current entry "This dashboard". Both are textual neighbours; whichever lands second rebases. `currentServerKind` reads `isLocal`, not the label.
- **[Rebase with `group-servers-by-identity`]** The kind lives in one helper; that change reworks the list model, so whichever lands second re-points `currentServerKind`.
- **[`mdi-chunk-size` cap]** Four new MDI paths (about 1.2 KB raw); recent margin is about 400 B. → `packages/client/src/__tests__/mdi-chunk-size.test.ts` runs in the suite. If it trips, ship-it stops and hands back; no lazy loading, because it would paint the row empty first and skew the fit gate.

## Migration Plan

Client-only. Ship = build + restart. Rollback = revert the commit. No persisted state changes.
