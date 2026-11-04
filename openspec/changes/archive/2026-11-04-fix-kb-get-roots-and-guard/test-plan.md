# Test Plan — fix-kb-get-roots-and-guard

Stage: design   Generated: 2026-11-04

All scenarios route to L1 (vitest). Every behavior under this change is a pure
function over the store, the ref classifier, the guard state machine, or the
source resolver (which already has `testHooks` for `fetch`/`git`). No rendered
UI, no process/VM concern, no new harness → no L2/L3/perf rows.

Harness exemplars to copy glue from:
- store / section / resolveFetch → `packages/kb/src/__tests__/retrieval-quality.test.ts`
- `kb_get` tool → `packages/kb-extension/src/__tests__/kb-search-tool.test.ts`
- guard → `packages/kb-extension/src/__tests__/guard.test.ts`
- classifier / git resolver → `packages/kb/src/__tests__/sources-git-guard.test.ts`
- https resolver → `packages/kb/src/__tests__/sources-archive.test.ts`

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | multi-root resolution | EP | L1 | automated | store with roots A then B; `guide.md` indexed only in B | `resolveFetch(store, roots, "guide.md")` | returns B's `guide.md` first section; not `missing` |
| E2 | multi-root resolution | coverage | L1 | automated | multi-root store, no relative path indexed in >1 root | every path printed by `kb_search` passed to `resolveFetch` | each returns a `hit`; zero `missing` |
| E3 | CLI/tool agree | equivalence | L1 | automated | same multi-root fixture | same path fetched via `kb get` resolver path and via `kb_get` tool | identical hit / candidate list / not-found marker |
| E4 | multi-root resolution | EP (invalid) | L1 | automated | path indexed in no root | `resolveFetch(store, roots, "nope.md")` | `missing`; tool prints `(not found: nope.md)` |
| E5 | source-qualified path (dir) | EP | L1 | automated | root dir `.pi/docs` indexes `knowledge-base.md` | fetch `.pi/docs/knowledge-base.md` | returns that root's section; no candidate list |
| E6 | source-qualified path (id, remote) | EP | L1 | automated | root id `git:https://github.com/o/r` indexes `README.md` | fetch `git:https://github.com/o/r:README.md` | returns that root's `README.md`; id containing `:` round-trips (longest-id-match) |
| E7 | qualifier disambiguates | decision-table | L1 | automated | roots `docs` and `vendor` (no `.` root) both index `README.md` | fetch `vendor/README.md` | returns `vendor` section, no collision list |
| E8 | literal+qualified both resolve → ambiguous | decision-table | L1 | automated | root `.` indexes `docs/a.md`; root `docs` indexes `a.md` | fetch `docs/a.md` | `ambiguous`, candidates `.:docs/a.md` and `docs:a.md`, no body |
| E9 | ambiguous path → candidates | decision-table | L1 | automated | `AGENTS.md` indexed in roots `packages/a` and `packages/b` | fetch `AGENTS.md` | `ambiguous`; candidates `packages/a:AGENTS.md`, `packages/b:AGENTS.md`; `found:false`, `candidates:2`; no body |
| E10 | candidate round-trips | state | L1 | automated | result of E9 | pass a listed candidate back to `resolveFetch` | returns that candidate's section |
| E11 | section exact heading path | EP | L1 | automated | file with section `Guide > Setup > Files` | fetch with section `Guide > Setup > Files` | returns that exact section |
| E12 | section unique last heading | EP | L1 | automated | file with exactly one section whose last heading is `Files` | fetch with section `Files` | returns that section; not `missing` |
| E13 | section ambiguous last heading | decision-table | L1 | automated | file with sections `A > Files` and `B > Files` | fetch with section `Files` | lists both full heading paths; no body |
| E14 | section unknown | EP (invalid) | L1 | automated | no heading-path or last-heading matches | fetch with section `Nope` | not-found marker |
| E15 | getChunk unchanged for other callers | regression | L1 | automated | existing `getChunk` fixtures | call `getChunk(root, path, headingPath)` and path-only | exact-match + `suppressedSections` behavior byte-identical to current tests |
| E16 | ref classification (github repo) | decision-table | L1 | automated | refs `https://github.com/o/r`, `.../r.git`, `.../r@v1`, `.../r/tree/main`, `github.com/o/r`, `ssh://git@github.com/o/r` | `classifyRef(ref)` | each returns `git` |
| E17 | ref classification (file/archive stay https) | decision-table | L1 | automated | `raw.githubusercontent.com/...md`, `github.com/o/r/blob/..`, `github.com/o/r/archive/..zip` | `classifyRef(ref)` | each returns `https` |
| E18 | non-repo github paths not cloned | decision-table | L1 | automated | `github.com/o/r/issues`, `/pull/1`, `/wiki`, `/actions` | `classifyRef(ref)` | returns `https` (not `git`) |
| E19 | explicit kind wins | equivalence | L1 | automated | `{kind:"https", ref:"https://github.com/o/r"}` | resolve kind selection | uses https resolver despite git-looking ref |
| E20 | git tree URL → revision only | state-transition | L1 | automated | ref `https://github.com/o/r/tree/dev` | `gitUrlOf` + `gitRefOf` | clone URL `https://github.com/o/r`, checkout ref `dev`; explicit `pin` overrides |
| E21 | ssh URL clones over ssh | EP | L1 | automated | ref `ssh://git@host/o/r` (fake git hook) | git resolver | clone argv targets the ssh URL under host/argv hardening |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | https rejects HTML body | fault-injection | L1 | automated | fetch hook returns `<!doctype html>...` for `https://github.com/o/r` (kind https) | resolve | throws naming the URL + suggesting `kind:"git"`; no file `r` cached; no fetch marker written |
| X2 | https rejects extensionless body | fault-injection | L1 | automated | fetch hook returns non-HTML body, URL basename has no indexable extension | resolve | throws naming the URL; nothing cached |
| X3 | https markdown still indexes | fault-injection (happy) | L1 | automated | fetch hook returns markdown for `...guide.md` | resolve | file cached and extension matched case-insensitively (`.MD` accepted) |
| X4 | previous cache survives refused refetch | fault-injection | L1 | automated | previously cached https source, refresh refused by content check | resolve with refresh | earlier cached content + fetch marker unchanged |
| X5 | indexed-path lookup unavailable degrades | fault-injection | L1 | automated | guard predicate throws (store error / removed cwd) | `cat AGENTS.md` fed to guard | tool call proceeds; chain counter unaffected; no throw surfaces |

### Guard decision-table

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| G1 | guard counts indexed md read | decision-table | L1 | automated | `AGENTS.md` indexed; predicate true for it | `cat AGENTS.md`, `head -50 AGENTS.md`, `sed -n 1,40p docs/guide.md` | each increments the search chain |
| G2 | unindexed read does not count | decision-table | L1 | automated | `src/index.ts` and `CHANGELOG.md` not indexed | `cat src/index.ts`, `sed -n 1,40p CHANGELOG.md` | chain counter unaffected |
| G3 | sed -i (write) excluded | boundary | L1 | automated | `AGENTS.md` indexed | `sed -i s/a/b/ AGENTS.md` | chain counter unaffected (in-place edit is a write) |
| G4 | grep chain still fires | state | L1 | automated | three consecutive search actions, no kb call | third search action | nudge naming the kb call |
| G5 | non-search bash never counts | EP | L1 | automated | `npm test`, `echo hi` | fed to guard | chain unaffected |
| G6 | piped / or-chained search counts | decision-table | L1 | automated | `x | rg y`, `rg x || true`, search binary on own line | fed to guard | counts as a search action |
| G7 | escalation text offers no carry-on | string-contract | L1 | automated | guard fires a second time, no kb call between | read escalation message | names `kb_search`/`kb_get`; contains no "carry on"-style permit to keep searching |
| G8 | advisory never blocks | state | L1 | automated | advisory mode, guard fires repeatedly | ladder exhausted | no tool call blocked |
| G9 | default mode advisory | EP | L1 | automated | no guard mode configured | resolve mode | effective mode advisory; nothing blocked |
| G10 | block only by config | state | L1 | automated | `block` in config, ladder exhausted | third firing | search tool call blocked with reason naming the kb call |
| G11 | env cannot enable block | boundary | L1 | automated | `KB_GUARD_MODE=block`, config not block | resolve mode | mode not block; env can still select `off`/`warn` |

---

## Coverage summary

- Requirements covered: all delta requirements across the 3 spec files
- Scenarios by class: edge 21 · perf 0 · frontend 0 · error 5 · guard 11
- Scenarios by level: L1 37 · L2 0 · L3 0
- Scenarios by disposition: automated 37 · manual-only 0

## New infra needed

- none (extends existing vitest suites named in Harness exemplars)
