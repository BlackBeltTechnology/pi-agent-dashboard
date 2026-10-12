# openspec-board-spawn-no-focus.spec.ts

L3 F2/F3: card `+ Session` and card `New worktree` on a per-run git fixture board keep the URL on `/folder/<cwd>/openspec`. Records every main-frame `framenavigated` URL; asserts none contains `/session/`. F3 also asserts the parent-folder `placeholder-session-card` clears. Fixture repo created via `docker exec`, removed in `afterAll`. See change: openspec-board-spawn-no-focus.
