# Proposal

## Why

The sidebar app bar (row 1) now carries up to 13 controls in one 40 px row: logo, ThemePicker, the 3-way ThemeToggle, InstallButton, TunnelButton, the open-questions pill, FocusToggle, the pi-core update badge, ServerSelector (name + "Connected"), Discord and Settings. At a ~440 px sidebar the right group overflows: Discord and the Settings gear are clipped off-screen, and the server name truncates to a few characters. The filter row has the same pressure: two inputs plus two inconsistently styled chips (`archive`, `Hidden`). Every feature added since the 2026-04-10 two-row redesign appended another icon, and none had a grouping rule.

## What Changes

Plan-proposal is driving this change. Variant **B · Purpose-grouped popovers** was picked from four mockup variants.

- **Appearance dropdown.** ThemePicker's palette button stays as the single Appearance trigger. Its existing dropdown gains the Light / System / Dark mode control (ThemeToggle, now exposing the pressed mode) above the palette list. The standalone 3-way toggle leaves row 1. Theme state, persistence, `useThemeContext` and the dropdown's viewport positioning stay unchanged.
- **Connection chip.** ServerSelector's trigger becomes the connection chip: status dot + server name (the name hides below a 400 px sidebar container) + chevron. The "Connected" text label is dropped. Disconnected state shows a non-colour cue: "Offline" text, or an offline glyph on narrow sidebars. The chip's menu keeps every current server-switch behaviour and adds an **Access** group with **Remote access** (opens the existing `RemoteAccessDialog`, shows state and waiting-device count), **Install as app** (only when installable today). Remote access attention states (internet / partial / failed, each a distinct glyph shape) and the waiting-device count also surface on the chip, so nothing that needs attention hides in a menu. `App.tsx` owns this wiring, because it holds the only ServerSelector.
- **Discord beside the logo.** The Discord link moves from the right group to sit immediately after the π logo, forming a brand/community group, separated from the tools by a divider.
- **Row 1 order:** logo · Discord ┊ Appearance · Focus ‖ open-questions pill · update badge · connection chip · Settings. Zero-count pills still never render. Row 1 wraps instead of clipping: one line at ≥ 280 px in the common state and ≥ 400 px in every state (sidebar range 180–500 px).
- **Filter row:** one search box with a **Sessions / Folders** scope toggle. The scope picks which query the box edits; **both queries stay active and keep AND composition**. The other scope's non-empty query shows as a removable chip inside the box. `Include archive` and `Show hidden` move into a **filter funnel** popover; the funnel shows a count badge of active filters.
- Existing `data-testid`s move with their control (`theme-toggle`, `tunnel-btn`, `discord-btn`, `pi-update-badge`, `workspace-filter-input`, `session-search-input`, `search-include-archive`, `settings-btn`, …). None are deleted.
- Mockup: mockups/header-declutter (in this change)

Not in scope: changing what any control does, ThemeProvider / theme persistence, server-switch transport, RemoteAccessDialog content, the YOLO tint, the tag-filter bar below the filter row.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `sidebar-header`: row 1 composition becomes grouped. ThemePicker + ThemeToggle fold into an Appearance popover. TunnelButton and InstallButton fold into the connection chip menu. The Discord link moves next to the logo. The "all controls preserved" requirement is restated as "reachable within one popover". The open-questions pill anchor moves (TunnelButton no longer sits in row 1). Row 2 becomes one scoped search + funnel.
- `session-search`: the two side-by-side inputs become one scoped search box. Both queries, AND composition, the unpinned-folder rules and the auto-expand rules are preserved.
- `session-filtering`: `Show hidden` stops being a chip in the header and becomes a toggle inside the filter funnel popover. Its behaviour is unchanged.
- `session-sidebar`: the "Sidebar header" and brand-mark requirements drop their stale "filter controls remain in the header row" clauses. The brand mark places the Discord link right after the home button.
- `session-list-decomposition`: REMOVED the never-implemented "Session list toolbar extraction" (`SessionListToolbar`). The header stays inline in `SessionList.tsx`, where the theme-system scan expects it.
- `session-list-filters`: REMOVED the obsolete "Add folder" filter-row button requirement (button gone from code). ADDED "Filter row carries no pin-folder button" so the capability matches `sidebar-header`.
- `sidebar-header` also gets a MODIFIED YOLO-indicator requirement, so its "no-YOLO" baseline refers to the new row composition instead of "today".

## Impact

- Client only: `packages/client/src/components/session/SessionList.tsx` (header rows, funnel inline), `packages/client/src/App.tsx` (`headerExtra` composition, remote-access hook, install prompt, `RemoteAccessDialog` mount), `components/settings/ThemePicker.tsx` (dropdown hosts the mode control) + `ThemeToggle.tsx` (`aria-pressed`), `components/connectivity/ServerSelector.tsx` (chip trigger + Access group), `TunnelButton.tsx` / `InstallButton.tsx` (deleted; replaced by ServerSelector `accessItems` rows, tests ported), new filter-funnel popover.
- Tests: vitest suites for `SessionList` header (question-pill, yolo-pill, tags-filter, pill-roles), `ThemePicker`, `TunnelButton`. Playwright specs and helpers that click `tunnel-btn`, `theme-toggle` or the filter inputs directly from row 1 (`tests/e2e/helpers/remote-access.ts`, `zrok-v2-tunnel.spec.ts`, `yolo-indicator-layout.spec.ts`, `retro-ux-identity-connectivity.spec.ts`, …) must open the owning popover first.
- No server, protocol, persistence or migration impact. Rollback = revert the client commit.
- `theme-system` literal scan finds `search-include-archive` and `ToggleButton` by AST inside `SessionList.tsx`. The funnel stays inline in that file, so the scan and its spec are unchanged.
- i18n: new strings go into all three catalogs (`en`, `zh-CN`, `hu`) for the parity gate.

## Discipline Skills

- `review-code`: non-trivial client change across ≥3 components before commit.
- `doubt-driven-review`: the session-search requirement is being restated (behaviour-preserving claim must hold).
- No security, performance, observability or irreversible-migration trigger applies: client-only UI regrouping, no new endpoint, no untrusted input path, no persisted-format change.
