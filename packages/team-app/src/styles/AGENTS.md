# DOX — packages/team-app/src/styles

One row per file. Token authority: `packages/client/src/index.css` (`tokens.css` = verbatim copy); app rules reference `var(--…)` only, no new tokens. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `app.css` | Shipped team-app recipes: buttons, callouts, cards, chips, menu, forms, radio-cards, check-list, dialog, conversation panes. See change: add-team-plugin. |
| `index.css` | Tailwind + `@source` scan + `@import` tokens/app/skills. See change: add-team-plugin. |
| `skills.css` | add-team-skill-access additions (from the change mockup): `.skill-list/.skill-row` (invalid border), `.cell-label/.list-head` (≤768px stacked, sr labels), src/warn/ok/skill chips, `.lock-note`, `.skill-link`, picker (`.picker-search/.pick`), `.path-line`, `.impact`, `.skill-opt(s)` (disabled option + reason line), `.composer-error`; `.skill-row .row-actions` scoped right-align. See change: add-team-skill-access. |
| `tokens.css` | Verbatim token copy of `packages/client/src/index.css` blocks. See change: add-team-plugin. |
