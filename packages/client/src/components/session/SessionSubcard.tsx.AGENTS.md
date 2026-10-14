# SessionSubcard.tsx — index

Inset titled panel wrapper grouping session-card sections (OPENSPEC, WORKSPACE, PROCESS, MEMORY, FLOWS). `SessionSubcard({title, children})`. Renders nothing when children null/false/undefined/empty array. Visual: no panel fill (border only), border, `rounded-lg`, `px-2 py-1.5`, `mt-1.5`; legend capsule filled `--bg-primary` (card bg) to mask border line; centered uppercase title uses `--text-tertiary` + `font-semibold` (was `--text-muted`) for AA contrast in light mode. See change: redesign-session-card-subcards. See change: light-mode-pill-contrast.

Optional `menu?: SubcardMenuTarget` renders `SubcardLegendMenu` inside the capsule; panel carries `group/sub`. See change: configurable-session-card-sections.

- Legend is `text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]`, overhang `-top-2` (was 12 px `-top-1.5`; was 9 px tertiary before that); same tokens as `SLOT_PILL_LEGEND`, pinned by a parity test. Panel `mt-2.5 px-2 pt-2.5 pb-1.5` (was `mt-1.5 py-1.5`) so the legend clears the content and the element above. See change: retro-ux-plugin-settings-forms. See change: fix-slot-pill-legend-and-stale-overflow.
