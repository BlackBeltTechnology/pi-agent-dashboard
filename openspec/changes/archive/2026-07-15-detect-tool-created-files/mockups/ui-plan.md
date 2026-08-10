# UI Plan — detect-tool-created-files

Surface: **Files panel** (`packages/client/src/components/DiffFileTree.tsx`) — the
changed-file list. This change adds a per-file **origin** signal and a
**`created by <command>`** attribution, reusing the existing row language.

## Grounded contract (from DiffFileTree.tsx)

- Row: `flex items-center gap-1.5 px-2 py-0.5`, hover `bg-[var(--bg-tertiary)]`.
- Status glyph today: `+` (green, added) / `●` (yellow, modified) as the first token.
- Established pill pattern (the `summed` badge): `rounded bg-[var(--bg-tertiary)]
  px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]`.
- Secondary/muted text: `text-[var(--text-tertiary)]`; truncation + `title` tooltip
  (as used for change-event `message`).

## Tokens (theme-system CSS vars — no raw hex in components)

| Role | Var |
|------|-----|
| Row hover / pill bg | `--bg-tertiary` |
| Panel / expanded bg | `--bg-secondary` |
| Filename | inherit (`--text-secondary`) |
| Attribution / labels | `--text-tertiary` |
| Border | `--border-primary` |
| Added (Write) glyph | Tailwind `text-green-400` (existing) |
| Modified (Edit) glyph | Tailwind `text-yellow-400` (existing) |
| **Tool origin (new)** | `text-violet-400` — distinct from add/modify, reads as "not hand-authored" |

## Origin → visual

| origin | glyph | pill | attribution line |
|--------|-------|------|------------------|
| `write` | `+` green | — | — |
| `edit` | `●` yellow | — | — |
| `tool` | `◆` violet | `TOOL` pill | `created by <producedBy>` (mono, truncated, tooltip) |
| `mixed` | `●`/`+` (real change) | `TOOL` pill | `created by <producedBy>` |

Rules:
- Attribution `producedBy` renders in a mono span, tertiary, `truncate`, full command in `title`.
- Binary/oversized tool rows: no `+/−` counts, no diff — the `TOOL` pill still shows.
- Non-git `bash-artifact` rows are visually identical to git `tool` rows (origin is the same).
- The pill is opt-in per row (only tool/mixed), never on plain write/edit — avoids badge noise.

## States to verify

- Plain write/edit rows unchanged (regression guard).
- `tool` row with attribution + `TOOL` pill.
- `tool` row **without** attribution (git-detected, no Bash match) → pill only, no `created by`.
- `mixed` row (real change glyph + pill).
- Binary tool row (image) → pill, no counts.
- Long `producedBy` truncates; tooltip carries full command.
- Dark + light, 3 breakpoints; badge legible, not dominating (the manual-only U2 scenario).
