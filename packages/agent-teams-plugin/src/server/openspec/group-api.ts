/**
 * The surface of the `openspec-group` module that the launcher (slice B2) consumes: the worktree step, the
 * member name and the spawn briefing. Loaded lazily by `launcher.ts`; every member is replaceable in tests.
 * See change: add-agent-teams-openspec.
 */
export { type BriefingInput, buildBriefing } from "./briefing.js";
export { memberNameFor } from "./names.js";
export { type EnsureWorktreeInput, type EnsureWorktreeOptions, type EnsureWorktreeResult, ensureWorktree } from "./worktree.js";
