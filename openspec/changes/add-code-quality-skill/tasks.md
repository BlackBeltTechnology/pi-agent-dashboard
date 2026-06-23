# Tasks — Code-Quality Skill (Biome ratchet)

## 1. Biome config foundation (Phase 0, fully soft)

- [ ] 1.1 Add `@biomejs/biome` as a root dev dependency → verify: `npx biome --version` resolves; `npm install` clean.
- [ ] 1.2 Add `biome.json` — `formatter.enabled: false`, `formatter.indentStyle: "space"`, `vcs` (`enabled: true`, `clientKind: "git"`, `useIgnoreFile: true`, `defaultBranch: "main"`), and ignores (`dist/`, `**/dist/`, `*.tsbuildinfo`, generated plugin-registry output, `openspec/changes/archive/**`) → verify: `npx biome lint .` runs without crashing and respects ignores.
- [ ] 1.3 Reconcile representative rule names in design.md against the installed Biome version (flag any in `nursery`); set Tier A / Tier B / Tier C and a11y all to `warn` initially → verify: `biome lint .` exits 0 (everything soft).
- [ ] 1.4 Add `overrides` to relax `__tests__/**` + `*.test.ts` (allow `noExplicitAny`, `noConsole`), `packages/server/**` (allow `noConsole`), `scripts/**` + `*.mjs` → verify: a test file with `any` produces no diagnostic.

## 2. npm scripts (the oracle + helpers)

- [ ] 2.1 Add `lint:biome` = `biome lint .` → verify: runs whole-repo analyze.
- [ ] 2.2 Add `fix:changed` = `biome check --changed --write` → verify: on a branch with a changed file containing a safe-fixable issue, the fix is applied and untouched files are not modified.
- [ ] 2.3 Add `quality:changed` = `biome check --changed --error-on-warnings --write && tsc --noEmit && npm test` → verify: exits 0 on a clean diff; exits non-zero when the diff has a warn-level issue (proves the oracle).
- [ ] 2.4 Add `quality:report` = `biome lint . --reporter=github` → verify: emits GitHub-annotation output; leave `lint` = `tsc --noEmit` unchanged.

## 3. CI soft-warn step

- [ ] 3.1 Add `npx biome lint . --reporter=github` after `npm run lint` in `.github/workflows/ci.yml` → verify: on a PR with only warn-tier issues, the job stays green and annotations appear.

## 4. Skill authoring

- [ ] 4.1 Write `.pi/skills/code-quality/SKILL.md` — description with NL triggers; the analyze → fix → test procedure for changed-files (goal) mode and whole-repo (cleanup) mode; the four guardrails; the two goal-text templates → verify: skill loads (appears in skill list) and references real npm scripts.
- [ ] 4.2 Document the safe-vs-unsafe fix policy and the whole-file-on-touch rough edge (grandfather default) in the skill → verify: skill instructs revert-on-red and forbids out-of-diff edits.

## 5. Phase 1 — graduate Tier A to error (separate cleanup PR)

- [ ] 5.1 Run `biome check --write` repo-wide for Tier A safe-fixes; manually resolve remaining Tier A violations → verify: `biome lint . --only` for each Tier A rule reports 0.
- [ ] 5.2 Flip Tier A rules to `error` in `biome.json`; confirm CI now hard-gates them → verify: `biome lint .` exits non-zero if a Tier A violation is reintroduced; `npm test` + `tsc` still pass.

## 6. Docs

- [ ] 6.1 Add `docs/code-quality.md` (tier ladder, graduation criterion, rollout phases, oracle, rough edge) — delegate to a subagent in caveman style → verify: file exists, pointer added in AGENTS.md if architectural.
- [ ] 6.2 Add file-index rows for `biome.json`, `.pi/skills/code-quality/SKILL.md`, `docs/code-quality.md`, and the new `package.json` scripts to the matching `docs/file-index-<area>.md` splits (path-alphabetical, caveman style, via subagent) → verify: rows present.

## 7. Verification (end-to-end)

- [ ] 7.1 Set a real goal via GoalControl using the daily-driver template against a branch with a deliberate warn-tier issue → verify: loop fixes it, judge marks achieved when `quality:changed` exits 0.
- [ ] 7.2 Full repo check: `npm run lint && npm test && npx biome lint .` → verify: lint + tests pass, Biome exits 0 (Tier A clean, Tier B/C warn only).
