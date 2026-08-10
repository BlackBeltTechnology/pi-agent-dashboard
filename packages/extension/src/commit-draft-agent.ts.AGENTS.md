# commit-draft-agent.ts — index

pi-SDK-coupled half of AI-draft. Exports `buildSessionContextText(ctx, maxChars)` (compacts `buildSessionContext().messages` → bounded text) + `runForkSubagentDraft(seed, cwd, getModel, timeout)` (ephemeral `SessionManager.inMemory` `AgentSession`, `tools:[]`, subscribe→capture text_delta, prompt, dispose; throws on failure → ladder falls back). Isolated so the risky in-process AgentSession spawn is behind one guarded entry; visible conversation untouched. See change: add-session-uncommitted-indicator-and-commit.
