# Proposal

## Why

Agents rarely read from the knowledge base, and part of the cause is our tooling rather than model behavior (issue #1114). `kb_get` only looks in the first resolved source, so a `kb_search` hit from any other root comes back `(not found)`. In a 9-root KB, about 88% of sections can't be fetched. The read-discipline guard ignores the usual workaround (`cat`/`head`/`sed` on markdown), and its escalation message tells the model it may carry on. Separately, a GitHub repo given as a plain URL, which is how most users would add one, never indexes the repo. It is classified as `https` and its HTML page is saved as a single file named `repo`, with no extension, so nothing gets indexed. `ssh://` git URLs are also classified as `https` and then rejected. The source reference then dead-ends at both the fetch step (`kb_get`) and the source step.

## What Changes

- **`kb_get` resolves across every indexed root.** The set of roots comes from the store (the distinct `root` values in the index), not from `resolvedSources` (which is filesystem-only by design, `config.ts:153`). One resolver in `packages/kb` is shared by the extension tool and the `kb get` CLI. The CLI already loops over roots but returns the first match, so it has the same collision bug. Resolving from the store also lets `kb_get` reach remote roots (git/https) that were indexed via `kb index`.
- **Root-prefixed paths are accepted.** A path can be qualified by a root's repo-relative directory (e.g. `.pi/docs/knowledge-base.md`) or by its source id (the `ref`, e.g. a git or npm ref). An unqualified path is still accepted.
- **Collisions are never silent.** When the same relative path exists in more than one root, `kb_get` returns the list of candidate root-qualified paths and no body. It does not return whichever root matched first. `kb_search` output is unchanged.
- **The `section` argument accepts a last heading.** The lookup tries an exact `heading_path` match, then a unique last-heading match (the same rule `kb_neighbors` already uses). If the last heading is ambiguous, it lists the matching sections.
- **The guard counts markdown reads.** A bash segment that leads with `cat`, `head`, `tail`, `sed`, `less`, `more`, `bat` and targets a file the KB has indexed counts as a search action. Reads of files that aren't indexed (source code, unindexed changelogs) still don't count.
- **New guard escalation text.** The "if the kb has no answer, carry on" line is removed. The message now says the next call should be a kb call.
- **GitHub repo URLs are classified and cloned correctly.** A ref of the form `https://github.com/<owner>/<repo>` (optionally with `.git`, a `/tree/<ref>` suffix, or `@<ref>`), `github.com/<owner>/<repo>`, or an `ssh://…` URL is classified as `git` and cloned. Direct file URLs (`raw.githubusercontent.com`, `/blob/`, `.md`) and archive URLs (`/archive/….zip|tar.gz`) stay `https`; other `github.com/...` paths (`/issues`, `/pull`, `/wiki`, …) also stay `https` and are rejected loudly rather than mis-cloned. An explicit `kind` still takes precedence. This corrects the resolver so a GitHub repo given as a source resolves when indexed; auto-indexing of remote sources inside the live extension is governed by the `resolvedSources` filesystem-only filter and is unchanged (pre-existing, out of scope) — remote sources are indexed via `kb index`.
- **`https` fetches that aren't markdown fail loudly.** A fetched body that isn't an archive and that doesn't have an indexable extension (or is HTML) fails resolution with a message that points to `kind: "git"`, instead of quietly indexing nothing.
- Vitest coverage for every item above, including a multi-root fixture with a path collision.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `markdown-knowledge-base`: the `kb_get` pull-retrieval contract gains multi-root resolution, root-prefixed paths, an explicit collision result, and the last-heading section fallback.
- `kb-read-discipline`: the guard's search-action definition is extended to markdown-read commands that target indexed files; the escalation-text requirement drops the "carry on" exit.
- `kb-source-resolution`: ref classification routes GitHub repo URLs and `ssh://` refs to `git`; the https resolver rejects non-indexable, non-archive bodies (HTML) instead of indexing nothing.

## Impact

- **Code:** `packages/kb/src/sqlite-store.ts` (a new section-by-last-heading lookup; existing `getChunk` keeps its exact-heading-path semantics — it has other callers at `cli.ts:349`, `git-scope/scope.ts:104`, `extension.ts:390`), a shared `resolveFetch` helper in `packages/kb`, `packages/kb/src/cli.ts` (`kb get`), `packages/kb/src/sources.ts` (`classifyRef`, `gitUrlOf`/`gitRefOf` for `/tree/<ref>`, https body check), `packages/kb-extension/src/extension.ts` (`kb_get`), `packages/kb-extension/src/guard.ts` (markdown-read predicate, escalation text) and its wiring to the indexed-path set.
- **Behavior:** `kb_get` responses that used to be `(not found)` now return content or a candidate list. Configs that used a GitHub URL as an `https` source switch to a git clone. Their cache key and trust hash change because the kind changes, so the trust prompt runs once more. This is a migration note, not a break.
- **Docs:** kb skill / AGENTS.md text that describes `kb_get` path and section arguments, and the README source examples.
- **Evaluation:** guard tightening is advisory-mode only. Before calling it a success, run a before/after comparison over several days of real sessions (kb call rate, grep/cat-on-md rate, guard firings). Block mode stays opt-in.
- **Out of scope:** capping `list_models` output size (separate ticket) and routing bash to context-mode `ctx_*` tools (third-party package).

## Discipline Skills

- `security-hardening`: the ref classifier now routes `ssh://` and GitHub URLs into the git clone path (same host/argv hardening), and the https resolver gains a content check that must reject before the cache swap.
- `scenario-design`: the multi-root collision fixtures (no `.` root for the qualifier case) and the guard decision table in `test-plan.md`.
