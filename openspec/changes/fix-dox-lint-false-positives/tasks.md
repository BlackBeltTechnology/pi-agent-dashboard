# Tasks — fix `kb dox lint` false positives

## 1. Row-path resolution (Defect A)
- [ ] `dox.ts:263` — resolve row paths against `dirname(af)`, not `cwd` → verify: unit fixture with a valid basename row in a sub-dir `AGENTS.md` reports 0 orphans
- [ ] Confirm `broken-pointer` + absolute-path branches still behave → verify: existing dox tests green
- [ ] Guard `--fix`: re-run on this repo, confirm no valid rows pruned → verify: `git diff --stat` shows no AGENTS.md row deletions on a clean tree

## 2. DOX-table scoping (Defect B)
- [ ] Add heading-tracking to the row scan in `doxLint` — only parse rows under a `# DOX —` heading → verify: unit fixture with a non-DOX prose table (backtick path cell) yields 0 rows
- [ ] Apply the same guard in `doxInit` (`dox.ts:134`) → verify: init/lint agree on row set for a mixed file
- [ ] Root `AGENTS.md` contributes 0 DOX rows → verify: `Explore`/`react-expert`/`qa/packer/*.pkr.hcl` no longer reported

## 3. Regression + integration
- [ ] Add the two spec scenarios (resolution, table-scope) as tests → verify: `npm test` covers both
- [ ] Run `kb dox lint --json` on this repo → verify: total issues drop from 1226 to the real remainder (~38: 8 over-threshold + 30 missing-companion + true gaps)

## 4. Documentation
- [ ] Delegate the `docs/`-side note (if any) to a general-purpose subagent per AGENTS.md Documentation Update Protocol, caveman style
- [ ] Update `packages/kb/src/AGENTS.md` `dox.ts` row purpose to note dir-relative resolution + DOX-heading scoping (direct edit — source tree)
