# spawn-preflight.ts — index

Pure sync preflight: checks cwd exists/is-dir/writable + pi+node resolvable. Returns `PreflightResult { ok, reasons[] }`. useLoginShell must be false. See change: spawn-failure-diagnostics. Emits BOTH legacy `DIR_MISSING` reason and new `cwd_missing` code when cwd absent (one-release overlap). See change: add-worktree-lifecycle-actions.
