# Tasks

## 1. Store: root enumeration + section-by-last-heading (`packages/kb`)

- [x] 1.1 Add `store.listRoots()` over `SELECT DISTINCT root FROM chunks`; add to the `KbStore` interface in `types.ts`.
- [x] 1.2 Add `store.getChunkBySection(root, path, section) -> Chunk[]`: exact `heading_path` first, then (when `section` has no ` > `) last-segment suffix match `substr(heading_path, -length(?)-3) = ' > ' || ?` plus `heading_path = ?`. Leave existing `getChunk` exact semantics untouched (callers: `cli.ts:349`, `git-scope/scope.ts:104`, `extension.ts:390`).

## 2. Shared `resolveFetch` resolver (`packages/kb`)

- [x] 2.1 Add `resolveFetch(store, roots, arg, section?)` returning `hit | ambiguous | missing`. `roots = {id, relDir?}[]` from `listRoots()`; `relDir` set only for roots matching a filesystem `allSourceSpecs` entry, normalized to `/`.
- [x] 2.2 Build candidate readings: literal `(s, arg)` where path exists; id-qualified (longest matching `id:` prefix wins, so ids containing `:` round-trip); dir-qualified (`relDir + "/"`). Dedup by `(id, path)`. One → hit; none → missing; >1 → ambiguous with `<id>:<path>` candidates.
- [x] 2.3 Section disambiguation runs only after the path resolves to one root; return section candidates (full heading paths) when ambiguous.
- [x] 2.4 Rewire `kb get` CLI (`cli.ts:346-351`) to call `resolveFetch` and render hit / candidate list / not-found.

## 3. Source classification + https content check (`packages/kb/src/sources.ts`)

- [x] 3.1 `classifyRef`: `ssh://` → `git`; `github.com/<o>/<r>` (optionally `.git`, `@<ref>`, `/tree/<ref>`) → `git`; any other `github.com/...` path and `raw`/`blob`/`archive` → `https`; explicit `kind` still wins.
- [x] 3.2 `gitUrlOf`/`gitRefOf`: normalize git-classified GitHub refs to `https://github.com/<o>/<r>`; extract `/tree/<ref>` or `@<ref>` revision (explicit `pin` wins). No auto-subdir from a deeper path; a `/`-containing tree ref requires `pin`.
- [x] 3.3 https non-archive branch (`sources.ts:~392`, before `swapInto`): reject HTML-sniffed bodies and bodies whose `plainFileName` extension (lower-cased) is not in `extensions` (case-insensitive, matching `indexer.ts:156`). Error names the URL; `/blob/` → raw URL hint, repo page → `kind:"git"` hint. Throw before `swapInto` so `dest` + fetch marker survive.
- [x] 3.4 Thread `extensions` to the resolver via a new optional `ResolveCtx` field (default from `config.ts:167`).

## 4. `kb_get` tool wiring (`packages/kb-extension`)

- [x] 4.1 Replace the `resolvedSources[0]` + `getChunk` block (`extension.ts:389-390`) with `resolveFetch` over `listRoots()`, keeping the existing freshness/`BUILDING_LINE` guard (`:385-388`) ahead of it.
- [x] 4.2 Render hit (unchanged trailer + staleness prefix), ambiguous path/section (candidate list, `found:false` + candidate count in details), and missing.

## 5. Guard: markdown-read predicate + escalation text (`packages/kb-extension/src/guard.ts`)

- [x] 5.1 `isSearchAction`: a segment leading with `READ_BINARIES = {cat,head,tail,sed,less,more,bat}` counts when a non-flag arg satisfies `input.isIndexedPath(a)`; exclude `sed -i`; skip `sed`'s script arg. No predicate → never counts.
- [x] 5.2 Give the guard's `tool_call` hook (`extension.ts:431`) the `ctx` param; attach a per-cwd `isIndexedPath` (built from `SELECT DISTINCT root, path` for `ctx.cwd`'s store, resolved to absolute paths, rebuilt on index-generation change) onto the `GuardInput`.
- [x] 5.3 Replace the escalation text: name `kb_search`/`kb_get` as the next call; remove the "carry on" clause. Block-mode reason unchanged.

## 6. Docs

- [x] 6.1 Update kb skill / root `AGENTS.md` wording for `kb_get` source-qualified paths and last-heading sections; update README source examples (GitHub repo URL now works; note remote sources index via `kb index`).
- [x] 6.2 Update `packages/kb/src/AGENTS.md`, `packages/kb/src/sqlite-store.ts.AGENTS.md`, and `packages/kb-extension/src/` AGENTS rows for new symbols (`listRoots`, `getChunkBySection`, `resolveFetch`, guard predicate).

## 7. Tests — folded from test-plan.md (all L1 vitest, `automated`)

- [x] 7.1 Hit in a non-first root resolves. input: roots A,B, `guide.md` only in B · trigger: `resolveFetch(…,"guide.md")` · observable: returns B's section, not missing. see `packages/kb/src/__tests__/retrieval-quality.test.ts` (test-plan #E1)
- [x] 7.2 Every `kb_search` path resolves. input: multi-root, no path in >1 root · trigger: each path → `resolveFetch` · observable: all hits, zero missing. see retrieval-quality.test.ts (test-plan #E2)
- [x] 7.3 CLI and tool agree. input: same fixture · trigger: `kb get` resolver vs `kb_get` tool · observable: identical hit/candidates/not-found. see kb-search-tool.test.ts (test-plan #E3)
- [x] 7.4 Unknown path → not found. input: path in no root · trigger: `resolveFetch(…,"nope.md")` · observable: missing / `(not found: nope.md)`. see retrieval-quality.test.ts (test-plan #E4)
- [x] 7.5 Dir-qualified path. input: root `.pi/docs` has `knowledge-base.md` · trigger: fetch `.pi/docs/knowledge-base.md` · observable: that section, no candidates. see retrieval-quality.test.ts (test-plan #E5)
- [x] 7.6 Id-qualified remote path round-trips. input: root id `git:https://github.com/o/r` has `README.md` · trigger: fetch `git:https://github.com/o/r:README.md` · observable: returns section (id with `:` handled). see retrieval-quality.test.ts (test-plan #E6)
- [x] 7.7 Qualifier disambiguates. input: roots `docs`,`vendor` both have `README.md`, no `.` root · trigger: fetch `vendor/README.md` · observable: `vendor` section, no collision list. see retrieval-quality.test.ts (test-plan #E7)
- [x] 7.8 Literal+qualified both resolve → ambiguous. input: root `.` has `docs/a.md`, root `docs` has `a.md` · trigger: fetch `docs/a.md` · observable: candidates `.:docs/a.md`,`docs:a.md`, no body. see retrieval-quality.test.ts (test-plan #E8)
- [x] 7.9 Same path in two roots → candidates. input: `AGENTS.md` in `packages/a`,`packages/b` · trigger: fetch `AGENTS.md` · observable: candidates listed, `found:false`,`candidates:2`, no body. see retrieval-quality.test.ts (test-plan #E9)
- [x] 7.10 Candidate round-trips. input: E9 result · trigger: pass candidate back · observable: returns that section. see retrieval-quality.test.ts (test-plan #E10)
- [x] 7.11 Section exact heading path. input: section `Guide > Setup > Files` · trigger: fetch with that section · observable: exact section. see retrieval-quality.test.ts (test-plan #E11)
- [x] 7.12 Section unique last heading. input: one section ends `Files` · trigger: section `Files` · observable: that section, not missing. see retrieval-quality.test.ts (test-plan #E12)
- [x] 7.13 Section ambiguous last heading. input: `A > Files` and `B > Files` · trigger: section `Files` · observable: both full paths listed, no body. see retrieval-quality.test.ts (test-plan #E13)
- [x] 7.14 Section unknown. input: no match · trigger: section `Nope` · observable: not-found marker. see retrieval-quality.test.ts (test-plan #E14)
- [x] 7.15 `getChunk` unchanged for other callers. input: existing getChunk fixtures · trigger: exact + path-only getChunk · observable: byte-identical to current tests. see retrieval-quality.test.ts (test-plan #E15)
- [x] 7.16 Classify GitHub repo refs → git. input: 6 repo ref spellings incl ssh · trigger: `classifyRef` · observable: each `git`. see `packages/kb/src/__tests__/sources-git-guard.test.ts` (test-plan #E16)
- [x] 7.17 Classify file/archive → https. input: raw, /blob, /archive.zip · trigger: `classifyRef` · observable: each `https`. see sources-git-guard.test.ts (test-plan #E17)
- [x] 7.18 Non-repo github paths not cloned. input: /issues,/pull,/wiki,/actions · trigger: `classifyRef` · observable: `https`, not `git`. see sources-git-guard.test.ts (test-plan #E18)
- [x] 7.19 Explicit kind wins. input: `{kind:"https", ref:"https://github.com/o/r"}` · trigger: kind selection · observable: https resolver used. see sources-git-guard.test.ts (test-plan #E19)
- [x] 7.20 Tree URL → revision only. input: `.../r/tree/dev` · trigger: `gitUrlOf`+`gitRefOf` · observable: URL `.../r`, ref `dev`, `pin` overrides. see sources-git-guard.test.ts (test-plan #E20)
- [x] 7.21 ssh URL clones over ssh. input: `ssh://git@host/o/r` (fake git) · trigger: git resolver · observable: clone argv targets ssh URL under hardening. see sources-git-guard.test.ts (test-plan #E21)
- [x] 7.22 https rejects HTML body. input: fetch hook returns HTML for repo URL (kind https) · trigger: resolve · observable: throws naming URL + `kind:"git"` hint; no file `r`; no marker. see `packages/kb/src/__tests__/sources-archive.test.ts` (test-plan #X1)
- [x] 7.23 https rejects extensionless body. input: non-HTML body, no indexable ext · trigger: resolve · observable: throws naming URL; nothing cached. see sources-archive.test.ts (test-plan #X2)
- [x] 7.24 https markdown indexes (case-insensitive ext). input: markdown for `...guide.md` / `.MD` · trigger: resolve · observable: cached + accepted. see sources-archive.test.ts (test-plan #X3)
- [x] 7.25 Previous cache survives refused refetch. input: cached https source, refresh refused by check · trigger: resolve w/ refresh · observable: earlier content + marker unchanged. see sources-archive.test.ts (test-plan #X4)
- [x] 7.26 Indexed-path lookup unavailable degrades. input: predicate throws · trigger: `cat AGENTS.md` fed to guard · observable: call proceeds, chain unaffected, no throw. see `packages/kb-extension/src/__tests__/guard.test.ts` (test-plan #X5)
- [x] 7.27 Guard counts indexed md read. input: `AGENTS.md` indexed, predicate true · trigger: `cat`/`head`/`sed -n` on indexed md · observable: chain increments. see guard.test.ts (test-plan #G1)
- [x] 7.28 Unindexed read does not count. input: `src/index.ts`,`CHANGELOG.md` unindexed · trigger: `cat`/`sed -n` on them · observable: chain unaffected. see guard.test.ts (test-plan #G2)
- [x] 7.29 `sed -i` excluded. input: `AGENTS.md` indexed · trigger: `sed -i s/a/b/ AGENTS.md` · observable: chain unaffected. see guard.test.ts (test-plan #G3)
- [x] 7.30 Grep chain still fires. input: 3 search actions no kb call · trigger: third action · observable: nudge naming kb call. see guard.test.ts (test-plan #G4)
- [x] 7.31 Non-search bash never counts. input: `npm test`,`echo hi` · trigger: fed to guard · observable: chain unaffected. see guard.test.ts (test-plan #G5)
- [x] 7.32 Piped / or-chained search counts. input: `x | rg y`,`rg x || true`, own-line search · trigger: fed to guard · observable: counts. see guard.test.ts (test-plan #G6)
- [x] 7.33 Escalation text no carry-on. input: guard fires twice, no kb call · trigger: read escalation · observable: names `kb_search`/`kb_get`, no "carry on". see guard.test.ts (test-plan #G7)
- [x] 7.34 Advisory never blocks. input: advisory mode, repeated firings · trigger: ladder exhausted · observable: nothing blocked. see guard.test.ts (test-plan #G8)
- [x] 7.35 Default mode advisory. input: no mode configured · trigger: resolve mode · observable: advisory, nothing blocked. see guard.test.ts (test-plan #G9)
- [x] 7.36 Block only by config. input: `block` in config, ladder exhausted · trigger: third firing · observable: search call blocked w/ reason naming kb call. see guard.test.ts (test-plan #G10)
- [x] 7.37 Env cannot enable block. input: `KB_GUARD_MODE=block`, config not block · trigger: resolve mode · observable: not block; env still selects off/warn. see guard.test.ts (test-plan #G11)

## 8. Verify

- [x] 8.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green for `packages/kb` + `packages/kb-extension`.
- [x] 8.2 `openspec validate fix-kb-get-roots-and-guard` passes.
- [x] 8.3 Manual: in a multi-root repo, a `kb_search` hit from a non-first root is fetchable via `kb_get` (the issue-#1114 regression).

## Workflow follow-up

- Before/after session comparison (several days of real sessions) on kb-call rate, grep/cat-on-md rate, and guard firings before changing any guard default or enabling block mode — per proposal Impact. Advisory-only ships now.
