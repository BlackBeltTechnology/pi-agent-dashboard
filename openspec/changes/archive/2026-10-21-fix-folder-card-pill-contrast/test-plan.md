# Test Plan — fix-folder-card-pill-contrast

Stage: design   Generated: 2026-10-21

No clarifications outstanding (hard gate passed: every Triple below is concrete).

Harness facts used:
- L3 hook fixtures `/fixtures/sample-hook-ok` (slow success) and `/fixtures/sample-hook-fail` (exit 3) ship in the docker harness (`tests/e2e/worktree-init-feedback.spec.ts`). An untrusted fixture renders the retrust rung.
- Palette switching and per-cell floors follow `tests/e2e/severity-contrast.spec.ts`.
- Rendered contrast uses `tests/e2e/helpers/computed-contrast.ts`, plus the new `nonTextFailures` helper.
- L1 palette resolution follows `packages/client/src/lib/__tests__/action-menu-tone-contrast.test.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | directory-card-layout "Slot pill glyph … host hue tokens" / Legacy accent keys | decision-table | L1 | automated | `SlotPill` rendered once per accent `blue`,`indigo`,`cyan`,`teal`,`purple`,`red` | render | glyph span classes = `text-[var(--accent-blue-text)] bg-[var(--tint-blue-bg)]` for blue+indigo, `…green…` for cyan+teal, `…purple…`, `…red…`; root hover class `hover:border-[var(--tint-<h>-border)]`; no `-400`/`-500` class anywhere in the rendered tree |
| E2 | directory-card-layout "Glyph meets the non-text floor in every palette" | BVA (floor 3.0) | L1 | automated | 18 palettes (9 themes × dark/light) resolved from `index.css` + `THEMES` | resolve `--accent-<h>-text` vs `--tint-<h>-bg` for h ∈ blue, green, purple, red | every ratio ≥ 3.0 (72 cells); failure message names palette + hue + ratio |
| E3 | directory-card-layout "Markers meet the text floor in every palette"; theme-system "Readable metadata" | BVA (floor 4.5) | L1 | automated | same 18 palettes | resolve `--accent-orange-text`, `--accent-red-text`, `--accent-blue-text`, `--accent-green-text`, `--accent-yellow-text`, `--accent-purple-text` vs `--bg-secondary`; `--text-secondary` vs `--bg-secondary` in base dark + base light | every accent-text cell ≥ 4.5 (108 cells); `--text-secondary` ≥ 4.5 in both base modes |
| E4 | theme-system "Card pill colour roles" (phases) | decision-table | L1 | automated | `OpenSpecActivityBadge` with each of the 9 phases + `completedTasks=4,totalTasks=12` | render | root colour class: explore/continue/ff → `--accent-blue-text`; new/sync-specs/onboard → `--accent-purple-text`; apply → `--accent-yellow-text`; verify/archive → `--accent-green-text`; `(4/12)` span uses `--text-secondary`; no `--text-muted` |
| E5 | theme-system roles (artifact letters); openspec-attach-combo + proposal-attachment PDST | decision-table | L1 | automated | `ArtifactLettersButton` with artifacts `[proposal: done, design: ready, specs: blocked, tasks: missing]` | render | letter classes `--accent-green-text`, `--accent-yellow-text`, `--text-secondary`, `--text-secondary`; letters `text-[12px]`; hover border uses `--accent`; no palette class |
| E6 | theme-system roles (flow statuses, Abort) | decision-table | L1 | automated | `FlowActivityBadge` with status running (+`onAbort`), success, error, aborted | render | root colour `--accent-blue-text` / `--accent-green-text` / `--accent-red-text` / `--accent-orange-text`; Abort button carries `--tint-red-fg`, `--tint-red-bg`, `--tint-red-border` and `text-[12px]` |
| E7 | theme-system "Pill surface files contain no colour literals" | decision-table (file × literal kind) | L1 | automated | AST string/template literals of the 13 listed files + the 4 `SessionList.tsx` regions (`ToggleButton`, `renderAddToWorkspaceButton`, `search-include-archive` element, `folder-pinned-indicator-` element) | scan with rawPalette pattern, `#hex`, `rgba(`, `var(--x, <literal>)` | zero matches; and every `--text-muted` literal sits on a `disabled:` variant or an `aria-hidden="true"` element; a planted `text-amber-400` in a fixture copy of one file makes the scan fail naming that file |
| E8 | theme-system "A new raw palette class fails" | EP (new site) | L1 | automated | fixture tree with baseline lacking `::amber` for `Foo.tsx` | add `text-amber-400` to `Foo.tsx`, run guard `main()` | exit 1; stderr names `rawPalette`, `Foo.tsx`, `amber`, and the replacement families |
| E9 | theme-system "Side and offset forms are caught" | EP (syntax variants) | L1 | automated | fixture file with `border-l-blue-400`, `hover:ring-offset-red-500/40`, `md:text-emerald-300` | scan | three sites recorded (`::blue`, `::red`, `::emerald`) |
| E10 | theme-system "A baselined site cannot grow" / "The baseline only shrinks" | BVA (N-1, N, N+1) | L1 | automated | fixture baseline `Foo.tsx::blue = 2` | files with 1, 2, 3 `blue` classes | 3 → fail; 2 → pass; 1 → pass and reported as shrinkable repair; after `--write`, re-adding the second occurrence fails |
| E11 | theme-system "Token paints and non-colour utilities are not flagged" / "Test files are excluded" | EP (negative class) | L1 | automated | fixture with `text-[var(--accent-red-text)]`, `bg-[var(--tint-blue-bg)]`, `text-white`, `text-xs`, `border-2`; plus `Foo.test.tsx` containing `text-green-500` | scan | zero `rawPalette` sites |
| E12 | design D5 arm plumbing | state-transition (bootstrap → write) | L1 | automated | fixture baseline with three arms | `--write --bootstrap-arm rawPalette`, then remove one site, then `--write` | baseline JSON still contains a `rawPalette` key after the second write with the shrunk count; a second `--bootstrap-arm rawPalette` exits 1 ("bootstrap runs once"); `--write` that would grow `rawPalette` exits 1 |
| E13 | theme-system "pre-existing … do not fail" / "Migrated card pill files are not baselined" | invariant on real tree | L1 | automated | repo tree after migration + committed baseline | run guard `main()` on the real roots | exit 0; `rawPalette` map contains no key whose file is one of the 13 listed card-pill files (`SessionList.tsx` may appear) |
| E14 | folder-action-banner "Retrust rung explains itself" / "A never-trusted hook gets the same banner" | decision-table | L1 | automated | `FolderActionBanner` with status `{hasHook:true, trusted:false}` | render | region `folder-banner-retrust-<cwd>` contains "Init hook needs your trust before it can run" outside `worktree-init-btn`; button text exactly "Review & trust"; button contains no `svg`; region contains one `svg` glyph with `mdiShieldAlertOutline` path; text does not contain "changed" |
| E15 | folder-action-banner "Init-needed rung explains itself" | decision-table | L1 | automated | status `{hasHook:true, trusted:true, needsInit:true}` | render | `folder-banner-init-needed-<cwd>` contains "Init hook hasn't run in this checkout" and a `worktree-init-btn` with text "Initialize" and no inner `svg` |
| E16 | folder-action-banner "Rung copy is localised" | EP (locale) | L1 | automated | UI language `hu`, status untrusted | render retrust banner | message equals the `hu` value of `folders.bannerRetrust` and label equals the `hu` value of `folders.bannerRetrustAction`; neither equals the English string |
| E17 | folder-action-banner "Banner uses existing severity tokens…" + "Init run outcomes…" | state-transition (running → done / failed) | L1 | automated | `WorktreeInitChip` runs: running (`lastLine` set), done, failed (`code:"script_nonzero_exit"`, `stderr` set) | render each | no palette class and no `--text-muted` / `--text-tertiary` in the tree; spinner and bar use `currentColor`; done glyph path = `mdiCheckCircleOutline`; failed shows "Init failed" and `script_nonzero_exit` in separate block elements; Retry (`worktree-init-retry`) has `border-current`, `text-[12px]`, glyph `mdiReplay`; the opened log `<pre>` carries `--text-secondary` + `--bg-code` |
| E18 | folder-action-banner glyph distinctness | invariant | L1 | automated | glyph set of the card: folder, cog, branch, folder-menu items (`mdiRefresh` …), setup `mdiTextBoxCheckOutline` | compare with banner glyphs retrust / init / done / failed / retry | intersection empty |
| E19 | theme-system "Pressed chip is a selected chip" | decision-table | L1 | automated | `OpenSpecGroupPills` with `activeGroupId=null` and with a group active; `SessionList` `ToggleButton` active/inactive | render | active classes `text-[var(--text-primary)] bg-[var(--accent-soft)] border-[var(--accent)]`; inactive label `--text-secondary`; labels `text-[12px]`; manage link `--text-secondary`, hover `--link-hover` |
| E20 | theme-system roles (stack) | decision-table | L1 | automated | `WorktreeInitStack` with 3 runs (running, done, failed `script_nonzero_exit`) | render | failed row `--severity-error-bg`, code `--severity-error-fg`; done `--accent-green-text` with `mdiCheckCircleOutline` path, no `✓`/`✕` text nodes; Dismiss neutral (`--text-primary`, `--border-secondary`, no hue) `text-[12px]`; meta spans `--text-secondary`; panel shadow uses `var(--shadow-card)` |
| E21 | directory-card-layout markers + units | decision-table | L1 | automated | `FolderAutomationSection` with 3 automations, 2 invalid; `FolderMcpSection` with `count:2, off:1` and a parse-error state; `FolderGoalsSection`; `FolderOpenSpecSection` broken + normal | render | invalid marker / off count `--accent-orange-text`; parse-error marker `--accent-red-text`; unit + marker text `text-[11px]`; OpenSpec broken glyph `--accent-purple-text` on `--tint-purple-bg`; MCP skeleton has no `#27272a` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | folder-action-banner "Hosted controls do not re-tint in a light palette" (retrust) | rendered contrast | L3 | automated | harness folder with untrusted `/fixtures/sample-hook-ok`, base light | load dashboard, locate `folder-banner-retrust-<cwd>` | `contrastFailures(measureText(region), 4.5)` empty; `nonTextFailures(region, 3)` empty; text "Init hook needs your trust before it can run" visible |
| F2 | folder-action-banner "Inherited colour holds across palettes" | equivalence over palettes | L3 | automated | same retrust banner | switch to base dark, base light, nord dark, nord light | in each, computed `color` of `worktree-init-btn` === computed `color` of the region |
| F3 | folder-action-banner (running) + worktree-init-feedback preview | state-convergence | L3 | automated | `/fixtures/sample-hook-ok`, base light | trust + run via the dialog; wait for `worktree-init-chip` | while running: text ≥ 4.5:1 and spinner arc ≥ 3:1 in the banner; last-line preview visible in the banner's `color`; converges to the info rung "Initialized" then the banner clears (`folder-banner-*` detached) |
| F4 | folder-action-banner "Expanded log body keeps code colours" + "Failure detail on its own line" | state-transition (failed) | L3 | automated | `/fixtures/sample-hook-fail` (exit 3), base light | trust + run; open `View log` | banner region at error severity; text ≥ 4.5:1; log `<pre>` computed colour = resolved `--text-secondary`, background = resolved `--bg-code`; `View log` toggle colour = region colour; `worktree-init-retry` visible on its own row below the summary |
| F5 | directory-card-layout "Slot pills read in the light theme" | rendered contrast | L3 | automated | pinned `kb-sample` fixture folder (KB, Automations, Goals, OpenSpec pills present), base light | load, locate slot pill grid | every glyph chip svg ≥ 3:1 via `nonTextFailures`; every text node ≥ 4.5:1 (11 px floor via `sizeFailures`) |
| F6 | theme-system "Session-card pills read in the light theme" (sidebar chips, pin, letters) | rendered contrast | L3 | automated | base light; a pinned folder; the archive browser open on a change with artifacts | toggle the include-archive chip and one sidebar `ToggleButton` on, then off | pressed and unpressed chips: text ≥ 4.5:1 and pressed text ratio ≥ unpressed text ratio; `folder-pinned-indicator-<cwd>` svg ≥ 3:1; artifact letters text ≥ 4.5:1 and ≥ 12 px |
| F7 | folder-action-banner "Hook rungs pair…" (target + focus) + base "Banner is accessible" | BVA (viewport 375 / 1280) | L3 | automated | retrust banner | render at 375×812, then 1280×800; Tab to `worktree-init-btn` | height ≥ 44 px at 375, ≥ 32 px at 1280; focused button shows a visible focus ring (non-zero outline / box-shadow width) |
| F8 | proposal "Compatibility" visual judgement | visual/subjective | — | manual-only | built app in base dark, base light, nord dark, nord light | human compares cards with the board `mockups/folder-card-pill-contrast/index.html` | [judgment: dark palettes read nearly unchanged; KB green and MCP/Goals blue slot hues acceptable; banner rungs match the board] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | theme-system rawPalette ratchet (baseline integrity) | fault-injection (corrupt baseline) | L1 | automated | baseline JSON with the `rawPalette` key deleted after bootstrap | run guard `main()` | exit 1 with a message naming the missing `rawPalette` map and the bootstrap command; never an implicit empty map that blesses every site |
| X2 | folder-action-banner (status probe fails open, unchanged base) | fault-injection (abort) | L1 | automated | `status = null` with an untrusted-hook history | render `FolderActionBanner` | no banner region and no `worktree-init-btn` rendered |

---

## Coverage summary

- Requirements covered: 13/13 delta requirements (folder-action-banner 4, worktree-init-feedback 2, directory-card-layout 1, theme-system 3, openspec-attach-combo 1, proposal-attachment 1, + design D5 plumbing)
- Scenarios by class: edge 21 · perf 0 · frontend 8 · error 2
- Scenarios by level: L1 23 · L2 0 · L3 7 · manual 1
- Scenarios by disposition: automated 30 · manual-only 1

## New infra needed

- `nonTextFailures(scope, floor)` in `tests/e2e/helpers/computed-contrast.ts`: svg `color` and `.animate-spin` `border-top-color` against the composited backdrop.
- A sibling AST source scan test (modelled on `packages/client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts`) with region scoping for `SessionList.tsx`.
