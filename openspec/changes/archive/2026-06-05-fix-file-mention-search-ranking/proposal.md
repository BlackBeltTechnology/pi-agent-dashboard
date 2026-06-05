## Why

Typing `@` in the chat composer opens a file-mention dropdown. Users report it "does not show all matched files — only a portion". Two defects in the bridge's `searchFiles` (`packages/extension/src/command-handler.ts`) cause this:

1. **Hard cap of 20, no ranking.** `const MAX_RESULTS = 20` truncates results. `searchFiles` returns the first 20 entries encountered, with no scoring. A query matching more than 20 files silently drops the rest — and the 20 kept aren't the most relevant, just the first reached.

2. **Depth-first walk blows the budget in the first subtree.** `walk()` recurses into a directory immediately after pushing a match, so the 20-slot budget can be exhausted inside the first deep subdirectory before sibling top-level files are ever visited. The returned set is an arbitrary traversal-order slice, not the shallowest/closest matches.

The bare-`@` case (empty query) is worse: `lowerQuery === ""` matches every entry, so the dropdown fills with 20 arbitrary deep files from whatever subtree `readdir` returns first — instead of the top-level files/dirs a user expects to see when they just typed `@`.

The current `file-autocomplete` spec encodes the defect ("display up to 20 entries"), so the spec must change too.

## What Changes

- **MODIFIED**: `searchFiles(cwd, query)` in `packages/extension/src/command-handler.ts`:
  - **Decouple traversal budget from result count.** Walk up to a node-visit budget (e.g. `MAX_VISITS = 4000` directory entries scanned) collecting *all* matches found within that budget, instead of stopping at the first N matches. Keep the existing `depth > 6` guard and `IGNORE_DIRS` skip.
  - **Slash-aware query split.** When the query contains `/`, split at the last slash: the prefix (`x/db/`) filters candidates to paths under/containing that scope, and the suffix (`co`) is ranked as a *basename* query within that scope. A query without a slash keeps whole-basename ranking against every candidate. This makes drilling into a directory (`@x/db/co`) rank the closest files in that directory to the top instead of flat path-substring order.
  - **Rank matches** before truncating. Scoring tiers (highest first), applied to the leaf query against each candidate's basename: exact basename match → basename prefix match → basename substring match → path substring match (fallback when the leaf isn't in the basename). Tie-break by shallower depth, then shorter path length, then alphabetical. Empty-query case ranks purely by shallow depth then alphabetical (top-level entries first).
  - **Raise the display cap** from 20 to a higher constant (e.g. `MAX_RESULTS = 50`) and apply it *after* ranking, so the user sees the 50 best matches, not the first 20 reached.
- **MODIFIED**: `file-autocomplete` spec — replace the "up to 20 entries" requirement with a "ranked, capped at `MAX_RESULTS`" requirement, add an ordering requirement, and add a bare-`@` ordering scenario.
- **NOT INTRODUCED**: A new event type, protocol field, or client change. The client (`CommandInput.tsx`) already renders the entire `fileResults.files` array with no client-side cap; raising/ranking happens entirely in the bridge. Wire shape (`files_list { query, files: FileEntry[] }`) is unchanged.
- **NOT INTRODUCED**: A fuzzy/subsequence matcher (e.g. fzf-style gap scoring). v1 keeps substring matching; ranking only re-orders substring hits. Subsequence matching deferred.
- **NOT INTRODUCED**: Server-side caching or an index. `searchFiles` still walks the tree per request; the 150ms client debounce remains the throttle.

## Capabilities

### Modified Capabilities

- `file-autocomplete`: the dropdown result set becomes ranked-then-capped instead of first-20-reached; bare-`@` surfaces top-level entries first.

## Impact

- **MODIFIED files**:
  - `packages/extension/src/command-handler.ts` — rewrite `searchFiles` (visit budget, ranking, raised cap). Bridge change → requires `npm run reload` to take effect in connected sessions.
  - `openspec/specs/file-autocomplete/spec.md` — via the delta in this change.
- **Tests**: new unit tests for `searchFiles` ranking + budget behavior (exact-before-prefix-before-substring, shallow-before-deep tie-break, bare-`@` top-level-first, cap applied after ranking, deep-subtree no longer starves siblings).
- **Backward compatibility**: Wire protocol and client unchanged. Only the *contents and order* of `files` change. Selection, `@`-insertion, keyboard nav, debounce, stale-result handling all unaffected.

## References

- Slash-aware behavior: a slashed query (`@x/db/co`) splits at the last `/` so the leaf (`co`) ranks as a basename within the `x/db/` scope; a bare directory query (`@x/db`) still surfaces the directory and its contents via path-substring.
- Root cause: `packages/extension/src/command-handler.ts` — `searchFiles` (≈ line 21), `MAX_RESULTS = 20` (line 19), match line `relPath.toLowerCase().includes(lowerQuery)` (≈ line 34), `list_files` handler (≈ line 486).
- Wire forward: `packages/server/src/browser-handlers/directory-handler.ts` (`list_files` case), `packages/shared/src/protocol.ts` (`ListFilesMessage`).
- Client render (no cap): `packages/client/src/components/CommandInput.tsx` — `fileItems = fileResults.files` (≈ line 235).
- Existing spec encoding the defect: `openspec/specs/file-autocomplete/spec.md` — "display up to 20 entries".
