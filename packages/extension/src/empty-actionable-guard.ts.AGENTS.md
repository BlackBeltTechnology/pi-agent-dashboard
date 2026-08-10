# empty-actionable-guard.ts — index

Bounded continue-or-surface decision for empty-actionable turns. Exports `EmptyActionableGuard`, `GuardMode`, `GuardDecision`, `CONTINUATION_NUDGE`, `SURFACE_MESSAGE`, `DEFAULT_RETRY_CAP=2`. `observe(sessionId,actionability)` → `continue`/`surface`/`none`; caps consecutive `empty-actionable` nudges at `retryCap` then surfaces; resets counter on any non-empty-actionable turn. `surface-only` mode never nudges. Per-session counter only side effect. See change: fix-gemini-subagent-silent-tool-schema-failure.
