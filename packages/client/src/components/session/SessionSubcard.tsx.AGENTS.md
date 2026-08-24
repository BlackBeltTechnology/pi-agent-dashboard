# SessionSubcard.tsx — index

Inset titled panel wrapper grouping session-card sections (OPENSPEC, WORKSPACE, PROCESS, MEMORY, FLOWS). `SessionSubcard({title, children})`. Renders nothing when children null/false/undefined/empty array. Visual: no panel fill (border only), border, `rounded-lg`, `px-2 py-1.5`, `mt-1.5`; legend capsule filled `--bg-primary` (card bg) to mask border line; centered uppercase title uses `--text-tertiary` + `font-semibold` (was `--text-muted`) for AA contrast in light mode. See change: redesign-session-card-subcards. See change: light-mode-pill-contrast.
