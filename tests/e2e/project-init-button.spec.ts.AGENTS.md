# project-init-button.spec.ts — index

Playwright E2E for the polymorphic Initialize button (Level 1). `ensureGitSession` surfaces the no-hook `sample-git` folder group (no `worktreeInit`); asserts `project-init-btn` visible; captures session-ids, clicks the button, polls for a NEW `session-card-desktop` (proves the no-hook row spawns a project-init session via the WS round-trip). Scaffold conversation left to unit tests. See change: project-init-skill-and-profiles.
