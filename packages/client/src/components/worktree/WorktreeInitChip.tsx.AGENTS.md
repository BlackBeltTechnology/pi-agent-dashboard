# WorktreeInitChip.tsx — index

Presentational worktree-init status chip (variant A/D1). running → `⚙ Initializing… · {elapsed}` + slim indeterminate bar + ghost lastLine + collapsed `<details>` log; done → green `✓ Initialized`; failed → red `✕ {label} · {code}` + Retry + opt-in log (sticky). `variant` manual/auto. Reused by button, session-card sub-state, stack. See change: friendlier-worktree-init.

fix-folder-card-pill-contrast: colour-free — spinner arc/bar/labels/elapsed/last line inherit `currentColor` from the hosting banner (no palette class, no `--text-muted`/`--text-tertiary`); glyphs `mdiCheckCircleOutline`/`mdiAlertCircleOutline`/`mdiReplay` replace `✓ ✕ ↻`; failure code on its own 11px mono line; Retry `border-current` 12px on its own row; log `<pre>` `--text-secondary` on `--bg-code` 11px; `compact` prop removed. See change: fix-folder-card-pill-contrast.
