# Design

## Context

See proposal.md (Why). The current state that shapes the approach:

- `kb_get` hard-codes the first source: `const root = cfg.resolvedSources[0]?.id ?? ""` (`packages/kb-extension/src/extension.ts:389`), then `store.getChunk(root, path, section)` (`:390`).
- The `kb get` CLI loops over every source and returns the **first** hit (`packages/kb/src/cli.ts:346-351`). It never reports a collision.
- `getChunk(root, path, headingPath?)` matches `heading_path` exactly (`packages/kb/src/sqlite-store.ts:799-808`). A path-only fetch returns the first chunk plus `suppressedSections` (design D7 of `fix-kb-search-retrieval-quality`).
- `resolveNodeIds` (`packages/kb/src/sqlite-store.ts:762-770`) falls back from an exact node name to the heading-path **minus the file prefix** (`substr(name, length(path)+2) = ?`) — this is NOT a last-heading (last ` > ` segment) match. The last-heading fallback this change needs is new, not existing parity.
- `resolvedSources` is filesystem-only and synchronous by design (`config.ts:153`, filtered at `:418`). Remote sources are resolved asynchronously via `resolveAll` only in the `kb index` CLI path (`cli.ts:129`); the extension auto-reindex (`reindex.ts:246,262`) walks `resolvedSources` and so indexes filesystem sources only. Chunk `root` in the DB is the source id for every indexed source, remote included.
- The push-mode `tool_call` hook receives `ctx` (`extension.ts:408`); the guard's own `tool_call` hook (`:431`) currently ignores it. Stores are per-cwd (`getKbOrEmpty(state, cwd)`).
- A chunk's `heading_path` joins headings with `" > "` (`packages/kb/src/chunker.ts:113`). Chunk `root` is the source id, which is the raw `spec.ref` (`packages/kb/src/sources.ts:41`, `:271`, `:406`, and `config.ts:422` for filesystem). Chunk `path` is relative to `src.dir` (`packages/kb/src/indexer.ts:165`, `:200`).
- `kb_search` condensed output prints `h.path` only (`packages/kb/src/render.ts:47`). The `root` is not printed.
- The guard counts a bash segment only when its first token is in `SEARCH_BINARIES` (`packages/kb-extension/src/guard.ts:26`, `:104`). The escalation text ends with "carry on" (`:111`). `createGuard` has only a `mode` option (`:87`). It is fed once per call from its own `tool_call` hook (`extension.ts:431`).
- `classifyRef` sends every `https?://` and `ssh://` ref to `https` (`packages/kb/src/sources.ts:74-79`). `gitUrlOf` already prefixes `github.com/...` with `https://` (`:162-168`), but classification reaches it only through a `git:` prefix. The https resolver writes a non-archive body under `plainFileName(url.pathname)` with no content check (`:335`, `:289-295`), so `https://github.com/o/r` caches an HTML file named `r`. Both behaviors were reproduced with the real functions (stubbed fetch).

## Goals / Non-Goals

**Goals:**
- One fetch resolver in `packages/kb`, used by both the tool and the CLI, so the two cannot diverge again.
- No change to the `kb_search` output, the eval golden sets or the store schema.
- Guard stays a pure, synchronous state machine. Index knowledge is injected, never queried from inside the guard.

**Non-Goals:**
- Printing source-qualified paths in `kb_search` output. A collision list is enough, and this keeps the condensed-output requirement and goldens untouched.
- GitLab, Bitbucket or other forge URL heuristics. Users set `kind: "git"` for those.
- Changes to block-mode defaults or the guard threshold.

## Decisions

### D1. `resolveFetch` lives in `packages/kb` as a pure function over the store
`resolveFetch(store, roots, arg, section?) -> { kind: "hit", chunk } | { kind: "ambiguous", candidates } | { kind: "missing" }`. `roots` is `{ id, relDir? }[]` built from the store's distinct `root` values (a new `store.listRoots()` over `SELECT DISTINCT root FROM chunks`), NOT from `resolvedSources` — that is filesystem-only and would hide every remote root. `relDir` is populated only for roots that match a filesystem `allSourceSpecs` entry (`relative(cwd, dir)`, always rendered with `/`); remote roots have no `relDir`, so only literal and id-qualified readings apply to them. The tool (`extension.ts:389`) and the CLI (`cli.ts:346`) each call it and render the result.
*Alternative:* fix only the extension, as in the issue's prototype. Rejected because the CLI's first-match loop has the same collision bug.
*Alternative:* drive `roots` from `resolvedSources`. Rejected — it excludes git/https roots, so `kb_get` could never reach a remote section even after `kb index` indexed it.

### D2. Readings of a path argument
Build the candidate set as the union of:
1. **Literal:** `(s, arg)` for every source `s` where the path exists.
2. **Id-qualified:** for each source id that `arg` starts with followed by `:`, take `(s, rest)`. The longest matching id wins, so ids that contain `:` (such as `git:https://...`) are handled.
3. **Dir-qualified:** for each source with `relDir` not equal to `""` or `.`, if `arg` starts with `relDir + "/"`, take `(s, rest)`.

The result is deduplicated by `(sourceId, path)`. One reading gives a hit, none gives missing, and more than one is ambiguous. This follows the spec rule that a literal reading and a qualified reading which both resolve count as a collision. Candidates are always rendered as `<sourceId>:<path>`, which reading 2 accepts unchanged. Reading 3 exists so the human-friendly form (`.pi/docs/x.md`) also works.
*Alternative:* let a literal match win silently. Rejected because it brings back the "plausible but wrong file" failure the issue warns about.

### D3. Section lookup is a new store method; `getChunk` is untouched
Section lookup tries the exact `heading_path` first. If that misses and `section` contains no ` > `, it falls back to the last ` > ` segment: `heading_path = ?` OR `substr(heading_path, -length(?)-3) = ' > ' || ?` (exact suffix comparison, no LIKE wildcards to escape). One match is a hit, several are ambiguous (listing full heading paths), none is missing. This ships as a NEW store method `getChunkBySection(root, path, section) -> Chunk[]`; `getChunk` keeps its exact-`heading_path` semantics unchanged because `cli.ts:349`, `git-scope/scope.ts:104` and `extension.ts:390` all depend on it. This last-heading behavior is new (see Context — `resolveNodeIds` is a different fallback).
Section disambiguation runs only after the path resolved to exactly one root. An ambiguous path returns its root candidates first.

### D4. Tool output shapes
- **Hit:** unchanged (body plus the `(+N more sections …)` trailer and the staleness prefix).
- **Ambiguous path:** `(ambiguous: <arg> is indexed in N sources — pass one of:)` followed by one candidate per line. Details: `{ found: false, candidates: N }`.
- **Ambiguous section:** the same shape, listing full heading paths for the `section` argument.
- **Missing:** unchanged `(not found: <arg>)`.

### D5. Guard markdown-read detection via a cwd-aware injected predicate
The guard stays a pure synchronous state machine. The predicate is computed in the extension (which has both `ctx.cwd` and the store) and passed in per call: the guard's `tool_call` hook (`extension.ts:431`) gains the `ctx` param (as the push-mode hook at `:408` already has) and attaches `isIndexedPath` onto the `GuardInput` it feeds to `note`. The guard never touches a store or a cwd itself.
In `isSearchAction`, a segment whose first token is in `READ_BINARIES = {cat, head, tail, sed, less, more, bat}` counts when any non-flag argument `a` satisfies `input.isIndexedPath(a)`. `sed -i` (in-place edit — a write, not a read) is excluded. `sed`'s script argument is skipped: when no `-e`/`-f` script flag is present, the first non-flag token after `sed` is treated as the script. Without a predicate on the input, read binaries never count — that keeps every existing guard unit test valid and makes the degradation path the default.
The extension resolves the predicate for `ctx.cwd`: a per-cwd `Set` of absolute indexed paths, built from `SELECT DISTINCT root, path` over that cwd's store and resolved against each root's dir, rebuilt when the cwd's index generation advances. `getKbOrEmpty` on a removed cwd throwing is swallowed by `guardNoteSafe` to `null`, so a store error degrades to not counting (spec).
*Alternative:* one global path `Set`. Rejected — stores are per-cwd, so a global set misattributes paths across ≥2 cwds.
*Alternative:* count every `*.md`. Rejected because `sed -n` on an unindexed changelog during an edit would trigger false nudges.

### D6. Escalation text
"[kb] Repeated source searching, still no kb consult. Your next call should be kb_search (or kb_get <path> for a file you are about to read)." The `carry on` clause is removed. The block-mode reason is unchanged.

### D7. GitHub classification precedes generic https
In `classifyRef`, `ssh://` maps to `git`. A `github.com` URL maps to `git` ONLY when its path is exactly `<owner>/<repo>` (optionally `.git`, `@<ref>`, or a `/tree/<ref>` suffix). Any other `github.com` path — `/blob/`, `/raw/`, `/archive/`, `/releases/`, `/issues`, `/pull`, `/wiki`, `/actions`, `/settings`, etc. — stays `https` (a `/blob/` or `/raw/` or `.md` is a file; the rest are rejected by D8). A bare `github.com/<o>/<r>` also maps to `git`. `gitUrlOf` normalizes a git-classified ref to `https://github.com/<o>/<r>` (strip `.git`, a `/tree/<ref>` suffix, `@ref`). `gitRefOf` extracts the `/tree/<ref>` or `@<ref>` revision, with an explicit `pin` winning. A path deeper than `/tree/<ref>` is NOT auto-derived into a subdir (that plumbing — carrying a remainder from `classifyRef`/`gitUrlOf` into the resolver at `sources.ts:270` — does not exist); a deeper path requires an explicit `subdir`, and a `tree`-ref whose name contains `/` requires `pin`.
*Alternative:* auto-derive the subdir from `/tree/<ref>/<path>`. Deferred — it needs new plumbing to carry the remainder through resolution; explicit `subdir` covers it meanwhile.
*Alternative:* add GitHub archive-zip download (no git binary). Deferred because the git path already exists and is hardened.

### D8. https indexable-content check
In the non-archive branch of the https resolver (the `writeFileSync(join(out, plainFileName(...)))` path, `sources.ts:~392`, inside the staging `try` whose `finally` removes the stage at `~402`): reject when the body sniffs as HTML (after a leading BOM/whitespace/HTML comment it starts with `<!doctype html` or `<html`, case-insensitive), or when `extname(plainFileName)` (lower-cased) is not in the configured `extensions` (the match must be case-insensitive — the indexer's own extension match at `indexer.ts:156` is `/i`, so an `.MD` source must not be rejected). For a `github.com/.../blob/<path>` URL the error names the equivalent `raw.githubusercontent.com` URL; for a repo page it suggests `kind: "git"`. Rejection throws before `swapInto`, so the `finally` cleanup and the untouched `dest` give the spec's "previous cache survives" behavior for free. `extensions` reaches the resolver through `ResolveCtx` (new optional field, defaulting to the config defaults at `config.ts:167`).

## Risks / Trade-offs

- [Cold index: `kb_get` must still return the index-is-being-built indication, not `(not found)`.] → `resolveFetch` replaces only the `getChunk` call; the existing freshness + `BUILDING_LINE` guard (`extension.ts:385-388`) runs before it and is preserved, so the pull-retrieval requirement holds.
- [`.` root makes a dir-qualified fetch ambiguous (literal + qualified both resolve).] → True by the collision rule. The "qualifier selects, no collision list" scenario is tested with named `docs`/`vendor` roots and no `.` root, where only the qualified reading resolves. Fixtures must avoid a `.` root for that case — noted so the test is not flaky-by-construction.
- [Windows path separators.] → `relDir` and candidate paths are always normalized to `/`; the dir-qualified match compares on `/`. Cross-platform QA covers it.
- [Shell-parse gaps in the read predicate: quotes, `$VAR`, globs, `FOO=1 cat f` env prefixes.] → Same bounded naive-split the search-binary detection already accepts; a miss means the read is not counted (under-counts, never false-nudges). Acceptable.
- [Ref-spelling duplicates (`o/r` vs `o/r.git`) produce distinct roots → duplicate clones and both appear as candidates.] → Pre-existing identity behavior; the candidate list simply shows both.
- [A GitHub URL that was configured as `https` gets reclassified to `git`. Its cacheKey and trust hash change, so there is a re-prompt and a fresh clone.] → Accepted and noted in the proposal. The old cache is orphaned but harmless.
- [Ambiguity output is a new shape that agents must read.] → It names the next action and its candidates round-trip. A unit test locks the format.
- [Guard predicate cost on every bash call.] → O(args) set lookups. The set is built once per index generation.
- [The `/tree/<ref>/<path>` split is wrong for branch names containing `/`.] → The spec says to use `pin` for those, and the resolver error from a failed clone names the branch it tried.
- [Wider guard counting may increase nudges.] → Advisory mode only. The proposal requires a before/after session comparison before any default change.

## Migration Plan

No data migration. Ship behind no flag. Rollback means reverting the commit. Existing indexes are reused as-is because chunk `root` and `path` are unchanged.

## Open Questions

- Should the root `AGENTS.md` substitution table mention source-qualified `kb_get` paths? This is a docs wording choice and can be decided at implementation time.
