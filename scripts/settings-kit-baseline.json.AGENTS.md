# settings-kit-baseline.json — index

Shrink-only baseline for `settings-kit-guard.mjs`: `{counts}` map `<file>::<kind>` → count. Legacy non-settings files only; no entry for a file in the 15 plugins' settings closure. See change: retro-ux-plugin-settings-wave-2.

Hand-added entry: `packages/subagents-plugin/src/client/SubagentDockGroup.tsx::muted-text: 1`. The dock Stop button copies the shell Kill-button classes verbatim (`ProcessesLaneBody.tsx:49-50`, incl. `disabled:text-[var(--text-muted)]`; asserted by `SubagentDockGroup.test.tsx` 4.8), and `--write` cannot grow the baseline. See change: show-background-subagents-in-dock.
