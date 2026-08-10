# Tasks

## 1. Reproduce (systematic-debugging)

- [ ] 1.1 Write a failing test that calls `checkoutBranch(tmpRepo, "x; touch INJECTED #", false)` and asserts the `INJECTED` file is NOT created. Confirm it currently FAILS (proves the injection).

## 2. Convert checkout to argv

- [ ] 2.1 Replace `run(\`git checkout ${branch}\`, cwd)` (git-operations.ts:391) with `runGitCapture(["checkout", branch], cwd)`.
- [ ] 2.2 Replace `run(\`git checkout -b ${localName} ${branch}\`, cwd)` (line 383) with `runGitCapture(["checkout", "-b", localName, branch], cwd)`; keep `run(\`git checkout ${localName}\`)` (387) → argv too.
- [ ] 2.3 Confirm the failing test from 1.1 now passes.

## 3. Branch-name validation

- [ ] 3.1 In `git-routes.ts` checkout handler, validate `branch` against `^[\w./-]+$` and reject a leading `-`; return 4xx on reject before calling `checkoutBranch`.

## 4. Eliminate shell-string git execution (B6)

- [ ] 4.1 Convert the `execSync(args.map(shellEscape).join(" "))` sites (worktree/merge/PR: ~913, 1014, 1027, 1054) to argv `spawn`/`runGitCapture` (`shell:false`).
- [ ] 4.2 Remove the now-unused `shellEscape` helper if no call sites remain.

## Tests

- [ ] T1 Injection blocked: `branch` = `x; id > /tmp/pwned #` → no file created, git-only execution.
- [ ] T2 Route rejects `--upload-pack=evil` and `a$(id)` with 4xx, git not invoked.
- [ ] T3 Local branch checkout works (behavior unchanged).
- [ ] T4 Remote-tracking checkout creates+checks out the local branch via argv.
- [ ] T5 Worktree/merge/PR ops: a ref with `&`/`;` is passed as one argv arg (no shell interpretation); POSIX result unchanged.

## Discipline checkpoints

- [ ] D1 `systematic-debugging` — red test (1.1) before the fix, green after.
- [ ] D2 `doubt-driven-review` — confirm the `-b localName branch` argv order matches the previous shell semantics (tracking-branch creation).
- [ ] D3 `security-hardening` — grep `git-operations.ts` for any remaining `execSync(\`…${…}…\`)` with request-derived interpolation; convert or justify.

## Validate

- [ ] V1 `openspec validate fix-git-checkout-command-injection --strict` passes.
- [ ] V2 `npm test` green (git operation + route suites).
- [ ] V3 Manual: `POST /api/git/checkout` with an injection payload returns a normal git error and executes nothing extra.
