# paging-empty-reply-exhausted.spec.ts — index

L3 #F8 (close-registry-frame-shed-gaps). Pins `/fixtures/stub-dir` over the bus so its ended row turns snapshot-visible and `sessions_page` replies empty while the browser still shows `N ended`/0 held. Asserts `folder-ended-more-<cwd>` disappears, counts `sessions_page` frames SENT (`framesent`) == 1 across a collapse/re-expand (no same-offset dead-end), then injects an ended session file via `docker exec` + re-pins so discovery broadcasts `session_added` and the affordance re-arms. Self-isolating: archives the injected id, unpins, deletes files.

Row summary (formerly inline in `tests/e2e/AGENTS.md`): L3 #F8: empty page reply hides "more"; no same-offset retry.
