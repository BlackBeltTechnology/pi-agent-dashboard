# composer-session-strip.spec.ts — index

L3 (change: redesign-composer-session-strip; F8–F12). Synthetic bridge on `FIXTURE_GIT` (pinned first) pushes worktree + open-PR `git_info_update`; routed `/api/health` / `/ws` enable the browser-relay badge / READY readiness for this page only. Asserts empty Status group hidden (`:has(:empty)`), groups wrap inside themselves without strip overflow, send button bottom-aligned to the draft (≥44 px), `@[44rem]` fold vs longest model id, composer lifecycle bar in letters mode.

#F10 now asserts the action button ends the toolbar row below the draft (≥44×44); #F11 asserts the `26.25rem` fold (delivery chip hidden, Steer/Queue in `＋`, toolbar `scrollWidth ≤ clientWidth`, no `⋯`). Context-strip tests (#F8/#F9/#F12) move with the dock (phase D). See change: add-composer-dock.

add-composer-dock: #F9 now asserts the Changes lane (`composer-git-container`, its `composer-git-group` actions) stays inside the dock at 1440/700/420 px; new #F19 (card border = `--accent` focus colour ≥3:1, textarea no outline/box-shadow). See change: add-composer-dock.

#F8 rewritten (add-composer-dock): since #919 the browser badge claim is `shouldRender`-gated, so a fresh session has no Status group (asserts `composer-status-container`/label absent once the Context lane mounts) and the `:has(:empty)` hide rule is exercised on a synthetic `data-group` probe (hidden while empty, shown with content). See change: add-composer-dock
