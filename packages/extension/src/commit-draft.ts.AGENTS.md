# commit-draft.ts — index

Pure AI-draft fallback ladder (no pi-SDK coupling). Exports `draftCommitMessage(deps)` → `{message, source}`, `stubMessage`, `clampDiff`, `sanitizeDraft`. Ladder: fork-subagent (context) → diff-only → deterministic stub. `withTimeout` per rung; never throws. Dependency-injected (`buildDiff`, `buildContext`, `runAgent`) so unit-testable with a stub agent. See change: add-session-uncommitted-indicator-and-commit.
