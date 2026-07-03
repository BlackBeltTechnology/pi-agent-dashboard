# SessionSubcard.tsx — index

Inset titled panel wrapper grouping session-card sections (OPENSPEC, WORKSPACE, PROCESS, MEMORY, FLOWS). `SessionSubcard({title, children})`. Renders nothing when children null/false/undefined/empty array. Visual: `bg-[var(--bg-surface)]`, border, `rounded-lg`, `px-3 py-2`, `mt-2`; centered uppercase title uses `--text-tertiary` + `font-semibold` (was `--text-muted`) for AA contrast in light mode. See change: redesign-session-card-subcards. See change: light-mode-pill-contrast.
