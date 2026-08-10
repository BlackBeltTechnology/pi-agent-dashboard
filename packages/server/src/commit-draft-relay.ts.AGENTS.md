# commit-draft-relay.ts — index

Correlates `POST /api/git/commit-draft` → bridge `git_commit_draft_result`. Exports `createCommitDraftRelay()` → `{request, resolve, size}`; `request` sends `git_commit_draft {requestId}` via injected `send`, awaits reply (stub on timeout / no bridge, never rejects); `resolve(msg)` settles the pending promise (called from event-wiring). Self-contained + plugin-ready. See change: add-session-uncommitted-indicator-and-commit.
