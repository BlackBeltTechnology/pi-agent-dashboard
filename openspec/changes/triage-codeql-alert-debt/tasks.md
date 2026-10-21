# Tasks

## 1. Spike — prove modelled guards close CI alerts (design D3, D4)

- [ ] 1.1 In `packages/server/src/routes/openspec-routes.ts`, replace the `sessionManager.listAll()` membership check guarding the flagged sink with `admitCwd` + `admissionAllows` (D1). Verify: existing openspec-routes tests pass (`npm test`) and an unknown cwd returns the route's current refusal status.
- [ ] 1.2 Move `within()` to `packages/shared/src/path-containment.ts`, re-export it from `packages/server/src/lib/path-containment.ts`, and add `Member[within].Argument[0]` (with and without the `.js` suffix) to `.github/codeql/extensions/cwd-guard.model.yml` with the D2 precondition comment. Verify: `tsc --noEmit` clean; path-containment unit tests pass unchanged.
- [ ] 1.3 Make `scripts/codeql-local.mjs` load `.github/codeql/extensions/` (D4). Verify: `npm run codeql -- --json` no longer reports the `openspec-routes.ts` and `office-preview.ts` path-injection results; the ratchet's own tests (`scripts/__tests__/codeql-local*.test.*`) pass.
- [ ] 1.4 Push a throwaway branch and PR to `develop` with tasks 1.1–1.3. Verify: the PR's CodeQL analysis no longer contains the `openspec-routes.ts` alert, nor the `office-preview.ts` alert (#-numbers recorded in the PR body). **Gate:** if either is still reported, stop. Run `systematic-debugging` on the model; if still unresolved, re-plan this change to bulk dismissal and void groups 2–3.

## 2. Shared guards rollout — containment sites (D2)

- [ ] 2.1 Route every core-route `within()` call site behind an admitted base (`browse.ts`, `office-preview.ts`, `keeper-manager.ts`, `process-manager.ts`, `git-routes.ts`). Verify: the per-file path-injection counts drop in `npm run codeql -- --json`; route tests pass.
- [ ] 2.2 For lib sinks reached with a route-joined relative path (`grep.ts`, `md-candidates.ts`, `resolve-file-mention.ts`, `canvas-settings.ts`, `changelog-*.ts`), add a `within(joined, admittedRoot)` check at the route before the lib call, refusing with the route's existing out-of-scope status. Verify: a `../` traversal test per route returns the refusal; codeql counts drop.
- [ ] 2.3 Unit-test the `within` re-export parity: server-local and shared import return identical results for the boundary fixtures of the `cwd-session-containment` spec (exact, descendant, sibling-prefix, trailing-separator, empty). Verify: test file passes.
- [ ] 2.4 Add the repo-lint test pinning the D2 precondition: every `within(` call in `packages/server/src/routes/**` passes a second argument bound from an admission result or its realpath. Verify: the test passes; a seeded violation fixture fails it.

## 3. Shared guards rollout — cwd admission sites (D1, spec core-cwd-admission)

- [ ] 3.1 `file-routes.ts`: replace the 11 ad-hoc `listAll` membership checks with `admitCwd` + `admissionAllows`, preserving each route's current refusal status and body. Verify: the existing file-routes suite passes; codeql reports 0 path-injection results in `file-routes.ts` beyond baseline `github-dismissed` entries.
- [ ] 3.2 `git-routes.ts` `validateCwd`: add admission after the existence/directory checks; refuse with `cwd_invalid` + a not-a-known-folder message (spec: Worktree endpoints refuse unknown directories). Verify: new tests for an unknown existing directory (refused, no git spawned — assert via the git exec spy), a pinned dir's linked worktree (admitted), and the three unchanged messages.
- [ ] 3.3 `git-operations.ts` / `worktree-init.ts` / `openspec-archive.ts` / `openspec-tasks.ts` / `changelog-fs.ts` / `spawn-preflight.ts` callers: ensure every route reaching them passes the admitted cwd value (not the raw request value). Verify: codeql counts for these files reach 0 or only residue listed in task 6.1.
- [ ] 3.4 `folder-project-routes.ts` / `folder-project.ts`: confirm the existing `admitCwd` result is branched with `admissionAllows` before the sink. Verify: codeql no longer reports `folder-project*.ts`.
- [ ] 3.5 Measure `/api/file` and `/api/file/digest` p50 latency before and after group 3 on the local instance (100 requests, same file). Verify: the delta is ≤ 2 ms, recorded in the PR body.
- [ ] 3.6 CHANGELOG `## [Unreleased]` → `### Changed`: worktree endpoints refuse directories that are not known folders (pin the folder to allow). Verify: entry present.

## 4. Config — ignore throwaway code (spec codeql-local-ratchet)

- [ ] 4.1 Add `spike/**` and `**/test-support/**` to `.github/codeql/codeql-config.yml` `paths-ignore` and update its header comment. Verify: the ratchet's ignore tests extended with a `spike/` and a `test-support/` fixture produce no results (spec scenario "Ignored paths produce no local results"); `--prune` removes the 5 `spike/` and the `fake-oidc-issuer.ts` baseline entries.
- [ ] 4.2 Update `.github/codeql/AGENTS.md` and `.github/codeql/extensions/AGENTS.md` rows (local ratchet now loads the extension; `within` model). Verify: rows present.

## 5. Per-finding triage of remaining `untriaged` entries (D5)

- [ ] 5.1 Client XSS / URL redirection (`WhatsNewDialog`, `UsersSection`, `ToolsSection`, `CtxToolRenderer`, `client-utils/identity/login-flow.ts`): add an `http:`/`https:` scheme allowlist helper (shared, one place) and render untrusted text as text. Verify: unit tests for `javascript:` / `data:` hrefs rejected; codeql results gone.
- [ ] 5.2 Preview renderers (`MermaidBlock`, `DocxPreview`, `DiagramPreview`, `adoc-math`): confirm the sanitizer per site. Verify: sanitized → `--triage … --reason "false-positive: <sanitizer>"`; else fix with a test injecting `<img onerror>`.
- [ ] 5.3 Request forgery (`model-proxy-api.ts`, `provider-probe.ts`, `oidc-flow.ts`, `login-flow.ts`): classify per D5. Verify: each entry has a fix + test or an `accepted-risk:` reason naming the config source.
- [ ] 5.4 Shell / command injection (`shared/platform/{exec,process,spawn-runtime}.ts`, `cli.ts`): remove `shell: true` where argv form works; else `operator-authz:`. Verify: the platform spawn tests pass on the CI matrix (win/mac/linux); codeql reasons set.
- [ ] 5.5 Remaining rules (`regex-injection` ×2, `polynomial-redos`, `prototype-polluting-assignment` ×2, `resource-exhaustion` ×2, `xml-bomb`, `double-escaping`, `unvalidated-dynamic-method-call`, `incomplete-sanitization`, `scripts/i18n-*`): fix or reason per D5. Verify: a targeted unit test per code fix.
- [ ] 5.6 Verify: `jq '[.entries[]|select(.reason=="untriaged")]|length' codeql-baseline.json` prints `0`; `node scripts/codeql-local.mjs --check-baseline-diff origin/develop` passes.

## 6. Residue dismissal + GitHub mirror (D6, spec "Baseline reasons are mirrored on GitHub")

- [ ] 6.1 After merge and the post-merge `develop` CodeQL scan, list open alerts and map each to its baseline entry (file + line → lineHash via `last-run.json`). Verify: a mapping table is written to `evidence/residue.md`; every open alert maps to a non-`untriaged` entry.
- [ ] 6.2 Run `doubt-driven-review` on the residue list before dismissing. Verify: the review note is appended to `evidence/residue.md`.
- [ ] 6.3 Dismiss each residue alert (trial one first), with the GitHub reason derived from the baseline reason (`operator-authz`/`accepted-risk` → `won't fix`; `false-positive` → `false positive`) and the same comment text; rewrite each entry to `github-dismissed (#n, …)` via `--triage`. Verify: the spec scenario "Triaged entry has no open alert" holds (`gh api …/alerts?state=open` cross-checked against the baseline prints no match).

## Workflow follow-up

- Archive via `ship-change`; sync the `codeql-local-ratchet` delta and the new `core-cwd-admission` spec.
- Update the `docs/code-quality.md` "CodeQL ratchet" section (DocScribe): the local run loads the extensions; new ignore globs.
