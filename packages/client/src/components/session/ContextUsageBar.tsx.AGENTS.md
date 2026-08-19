# ContextUsageBar.tsx — index

Progress bar showing context-window usage. Exports `ContextUsageBar`. Color thresholds: >80% red, >50% yellow, else green. `compact` mode hides percentage text. Renders nothing when `tokens`/`contextWindow` missing.

Compaction badge from `deriveCompactionBadge(compaction)`, `data-testid="compaction-badge"`. Renders two ways:
- `compact`: icon-only `mdiArrowCollapseVertical` marker, muted `var(--text-tertiary)`, no label text.
- non-compact: amber text pill `<label> <reduction>`, unchanged.

Both share tooltip `Compacted (<label>) <reduction> tokens`. Compact container `flex items-center gap-1 w-16`; track `flex-1 min-w-0` — icon cannot squeeze bar to stub. Reason: text pill squeezed bar in compact row; "manual" label read as mode toggle. See change: compact-compaction-icon-only.
