---
name: "fix-worktree-opsx-skills-not-created"
description: "Diagnose/fix worktrees missing the generated openspec-* (opsx) skills after worktreeInit. Root cause: bare `npx openspec` can resolve a squatted registry stub instead of the real CLI."
version: 1
created: "2026-07-13"
updated: "2026-08-20"
---
## When to Use
Use when a git worktree lacks the OpenSpec lifecycle skills (`.pi/skills/openspec-explore`, `openspec-propose`, and related directories), `/opsx:` commands are missing, `openspec-apply-change` stalls, or `.pi/settings.json#worktreeInit` needs an audit.

## Procedure
1. Confirm the skills are generated, not committed. `.pi/.gitignore` contains `skills/openspec-*/**`; each fresh worktree must run `openspec init`.
2. Confirm the repository declares `@fission-ai/openspec` and identify its package-manager install command. The unscoped npm package `openspec` is a `0.0.0` stub.
3. Install repository dependencies before initialization. For this repository, run `pnpm install --frozen-lockfile`.
4. Use the repository-pinned binary when it exists:
   ```bash
   pnpm exec openspec init --tools pi --force
   ```
   `pnpm exec` uses the declared local dependency and fails when the binary is absent. In a repository that does not declare the CLI, use the version-pinned scoped package explicitly: `npx @fission-ai/openspec@1.6.0 init --tools pi --force`.
5. Verify the CLI reports setup success. Check the lifecycle skills this repository requires by name: `openspec-explore`, `openspec-propose`, `openspec-apply-change`, `openspec-update-change`, and `openspec-archive-change`.
6. Check `git status --short`. Generated `openspec-*` skill directories should remain ignored. Review any tracked context-file rewrite before continuing.

## Why the old path fails

Bare `npx openspec init ...` can fetch `openspec@0.0.0` when `node_modules/.bin/openspec` is absent. The stub exits without generating lifecycle skills. Installing dependencies first and using `pnpm exec openspec` preserves the lockfile-selected CLI and fails visibly when setup is incomplete.

## Pitfalls
- Run the dependency install first. `pnpm exec openspec` cannot recover a missing local binary.
- Do not hard-code the number of generated skills or commands. OpenSpec releases generate different sets; validate the required lifecycle names.
- The worktree-init gate `test ! -d .pi/skills/openspec-explore` correctly re-triggers initialization when generated skills are absent.
- `openspec init --force` can rewrite tracked `AGENTS.md` or `CLAUDE.md`. Generated skill directories are safe; tracked context changes require review.

## Verification

```bash
set -euo pipefail
before_status="$(git status --porcelain=v1)"
pnpm install --frozen-lockfile
pnpm exec openspec --version
pnpm exec openspec init --tools pi --force
for skill in openspec-explore openspec-propose openspec-apply-change openspec-update-change openspec-archive-change; do
  test -d ".pi/skills/$skill" || exit 1
done
test "$(git status --porcelain=v1)" = "$before_status"
```

Completion requires setup success, every named directory, and no unexplained tracked change.
