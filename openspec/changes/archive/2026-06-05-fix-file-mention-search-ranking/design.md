## Context

The `@` file-mention dropdown is fed by `searchFiles(cwd, query)` in the bridge extension. The function walks the cwd tree and returns `FileEntry[]` over the `files_list` wire message. The client renders the array verbatim. Two coupled defects (single `MAX_RESULTS` cap used as both traversal budget and result count + inline depth-first recursion) make the result set a near-arbitrary slice.

## Current behavior (verbatim)

```ts
const MAX_RESULTS = 20;

function searchFiles(cwd, query) {
  const results = [];
  const lowerQuery = query?.toLowerCase() ?? "";
  function walk(dir, depth) {
    if (results.length >= MAX_RESULTS || depth > 6) return;   // (1) budget == result count
    for (const entry of readdirSync(dir, {withFileTypes:true})) {
      if (results.length >= MAX_RESULTS) return;
      if (IGNORE_DIRS.has(entry.name)) continue;
      const relPath = relative(cwd, fullPath) ... ;
      if (!lowerQuery || relPath.toLowerCase().includes(lowerQuery))
        results.push({ path: relPath, isDirectory });
      if (entry.isDirectory()) walk(fullPath, depth + 1);     // (2) recurse inline → DFS
    }
  }
  walk(cwd, 0);
  return results;
}
```

- (1) The same `MAX_RESULTS` gates both how far we walk and how many we return. Walk stops the instant we have 20 — even if better matches sit in unvisited siblings.
- (2) Inline recursion means the first directory drains the budget before later siblings are seen.

## Decision: decouple budget, rank, then cap

```
                 ┌──────────────────────────────────────────────┐
                 │  walk whole tree up to MAX_VISITS nodes       │
                 │  (depth ≤ 6, IGNORE_DIRS skipped)             │
                 │  collect ALL substring matches → candidates[] │
                 └───────────────────────┬──────────────────────┘
                                         ▼
                 ┌──────────────────────────────────────────────┐
                 │  split query at last "/": prefix + leaf        │
                 │  filter: path must contain prefix             │
                 │  score(candidate, leaf):                      │
                 │    4 exact basename                           │
                 │    3 basename startsWith leaf                 │
                 │    2 basename includes leaf                   │
                 │    1 path includes leaf (fallback)            │
                 │  empty leaf → all score 0 (depth decides)     │
                 └───────────────────────┬──────────────────────┘
                                         ▼
                 ┌──────────────────────────────────────────────┐
                 │  sort: score desc, depth asc, pathLen asc,    │
                 │        path alpha asc                         │
                 │  slice(0, MAX_RESULTS=50)                      │
                 └──────────────────────────────────────────────┘
```

### Why a visit budget instead of unbounded walk

A large repo (e.g. `node_modules` not ignored in some cwd, or a monorepo) could have 100k+ files. `IGNORE_DIRS` already prunes the worst offenders, and `depth ≤ 6` bounds recursion, but an explicit `MAX_VISITS` cap on entries scanned keeps the per-keystroke cost bounded and predictable even on pathological trees. Choose a value generous enough that normal repos are fully scanned (≈4000 entries) but small enough to stay well under the 150ms client debounce window. The cap is on *entries scanned*, not matches kept.

### Why basename-centric scoring

Users typing `@db` almost always want a file *named* `db.*`, not every path that happens to contain `db` (e.g. `src/dbg/util.ts`). Ranking exact/prefix/substring on the **basename** above a path-substring hit matches intent. Path-substring stays as the lowest tier so queries like `@server/db` (containing a slash) still work.

### Slash-aware query split

A basename-only score is dead weight when the query itself contains a `/` (a basename never contains `/`, so every slashed-query hit would collapse to tier 1). To keep ranking meaningful while drilling into a directory, split the query at the **last** slash:

```
query "x/db/co"  →  prefix = "x/db/"   leaf = "co"
────────────────────────────────────────────────────
  candidate must contain prefix "x/db/" in its path
  THEN score leaf "co" against the candidate basename:
    x/db/conn.ts     basename "conn.ts"  prefix "co"  tier 3
    x/db/config.ts   basename "config.ts" prefix "co" tier 3
    x/db/proto.co    basename "proto.co"  substr "co" tier 2
    x/db/readme.md   basename has no "co"            dropped
```

Rules:
- **No slash in query** (`@db`): leaf = whole query, no prefix filter. Score basename against every candidate (existing behavior).
- **Slash in query** (`@x/db/co`): prefix = everything up to and including the last `/`; leaf = the remainder. Candidate qualifies only if its path contains the prefix; then score leaf against the basename.
- **Trailing-slash / bare-dir query** (`@x/db` or `@x/db/`): the directory and its contents still surface. For `@x/db` (no trailing slash) the leaf is `db`, scored as a basename — so `x/db/` (dir, basename `db`) and files named `db*` under `x/` rank high, and path-substring keeps the directory's other contents in the set at tier 1. For `@x/db/` the leaf is empty → every candidate under `x/db/` matches, ordered by depth/alpha (directory-listing semantics).

This directly answers "does `@x/db` show stuff under the path?" — yes: the directory and everything beneath it appear, and as the user types a leaf (`@x/db/co`) the closest files in that directory rank to the top instead of flat path order.

### Bare-`@` ordering

Empty query: every entry "matches", so score is uniform (0) and the depth tie-break dominates → top-level files and directories surface first, alphabetically. This directly fixes the "bare `@` shows random deep files" complaint without special-casing.

### Tie-breaks

1. **score desc** — relevance tier.
2. **depth asc** — shallower files are usually what's meant; also keeps results stable.
3. **pathLen asc** — shorter path wins among same depth (e.g. `db.ts` before `database.ts`).
4. **path alpha asc** — deterministic final order (stable across calls, test-friendly).

## Alternatives considered

| Alternative | Rejected because |
|---|---|
| Just bump `MAX_RESULTS` to 100, no ranking | Doesn't fix traversal-order starvation (first subtree still drains budget) or bare-`@`. More payload, still wrong order. |
| Breadth-first walk only (no scoring) | Fixes shallow-first but not relevance (`@db` still returns alphabetical path hits, not name matches). |

### Traversal: BFS + scoring (implementation refinement)

Implementation uses a **breadth-first** (level-order queue) walk, not the depth-first recursion of the original. Reason: `MAX_VISITS` bounds the scan, and a depth-first walk drains that budget inside the first deep subtree (e.g. this repo's large `openspec/changes/archive/`) before shallow siblings like root `package.json` are ever *visited* — so the anti-starvation requirement fails in real repos even with the result cap decoupled. BFS visits shallowest entries first, guaranteeing shallow matches are collected within the budget; ranking + tie-breaks still decide final order. This is BFS **plus** scoring — the union the "Breadth-first walk only (no scoring)" alternative lacked — so relevance is preserved. Verified by smoke (`@package` surfaces root `package.json`) and a >4000-entry regression test.
| fzf-style subsequence fuzzy matching | Larger surface, scoring tuning, more tests. Deferred — substring + ranking solves the reported pain. Can layer on later without protocol change. |
| Client-side ranking | Client only receives 20 already-truncated entries; ranking must happen where the full candidate set exists — the bridge. |

## Disjointness / compatibility

- Wire message `files_list { query, files }` unchanged. `FileEntry` shape unchanged.
- `CommandInput.tsx` renders `fileResults.files` as-is — raising the cap to 50 just shows a longer dropdown; existing keyboard nav / selection / stale-query handling are count-agnostic.
- The only observable change: which entries appear and in what order. Pure improvement, no migration.

## Open questions

- Final values for `MAX_VISITS` (≈4000?) and `MAX_RESULTS` (≈50?) — tune against a real repo walk timing under the 150ms debounce. Pick in implementation, assert only the *behavioral* invariants (ranked, capped, shallow-first) in tests.
- Should directories rank differently from files at the same score? (Leaning: no special-case in v1; depth/pathLen tie-break already orders them sensibly.)
