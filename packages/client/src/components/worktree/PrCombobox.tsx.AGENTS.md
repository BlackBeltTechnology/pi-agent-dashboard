# PrCombobox.tsx — index

Typeahead combobox for PR selection. Fetches `GET /api/git/pull-requests` lazily on first open. Rows: `#N · title · @author` + CI/draft badge. WAI-ARIA combobox pattern. See change: add-worktree-from-pull-request.

See change: align-ui-with-theme-tokens. Trigger `▾` chevron now `aria-hidden` + `--text-secondary` (was `--text-muted`, 1.4–2.9:1; E10 sweep).
