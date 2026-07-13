---
name: "fix-worktree-opsx-skills-not-created"
description: "Diagnose/fix worktrees missing the generated openspec-* (opsx) skills after worktreeInit. Root cause: bare `npx openspec` can resolve a squatted registry stub instead of the real CLI."
version: 1
created: "2026-07-13"
updated: "2026-07-13"
---
## When to Use
Use when a git worktree lacks the OpenSpec experimental-workflow skills (.pi/skills/openspec-explore, openspec-new-change, etc.), the /opsx: slash commands are missing, or openspec-apply-change stalls in a worktree. Also when auditing the .pi/settings.json worktreeInit hook.

## Procedure
1. Confirm the skills are GENERATED, not committed: `.pi/.gitignore` has `skills/openspec-*/**` (only `openspec-shared` is tracked). So every fresh worktree starts without them and must regenerate via `openspec init`.
2. Know the CLI package: the `openspec` binary is provided by the SCOPED package `@fission-ai/openspec` (declared in packages/server, hoisted to root node_modules/.bin/openspec). The BARE name `openspec` on npm is a squatted `0.0.0` stub that does nothing.
3. Root cause of silent failure: worktreeInit ran `npx openspec init ...`. When the local .bin/openspec isn't resolvable from the worktree root (hoisting/install timing/npx cache), bare `npx openspec` fetches `openspec@0.0.0` → init creates nothing → no opsx skills, while the `&&` chain still exits 0.
4. Fix: in .pi/settings.json worktreeInit.run.command, call the scoped package explicitly: `npx @fission-ai/openspec init --tools pi --force`. npx then resolves the local install (or fetches the CORRECT scoped package) and can never hit the 0.0.0 stub.
5. Verify: fresh worktree → `npx @fission-ai/openspec init --tools pi --force` → `ls .pi/skills/ | grep openspec-` shows 8 generated skills + openspec-shared (9 total). CLI prints `8 skills and 8 commands in .pi/` and `/opsx:new`.
6. To backfill an existing broken worktree: cd into it and run `npx @fission-ai/openspec init --tools pi --force` (safe — the openspec-* dirs are gitignored so this won't dirty git).

## Pitfalls
- Don't use `npx --no-install @fission-ai/openspec` in a worktree that hasn't run `npm ci` yet — nothing is installed, so it errors. The worktreeInit chain runs `(npm ci || npm install)` FIRST, so plain `npx @fission-ai/openspec` is correct.
- The worktreeInit gate `test ! -d .pi/skills/openspec-explore` correctly re-triggers init when only the skills are missing (OR-chained), so the gate is fine — the bug was the command, not the gate.
- `openspec init --force` may rewrite tracked AGENTS.md/CLAUDE.md; the gitignored `.pi/skills/openspec-*` dirs are safe to (re)generate.

## Verification
1. git worktree add --detach /tmp/wt develop; cd /tmp/wt; npx @fission-ai/openspec init --tools pi --force; test -d .pi/skills/openspec-explore && echo OK; git worktree remove --force /tmp/wt
2. npm view openspec version  # → 0.0.0 (proves the bare-name stub); npx --no-install @fission-ai/openspec --version  # → real 1.4.x from local install