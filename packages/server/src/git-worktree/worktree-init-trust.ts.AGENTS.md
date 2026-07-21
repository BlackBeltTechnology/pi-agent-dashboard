# worktree-init-trust.ts — index

TOFU trust store. `isTrusted(repoRoot,hash)`/`recordTrust(repoRoot,hash)` keyed by `repoRoot + sha256(canonical(worktreeInit))`. Persists JSON `~/.pi/dashboard/worktree-init-trust.json`. Untrusted until recorded; hash change re-prompts. See change: generalize-worktree-init-hook.
