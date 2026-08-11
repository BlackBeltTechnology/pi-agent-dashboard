# openspec-activity-detector.ts — index

Detects OpenSpec activity from tool-execution events. `detectOpenSpecActivity(toolName, args, cwd)` returns `{ phase?, changeName?, isActive?, localEvidence? }` via skill-path / change-path / CLI-flag regexes. Exports `isValidOpenSpecChangeSlug(name)` (lowercase kebab, ≤64 chars, `[a-z]`-first).

cwd-scoping (anti-traversal, change: scope-openspec-auto-attach-to-session-cwd). `cwd` is REQUIRED and comes from server session state, never model args. Path matches must be contained by `cwd` (`isPathInside` from `path-containment.ts`; relative paths resolve against `cwd` first). CLI matches are dropped when the command `cd`/`pushd`s outside `cwd` ANYWHERE in the string (position-insensitive, conservative). `localEvidence: true` marks a path inside `cwd` or an `openspec new change` create — the server gate uses it to suppress a misleading rejection notice.
