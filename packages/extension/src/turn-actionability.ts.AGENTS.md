# turn-actionability.ts — index

Pure provider-agnostic classifier. Exports `classifyTurnActionability(turn)` → `normal`/`empty-actionable`/`truncated`/`error`, `ClassifiableTurn`, `TurnActionability`. `empty-actionable` = terminal non-error stop, no visible text part, no tool call (thinking-only/empty). Error precedence > truncation (`length`/`max_tokens`) > empty-actionable; text/toolCall part → normal regardless of stop reason. Shape-only, no provider id. See change: fix-gemini-subagent-silent-tool-schema-failure.
