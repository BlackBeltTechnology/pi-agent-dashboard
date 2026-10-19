# Guard baseline (task 1.2)

Recorded before any migration edit. Design D8.

## `theme-token-guard`

`SCAN_ROOTS` gained `packages/client-utils/src` and `packages/dashboard-plugin-runtime/src`.

- Findings under the new roots: **1**.
  - `[fallback-form]` `--accent-primary` in `dashboard-plugin-runtime/src/embedded-app-shell.tsx` (`hover:border-[var(--accent-primary,#3b82f6)]`).
- `--write` refuses to grow the baseline (and `--bootstrap` would bypass the shrink-only ratchet), so the binding was fixed instead: the fallback literal is dropped (`--accent-primary` is declared in `index.css`).
- Result: `scripts/theme-token-baseline.json` is **unchanged** (99 fallback, 55 undeclared, 63 accent-as-text). The baseline did not grow.
- Deviation from the task text ("record with `--write`"): nothing needed recording once the one finding was fixed.

## `aligned-surfaces` regex scan over the 9 D8 files

Palette class, hex or `rgb(a)(` in string / template literals (AST scan, comments skipped).

| File | Hits | Where |
|---|---|---|
| `client-utils/src/StatusPill.tsx` | 24 | `rgba()` / `rgb()` maps, lines 21-35 (task 3 deletes them) |
| `client-utils/src/Dialog.tsx` | 1 | `bg-red-600 …` danger action, line 198 (task 6.1) |
| `client/src/components/settings/ProviderHealthPill.tsx` | 3 | `text-green-400`, `text-yellow-400`, `text-red-400`, lines 79, 96 (task 5.1) |
| `dashboard-plugin-runtime/src/settings-fields.tsx` | 0 | |
| `client/src/components/session/SessionActionsPanel.tsx` | 0 | |
| `client/src/components/packages/plugin-row-parts.tsx` | 0 | |
| `client/src/components/settings/services/services-ui.tsx` | 0 | |
| `client/src/components/settings/vault/vault-ui.tsx` | 0 | |
| `client/src/components/settings/vault/OperateRequiredCallout.tsx` | 0 | |

Every hit sits in a block a migration task replaces. No hit outside the migrated blocks.
