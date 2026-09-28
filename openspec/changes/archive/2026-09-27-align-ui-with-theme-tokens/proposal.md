## Why

Live action surfaces paint accent text with raw Tailwind palette classes (`text-green-400`, `text-orange-400`, `text-yellow-300`, `text-indigo-400`, …) and readable labels with `--text-muted`. In the light theme these measure **1.12–2.99:1** on `--bg-secondary` (AA needs 4.5:1): the folder spawn tray's "New Session" is 1.70:1, "New Worktree" 2.28:1, worktree-dialog headings 2.32:1. Controls are also undersized — 10–11 px text in 110 places, `py-px`/`py-0.5` in 33, a 23 px worktree source toggle, ~16 px goal controls — and four of the surfaces have no `focus-ring`. axe misses most of the contrast failures because the backgrounds are semi-transparent (`bg-green-500/5`). The `add-acp-session-driver` mockups showed a token-based recipe that passes every gate in both themes; the user wants the live screens to match that look.

Measured by `mockups/ux-probe.cjs` on the live folder card: **3/10** (computed contrast, text size, target size and axe fail in both themes). Same probe on the after-mockup: **10/10**.

## What Changes

- **Identity tint tokens** `--tint-{green,orange,blue,purple,red}-{bg,fg,border}` in `index.css`, derived with the exact `color-mix` formula of `--severity-*`, so they clear the same contrast gate in every theme. `--severity-{success,warning,info,error}-*` become aliases of the matching tints (values unchanged).
- **Colour mapping on the listed surface files:** identity accents (pi = green, worktree = orange, fork/links = blue, goals = purple, destructive = red) → `--tint-*`; severity meaning → `--severity-*`; status meaning → `--status-*` on shapes/dots only, never on text. Raw palette classes and hard-coded hex removed from those files.
- **Readable labels:** section headings, field labels and help text use `--text-secondary` (or `--text-primary` for labels); `--text-muted` is kept only for disabled states and `aria-hidden` decoration; timestamps and counts move to `--text-secondary`.
- **Primary action recipe:** `bg-[var(--accent-solid)] text-white` (house pattern in `GatewayPage.tsx`) replaces `bg-blue-500/80` and similar.
- **Size floor:** interactive and help text ≥ 12 px, dense metadata ≥ 11 px, nothing smaller; buttons ≥ 44 px tall on mobile and ≥ 32 px (chips/toggles) from `sm:`.
- **Focus:** every button on these surfaces carries `focus-ring`.
- **`ui-contract.md`:** primary-button recipe fixed, the tint/severity/status mapping, the two size floors and the "status colour on shape, not text" rule recorded.
- **Copy:** every user-facing English "spawn"/"respawn" (31 known strings across client, shared doctor, server error messages, goal-, automation- and subagents-plugin; a scan is authoritative) becomes "new session" / "start" / "restart". Internal identifiers, protocol names and i18n keys are unchanged; Hungarian and client Chinese already say "start"; goal-plugin Chinese 重生 → 重启.
- Surfaces: `FolderSpawnButtons.tsx`, `SessionCard.tsx`, `WorktreeSpawnDialog.tsx`, `WorktreeList.tsx`, `GoalDetailClaim.tsx` (goal-plugin), `ConfirmRenderer.tsx`, `SelectRenderer.tsx`, `CreateAutomationDialog.tsx` (automation-plugin), plus `DashboardSpawnButtons.tsx` (same tray recipe) and the `OpenSpecBoardView.tsx` controls whose copy D9 changes. Layout and behaviour unchanged, except a small status shape before "Resuming…" (D2b).
- Out of scope: other components (repo-wide sweep), a lint rule banning palette classes, layout redesign, new themes.

## Capabilities

### New Capabilities
- `ui-terminology`: user-facing copy uses "new session"/"start"/"restart", never "spawn"; internal identifiers and i18n keys exempt.

### Modified Capabilities
- `message-severity-tokens`: adds identity tint triples (severity triples alias them), extends the no-raw-colour-literal rule to the listed action surfaces, and MODIFIES the relative contrast gate to cover tints with two more tokyo-night-light exceptions (`blue` = same colours as `info`, `purple`).
- `theme-system`: adds readable-label contrast, the primary-action recipe, the text/target size floors, status-colour-on-shape and visible focus for the listed action surfaces.

## Impact

- **Code:** `packages/client/src/index.css` (tint tokens + severity aliases); the surface files listed below; `ui-contract.md`; the English strings listed in design D9 (code fallbacks, `i18n-en-source.json`, plugin `i18n.ts` catalogs, doctor/server messages). No protocol, server or data change.
- **Compatibility:** visual only. Dark theme looks nearly identical (tints are the same hues, slightly more saturated text); light theme becomes readable. Controls get taller, which may add a few px of vertical space per card; no layout reflow beyond that.
- **Tests:** known existing assertions that change are listed in design D7 (class selectors in `GoalDetailClaim.test.tsx` and `SessionCard.test.tsx`; copy in `SessionCard.test.tsx`, `status-meta.test.ts`, `pi-runtime-picker.spec.ts`, `settings-page-composition.test.tsx`, `doctor-core.test.ts`, `diagnostics-spawn-runtime.spec.ts`); the full suite is the backstop. Selectors by `data-testid` are untouched. `WorktreeList.tsx` is also rendered by `ManageWorktreesDialog.tsx`, which inherits its restyle and is covered by F11.
- **Rollback:** revert the commit; tokens are additive and the severity aliases keep the same values.
- **Coordination:** `add-acp-session-driver` touches `FolderSpawnButtons`, `WorktreeSpawnDialog` and `GoalDetailClaim` too. Whichever lands second rebases; the ACP mockups already use this recipe, so the styles agree.

## Discipline Skills

- `performance-optimization`: not triggered (no data path or latency budget).
- `security-hardening`: not triggered (no input, auth or secrets).
- `observability-instrumentation`: not triggered (no new endpoint or job).
- `doubt-driven-review`: not triggered (no irreversible step; tokens are additive and the change reverts cleanly).
- `review-code`: run before commit, as for any non-trivial change.
