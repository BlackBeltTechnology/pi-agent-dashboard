# Test Plan — polish-sidebar-header-controls

Stage: design   Generated: 2026-10-22

Hard gate: no unfillable Triple. Values not stated in the spec deltas are anchored to `design.md` (D1–D7) and current code:
- `@mdi/react` `size={0.75}` renders `width: 1.125rem` (18 px);
- container = sidebar − 11 px (`sidebar-header-fit.spec.ts:7-8`);
- language override key `pi-dashboard-language` (`lib/i18n/i18n.tsx:7`).

Levels:
- L1 = vitest (`packages/client/src/**/__tests__`);
- L3 = Playwright vs the docker harness (`tests/e2e/*.spec.ts`, port from `.pi-test-harness.json`). Container-query, width, contrast and hover-fill rows are L3 because jsdom has no layout or Tailwind CSS;
- ci = repo script gate.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | sidebar-header: Two-row header layout — Header icon buttons share one size | EP | L1 | automated | header rendered with all features | render `SessionList` | `discord-btn`, `theme-picker-trigger`, `focus-toggle-btn`, `settings-btn`, `filter-funnel-btn` each carry class `size-7` and `rounded-md`; each child `svg` has inline `width: 1.125rem`; none carries a class matching `/\b(text\|bg)-(blue\|red\|green\|gray)-\d/` |
| E2 | sidebar-header: Header icon buttons share one size (contrast) | EP | L3 | automated | themes `{base,dark}`, `{base,light}`, `{nord,dark}` | compute glyph colour vs `header-app-bar` / `header-filter-bar` background for the 5 buttons | every ratio ≥ 3.0; each box's bounding rect is 28 × 28 px |
| E3 | sidebar-header: Row 1 stays on one line in the common state | BVA | L3 | automated | 1 update, live connection, quiet remote access, no question, no waiting device, current-server label of 34 chars (harness loaded via non-loopback alias `127.0.0.2` + `/api/known-servers` stub for that host) | sidebar width 279 / 280 / 320 / 411 / 440 / 491 / 500 px | at 280–500 every row-1 child shares one vertical centre; at 279 no child's rect extends past `header-app-bar`; at 411 / 440 the name span's rendered width ≤ 96 px, at 491 / 500 ≤ 160 px |
| E4 | sidebar-header: Worst-case state never clips | BVA | L3 | automated | 2 open questions, 1 update, offline, tunnel `failed`, 1 waiting device, current server "Local" | sidebar width 180 / 280 / 400 / 411 / 491 / 500 px | at every width each row-1 child rect lies inside `header-app-bar`; at 400 / 411 / 491 / 500 every child shares one vertical centre |
| E5 | sidebar-header: Connection chip — Disconnected is not colour-only / Collapsed chip | BVA | L3 | automated | offline, current server "Local" | sidebar 410 / 411 / 490 / 491 px (header 399 / 400 / 479 / 480) | `connection-chip-offline-glyph` visible at all four; "Offline" text hidden at 399 / 400 / 479 and visible at 480; name + chevron hidden at 399 and visible at 400 / 479 / 480; at 399 chip rect ≥ 32 × 32 px |
| E6 | sidebar-header: A tunnel at the narrowest width wraps instead of clipping | EP | L3 | automated | tunnel tone `internet`, 1 update, live connection | sidebar width 280 px | every row-1 child rect inside `header-app-bar`; `connection-chip-tone` visible |
| E7 | sidebar-header: Two-row header layout (update count ≥ 10 may wrap, never clips) | BVA | L3 | automated | update count 12, live connection, quiet remote access | sidebar width 280 px | every row-1 child rect inside `header-app-bar`; badge text `12` |
| E8 | sidebar-header: chip name cap + tooltip | EP | L1 | automated | current-server label `pi-dashboard-31f4d8185a43-studio` (34 chars) | render chip | name span classes include `max-w-24` and `@min-[480px]:max-w-40`; chip `title` = "pi-dashboard-31f4d8185a43-studio: switch server"; `aria-label` contains the full name |
| E9 | design D5: `currentServerKind` | decision-table | L1 | automated | (a) entry `isLocal:true`; (b) entry `isLocal:false`; (c) no entry, host `127.0.0.1`; (d) no entry, host `[::1]`; (e) no entry, host `192.168.1.5`; (f) no entry, host `localhost` | call `currentServerKind(entry, host)` | (a) local (b) remote (c) local (d) local (e) remote (f) local |
| E10 | sidebar-header: Glyph names the server kind | decision-table | L1 | automated | {local, remote} × {connected, offline} | render chip | `connection-chip-glyph` `data-kind` / `data-offline` match; `path` `d` equals `mdiLaptop` / `mdiServerNetwork` / `mdiLaptopOff` / `mdiServerNetworkOff` respectively; `connection-chip-offline-glyph` present only when offline; dot badge `aria-hidden="true"` |
| E11 | sidebar-header: Glyph names the server kind (`127.0.0.1` label unchanged) | EP | L1 | automated | origin and current host `127.0.0.1:8000`, no known servers | render `ServerSelector` | visible name text `127.0.0.1` (as today); `connection-chip-glyph` `data-kind="local"` |
| E12 | sidebar-header: Electron update badge stays compact | EP | L1 | automated | runtime status updatable, available `0.12.3` | render `RuntimeUpdateBadge` | no visible text node equal to `0.12.3`; `title` and `aria-label` contain `0.12.3`; click navigates to `/settings/add-ons` (unchanged) |
| E13 | sidebar-header: Dropdown shows labelled sections | EP | L1 | automated | mode Dark, palette Base | click `theme-picker-trigger` | text "Mode" and "Palette" present; `theme-light` / `theme-system` / `theme-dark` show visible text Light / System / Dark; 9 `theme-option-*` buttons; exactly one `aria-pressed="true"` (`theme-option-base`); the grid element has class `grid-cols-2`; no `mdiCheck` path inside the palette grid |
| E14 | sidebar-header: Swatches follow the resolved mode | EP | L1 | automated | resolved mode light | open dropdown | `theme-option-nord` swatch halves have `backgroundColor` = nord light `--bg-primary` and `--accent-blue` from `THEMES`; after switching to dark they equal the nord dark values |
| E15 | sidebar-header: Change mode / Change palette from the dropdown | state-transition | L1 | automated | mode Dark, palette Base | open; click `theme-light`; click `theme-option-nord`; remount | after Light: `theme-light` `aria-pressed=true`, dropdown open; after Nord: dropdown closed, focus on `theme-picker-trigger`; after remount: `theme-option-nord` pressed |
| E16 | sidebar-header: Header popovers are keyboard operable (Appearance) | state-transition | L1 | automated | preference System | focus trigger, press Enter; then Escape | focus on `theme-system`; after Escape dropdown closed and focus on `theme-picker-trigger` |
| E17 | sidebar-header: Palette names fit on a phone | EP | L3 | automated | viewport 375 × 800, drawer open, active palette Tokyo Night; `pi-dashboard-language` = `en`, then `zh-CN`, then `hu` | open Appearance | grid has 2 columns; every palette-name span has `scrollWidth ≤ clientWidth`; every mode label has `scrollWidth ≤ clientWidth` in all three languages |
| E18 | proposal Impact: i18n parity for 5 new keys | EP | L1 | automated | `common.appearancePalette`, `common.themeLight`, `common.themeSystem`, `common.themeDark`, `connection.switchServerNamed` | run the catalog parity check | each key present and non-empty in `en` source, `zh-CN` and `hu` |
| E19 | theme-system: Sidebar action button contrast / D1 tokens only | EP | ci | automated | the changed client files | `node scripts/theme-token-guard.mjs` | exit 0; baseline entry `FocusToggle.tsx::blue` removed and `accentText` counts for `ThemeToggle.tsx` / `ThemePicker.tsx` not above today's |
| E20 | design Risks: `mdi-chunk-size` cap | BVA | L1 | automated | build with 4 new MDI paths | run `mdi-chunk-size.test.ts` | passes under `INDEX_GZ_CAP` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | sidebar-header: Appearance popover — Short viewport | BVA | L3 | automated | viewport 1280 × 480 | open Appearance | dropdown rect inside viewport; `theme-toggle` rect fully inside the dropdown rect; the palette grid's `scrollHeight > clientHeight` and `scrollTop` can be set > 0 while `theme-toggle` stays visible |
| F2 | sidebar-header: Narrowest sidebar keeps popovers on-screen (Appearance) | BVA | L3 | automated | viewport 375 × 800, sidebar 180 px | open Appearance | dropdown rect inside viewport; dropdown width ≤ 300 px |
| F3 | sidebar-header: Appearance popover (one-column fallback) | BVA | L3 | automated | viewport 320 × 800, drawer open | open Appearance | dropdown width < 254 px; grid computed `grid-template-columns` has 1 track; dropdown rect inside viewport |
| F4 | focus-mode / D1: pressed Focus uses the selected-chip recipe | state-transition | L1 | automated | Focus off | click `focus-toggle-btn` | `aria-pressed="true"`; classes contain `aria-pressed:bg-[var(--accent-soft)]` and no `text-blue-400` / `bg-blue-500/15` |
| F5 | sidebar-header: Dropdown probes pass in every theme | EP | L3 | automated | themes `{base,dark}`, `{base,light}`, `{nord,dark}` | open Appearance, run the computed-contrast probe on `theme-picker-dropdown` | contrast and size failure lists empty |
| F6 | sidebar-header: Row 1 carries an active-YOLO indicator — tint keeps row 1 legible | EP | L3 | automated | one YOLO session active, offline, themes `{base,dark}`, `{base,light}`, `{nord,dark}` | run the YOLO legibility probe on `header-app-bar` | failure list empty, including `connection-chip-glyph` |
| F7 | sidebar-header: icon-button hover / open fill | state-transition | L3 | automated | theme `{base,dark}` | hover `settings-btn`; then click `theme-picker-trigger` | hovered `settings-btn` computed background equals resolved `--bg-hover`; open trigger `aria-expanded="true"` with the same background |
| F8 | sidebar-header: recipe does not change row-1 height | BVA | L3 | automated | common state, sidebar 440 px | measure `header-app-bar` | height 44 px (`py-1.5` + `min-h-8` chip), equal to the pre-change value recorded in the spec |
| F9 | design D8: visual match with the board | visual/subjective | — | manual-only | row 1 + open Appearance + collapsed chip in base dark, base light, nord dark | operator compares with `mockups/header-icons-appearance` | [judgment: glyphs read clearly, groups distinct, popover matches the board — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | sidebar-header: Disconnected is not colour-only | fault-injection (abort) | L1 | automated | WebSocket disconnected (`connected=false`), remote current server | render chip | `aria-label` contains "offline"; `connection-chip-offline-glyph` present; no `mdiCloudOffOutline` path anywhere in the chip; no text "Connected" |
| X2 | design D5: unresolved current entry | fault-injection (abort) | L1 | automated | `currentHost` absent from entries and not loopback (`10.0.0.9`), entries list empty except seeded Local | render chip | renders without throwing; `data-kind="remote"`; visible name `10.0.0.9` |

---

## Coverage summary

- Requirements covered: 6/6 MODIFIED requirements (sidebar-header ×3, server-selector ×1 via E10/X1 accessible-name rows, theme-system ×1 via E2/E19, theme-gallery ×1 via E13–E15) plus design D1/D2/D5/D8.
- Scenarios by class: edge 20 · perf 0 · frontend 9 · error 2.
- Scenarios by level: L1 15 · L3 14 · ci 1.
- Scenarios by disposition: automated 30 · manual-only 1.

## New infra needed

- E3 needs the harness reachable from Playwright on a non-loopback alias (`127.0.0.2`) so that the current server can carry a long label. First test task = spike; if the listener does not accept it, hand back via `SHIP_IT_BLOCKED.md` (design Risks). Spike result: the harness publishes on 127.0.0.1 only, so `127.0.0.2` is refused; the fixture uses `pi-dash-long.local` (admitted by the host gate) mapped to 127.0.0.1 via Chromium `--host-resolver-rules`.
