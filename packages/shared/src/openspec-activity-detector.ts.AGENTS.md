# openspec-activity-detector.ts — index

Detects OpenSpec activity from tool-execution events. `detectOpenSpecActivity(toolName, args)` returns `{ phase?, changeName?, isActive? }` via skill-path / change-path / CLI-flag regexes. Exports `isValidOpenSpecChangeSlug(name)` (lowercase kebab, ≤64 chars, `[a-z]`-first).
