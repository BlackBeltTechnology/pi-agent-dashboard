# Fix Git Checkout Command Injection

## Why

The security-boundary-audit verified (VD1) a command-injection RCE in the git
checkout path:

- `POST /api/git/checkout` (`git-routes.ts:118`) validates the body only with
  `if (!cwd || !branch)` — no character restriction.
- `checkoutBranch()` interpolates the request-supplied `branch` directly into a
  shell string: `run(\`git checkout ${branch}\`, cwd)` (`git-operations.ts:391`),
  and for remote branches `run(\`git checkout -b ${localName} ${branch}\`, cwd)`
  (line 383, where `localName = branch.replace(...)`).
- `run()` is `execSync(command, …)` (`git-operations.ts:27`) → `/bin/sh -c`.

Repro: `{ "cwd": "/tmp", "branch": "x; id > /tmp/pwned #" }` executes
`id > /tmp/pwned`. Reachable by any authenticated caller — a paired device over
the tunnel (networkGuard passes on a valid bearer) or any same-host process
(loopback).

The safe pattern **already exists in the same file**: `commitFiles` and other ops
use `runGitCapture([...])` (argv arrays, no shell). Checkout is a legacy
shell-string path that was never converted. A related defect: the `shellEscape`
helper used by the worktree/merge/PR ops (`git-operations.ts:787`) is POSIX-only
and does not neutralize cmd.exe metacharacters on Windows (audit B6) — the same
class of bug (untrusted git args reaching a shell).

## What Changes

- **Convert branch checkout to argv execution.** Replace the interpolated
  `run(\`git checkout …\`)` calls (lines 383, 387, 391) with the existing
  no-shell `runGitCapture(["checkout", …])` form so `branch`/`localName` are
  passed as arguments, never as shell text.
- **Validate branch names** against an allowlist (`^[\w./-]+$`, reject a leading
  `-` to prevent option injection) at the route boundary as defense-in-depth.
- **Eliminate remaining request-influenced shell-string git execution.** Convert
  the `shellEscape`-based `execSync(args.map(shellEscape).join(" "))` sites
  (worktree/merge/PR, lines ~913/1014/1027/1054) to argv `spawn`/`runGitCapture`
  so correctness no longer depends on platform-specific quoting.

Out of scope (audit follow-ups): the broader auth-guard uniformity
(`add-universal-network-guard`); redacting absolute paths / git stderr in error
bodies (audit B20).

## Impact

- **Closes:** VD1 git-checkout command injection; **B6** Windows `shellEscape`
  argument injection (same class, converted together).
- **Risk:** low — argv execution is behavior-preserving for valid branch names;
  the allowlist could reject unusual-but-valid ref names (e.g. containing spaces
  — git allows some), so the allowlist SHALL match git's ref rules closely and
  the argv conversion (not the allowlist) is the actual security boundary.
- **Affected specs:** `git-operations-api` (ADDED requirements).
- **Affected code:** `packages/server/src/git-operations.ts`,
  `packages/server/src/routes/git-routes.ts`.

## Discipline Skills

- `systematic-debugging` — reproduce the injection with a test payload first, then
  fix, then prove the repro no longer fires.
- `security-hardening` — injection prevention; argv-not-shell is the boundary,
  allowlist is defense-in-depth.
- `doubt-driven-review` — confirm the argv conversion preserves behavior for
  remote-tracking-branch checkout (the `-b localName branch` path).
