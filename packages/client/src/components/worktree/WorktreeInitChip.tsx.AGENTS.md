# WorktreeInitChip.tsx — index

Presentational worktree-init status chip (variant A/D1). running → `⚙ Initializing… · {elapsed}` + slim indeterminate bar + ghost lastLine + collapsed `<details>` log; done → green `✓ Initialized`; failed → red `✕ {label} · {code}` + Retry + opt-in log (sticky). `variant` manual/auto. Reused by button, session-card sub-state, stack. See change: friendlier-worktree-init.
