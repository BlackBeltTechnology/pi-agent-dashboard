# UI plan — slim compact folder cards (sidebar-folder-ux, #1134 / D4)

| Surface | Tokens | States |
|---|---|---|
| Compact-empty folder header | name `--text-secondary`; count `--text-secondary` (never `--text-muted`), hover `--text-primary` | N=0 (no count), 1, 18; dark/light + one palette |
| Compact-attention folder | unchanged: header + attention cards | no Group-by row, no count |
| Focus + blocked folder | `FolderActionBanner compact` | chip suppressed (renders nothing) |

Replaces the old `N sessions — click to view` row (`--text-muted`, fails contrast) and the Group-by chip row. Grouping stays in the folder menu.
