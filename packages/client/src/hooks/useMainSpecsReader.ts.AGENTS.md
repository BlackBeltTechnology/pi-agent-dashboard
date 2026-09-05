# useMainSpecsReader.ts — index

Reads `openspec/specs/` directory, fetches each `spec.md` in parallel, concatenates into single markdown `content`. Returns `{ specNames, content, isLoading, error }`. Aborts stale loads via `AbortController`. Re-runs on `cwd` change.
