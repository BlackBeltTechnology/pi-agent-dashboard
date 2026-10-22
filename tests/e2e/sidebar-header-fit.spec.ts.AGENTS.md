# sidebar-header-fit.spec.ts — index

L3 (change: declutter-sidebar-header #E3 #E4 #E5 #F7 #F8; polish-sidebar-header-controls #E2 #E3 #E4 #E5 #E6 #E7 #E17 #F1 #F2 #F3 #F5 #F7 #F8). Sidebar width seeded via localStorage `dashboard:sidebar-width` (clamped 180–500; header container = sidebar − 11 px (resize handle + border)). "Same line" = child vertical centres within 3 px; "inside" = no row-1 child rect past `header-app-bar`.

Row 1 fit:
- #E3 common state, 34-char server label (`pi-dashboard-31f4d8185a43-studio`): harness reached through `http://pi-dash-long.local:<DASHBOARD_PORT>/` (`.local` is host-gate admitted; Chromium `--host-resolver-rules` maps it to 127.0.0.1; `127.0.0.2` is refused) + `/api/known-servers` stub for that host (non-loopback alias ⇒ current entry is the labelled known server). Widths 279/280/320/411/440/491/500: inside everywhere, one line ≥280, chip name ≤96 px at 411/440, ≤160 px at 491/500.
- #E4 worst state (2 questions via `questions_update` WS frame through `page.routeWebSocket`, WS dropped ⇒ offline chip, tunnel `failed`, 1 pending device, server "Local"): inside at 180/280/400/411/491/500, one line ≥400.
- #E6 tunnel on (`gateway` connected = expected) at 280: inside + `connection-chip-tone` visible. #E7 update count 12 at 280: inside, badge shows `12`. #F8 row-1 height 44 px at 440.
- #E5 chip breakpoints (sidebar 410/411/490/491 ⇒ container 399/400/479/480): offline glyph always; name + chevron from 400; "Offline" word from 480; collapsed chip ≥ 32×32 at 399.

Icon buttons: #E2 five buttons (`HEADER_ICON_BUTTON_IDS`) are 28×28 with glyph contrast ≥ 3 in base dark / base light / nord dark; #F7 hover and open (`aria-expanded`) fill = `--bg-hover`.

Appearance panel: #E17 375 px phone, Tokyo Night, en/zh-CN/hu: 2 grid columns, no truncated palette/mode label. #F3 320 px: panel < 254 px, 1 grid track. #F2 375×667, sidebar 180: every popover on screen, Appearance ≤ 300 px. #F1 heights 480 and 300: panel inside viewport, Mode control stays in the panel and does not move while the palette grid (`theme-palette-grid`) scrolls (grid must scroll at 300). #F5 contrast + size + non-text probes on `theme-picker-dropdown` in the three theme/mode pairs.

Run against the docker harness (seeded: `PI_E2E_SEED=1 PI_TEST_PEERS=both PI_E2E_OAUTH=1`); #E5/#E4 stub `/auth/status` so a dropped socket reads as offline, not sign-in. See change: polish-sidebar-header-controls.
