# folder-action-banner.spec.ts — index

L3 for `add-folder-action-banner` (test-plan #E6, #F1, #F3, #F9, #F10). Pins the session-less `kb-sample` fixture (no `.pi/settings.json`, pinned → project root) → asserts the `folder-banner-setup-<cwd>` "Not a pi project yet" banner renders below the header row with a keyboard-focusable `folder-banner-setup-action-<cwd>`, the card carries no inline `project-init-btn`, and activating the action does not navigate to the directory home. Expands the folder only when its toggle title reads "Expand folder".
