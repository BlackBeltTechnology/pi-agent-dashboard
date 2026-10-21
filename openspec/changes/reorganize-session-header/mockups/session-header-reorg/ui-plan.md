# UI plan: session header reorganisation

- Mode: `preserve` (anti-slop-redesign). Profile: `product-ui`. Contract: root `ui-contract.md`.
- Protected: `data-testid` `back-button`, `layout-mode-switch`, `layout-mode-{closed,split,full}`, `session-header-seek-card`, `refresh-chat`, `changed-files-chip`, `header-resume-button`, `header-fork-button`, `open-extension-modules`, `pi-below-floor-warning`, the radiogroup keyboard model (Arrow/Home/End, Enter/Space).
- Testids that move (not renamed): `session-header-seek-card` and `refresh-chat` move from header buttons to title-menu items.

## Surfaces → tokens → states

| Surface | Tokens | States on the board |
|---|---|---|
| Desktop header `.sh` | `--bg-primary`, `--border-primary`, `--text-primary` (title 16 px/600), `--text-secondary` (meta 12 px), `--bg-tertiary` + `--border-secondary` (tag, secondary chip), `--severity-{success,error}-*` (count pills), `--severity-warning-*` (pi floor), `--tint-{green,blue}-*` (Resume, Fork), `--focus-ring` | A chat, A split, A title menu open, A ended, A warning + modules, A2 seek icon, B tabs, B split, C leading |
| Layout switch `.lsw` / `.ltabs` | selected `--tint-blue-{bg,fg}`; tabs selected `--accent-primary` underline + `--text-primary` | full labels; icon-only below 760 px container |
| Title menu `.menu` | `--bg-secondary`, `--border-secondary`, `--elevation-rim`, `--shadow-card`, items `--text-primary` 14 px, descriptions `--text-secondary` 12 px | open |
| Mobile `.mh` | 44 px targets; mode icon `--tint-blue-fg`; menu rows 44 px | A closed, A menu open, B segmented |
| Context ring `.ring` | track `--border-secondary`, value `--text-secondary`, ≥80% `--accent-orange-text`; `role=meter` + % text (desktop), button + popover (mobile) | R1 composer (reference strip), R1 85%, R2 header meta, mobile R1, mobile fallback |

## Decisions

| ID | Decision | Status |
|---|---|---|
| D1 | Layout switch on the right edge, bigger (A) | approved 2026-10-21; B, C kept for comparison |
| D2 | Seek → icon button `DockLeft` next to the title AND `Reveal in sidebar` title-menu item | approved (both) |
| D3 | Header refresh → `Reload transcript` title-menu item + mobile kebab label | approved |
| D4 | Composer OpenSpec refresh | out of scope: owned by `openspec/changes/add-composer-dock/mockups/composer-dock` (OpenSpec lane ⋯) |
| D5 | Attach removed from the header (desktop chip + mobile paperclip); composer-dock OpenSpec lane keeps it | approved |
| D6 | Labelled clock `running 5m 32s` / `ended · ran 42m` | approved |
| D7 | Mobile: mode-icon menu (A); info strip removed (model, thinking, tool → composer; context → header ring; cost → ring popover) | approved (cost placement = proposal) |
| D8 | Context: R2, ring at the end of the header meta line (desktop) and arc-only ring button in the mobile header row; the full-width bar row and the composer ring go | approved |
| D9 | `View` (ChatViewMenu) immediately after the layout switch | approved (same placement as the `add-composer-dock` chat-display-preferences delta) |
| D10 | Header Changed files chip stays (opens the editor Changes section) | approved |

## Cross-board dependencies (openspec/changes/add-composer-dock/mockups/composer-dock)

- composer-dock D4 moves `ChatViewMenu` into this header → D9.
- D8 (R2): composer-dock drops its toolbar ring and the ring rules in its D13; its open question 1 resolves to "header only".
- F12: composer-dock ring tokens fail WCAG 1.4.11 (arc vs track 1.82 / 2.17 / 2.92:1; hot `--accent-orange` 2.80:1 on the light page). This board uses track `--border-secondary`, hot `--accent-orange-text`.
- composer-dock Changes lane and the header Changed files chip both stay (D10): the chip opens the editor Changes section, the lane opens Review.

## Probe

`__probeRoot` on every `.col.prop .stage`: 0 contrast / size failures in base dark, base light, nord dark, all 5 surfaces (desktop, context, narrow, mobile, icons).

## Spec deltas a change would need

- `chat-refresh` "Refresh button in session header" (moves into the title menu, renamed).
- `session-card-seek` "Seek control reveals the active session's card" (control becomes a menu item / new glyph).
- `split-editor-workspace` "Split SHALL be unsplittable and re-splittable" (mobile presentation; placement).
- `session-resume` elapsed-duration scenario (labelled clock).
- `chat-display-preferences` "View menu renders in the status bar" (moves to the header, shared with composer-dock D4); `contextUsageBar` preference controls the header ring instead of the bar; `TokenStatsBar` keeps only the opt-in turn chart + stats.
- Archived `redesign-split-layout-controls` header order (`name ✎ [switch] Seek`) is superseded.
