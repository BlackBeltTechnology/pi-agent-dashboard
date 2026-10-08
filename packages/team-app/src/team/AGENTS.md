# DOX — packages/team-app/src/team

One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `AgentCard.tsx` | Agent card: status (shape + word), chips (incl. skills count chip, names in `title`), activity line, Beszélgetés / "+ Új", stale callout, dim states, menu (edit / fork / delete by role). `skillBlock` → not dimmed, reason-specific warning callout, no chat buttons; admin Fix skill (`invalid`/`missing` → Skills panel) / Fix persona (`targets`/`users` → editor); member ask-admin note. See change: add-team-plugin. See change: add-team-skill-access. |
| `TeamGrid.tsx` | Grid: shared / own sections, loading / error / empty, 5 s polling, restart-stale, add-agents dialog, "Skills" secondary button (admin/operator) → `/skills`. See change: add-team-plugin. See change: add-team-skill-access. |
