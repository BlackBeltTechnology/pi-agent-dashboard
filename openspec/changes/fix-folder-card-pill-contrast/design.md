# Design

## Context

See proposal.md (Why). Evidence lives in `mockups/folder-card-pill-contrast/`:
- `index.html` shows an as-built replica beside the proposed version.
- `probe.js` checks text contrast, size and WCAG 1.4.11 non-text contrast, resolving colours through a canvas so `oklch()` and `color-mix()` compare correctly.
- `ui-plan.md` holds the measurements and F15/F16.

Current paint, by site. Paths are under `packages/` unless stated.

**Banner**
- The region paints `SEVERITY_CLASS[RUNG_SEVERITY[rung]]` (`client/src/components/folder/FolderActionBanner.tsx:50-62`).
- The compact chip (`:133`) and the setup action (`:165`) are 11 px.
- Hook rungs re-host `WorktreeInitButton` (`:170-182`). Its label is a hard-coded English ternary (`client/src/components/worktree/WorktreeInitButton.tsx:129`). Its button hard-codes `text-[10px] text-amber-400 border-amber-500/40 bg-amber-500/5` (`:150`).
- The live run renders `WorktreeInitChip`:
  - running: amber (`:83-89`), `--text-muted` elapsed and last line (`:86`, `:92`)
  - done: green + `✓` (`:104-108`)
  - failed: red + `✕` (`:116-118`)
  - Retry: amber + `↻` (`:124-126`)
  - `LogDisclosure`: `--text-tertiary`, 10.5 / 11 px (`:55`, `:59`)
- Single hosts: `WorktreeInitButton` is rendered only by `FolderActionBanner`, and `WorktreeInitChip` only by `WorktreeInitButton` (`:134`; no other render site under `packages/`). Inheriting the banner's colour cannot regress another host.

**Slot pills**
- `SlotPill` maps `SlotAccent` → `text-<hue>-400 bg-<hue>-500/10 hover:border-<hue>-500/45` (`dashboard-plugin-runtime/src/SlotPill.tsx:70-77`).
- Callers pass:
  - `blue`: automation
  - `indigo`: goals (`goal-plugin/src/client/FolderGoalsSection.tsx:58`), MCP
  - `cyan`: KB (`kb-plugin/src/client/FolderKbSection.tsx:324`)
  - `purple`: team (`team-plugin/src/client/FolderTeamSection.tsx:85`), OpenSpec
  - `red`: errors
  - No caller passes `teal`.
- `client/src/components/openspec/FolderOpenSpecSection.tsx:234` re-declares the purple glyph inline for the broken state.
- Unit labels are 10 px: `FolderAutomationSection.tsx:101`, `FolderGoalsSection.tsx:65`, `FolderOpenSpecSection.tsx:347,371`.

**Markers**
- `automation-plugin/src/client/FolderAutomationSection.tsx:103` (`text-[10px] text-amber-400`).
- `mcp-client-plugin/src/client/FolderMcpSection.tsx:52` (`text-red-400`) and `:163` (`text-amber-400`).
- `FolderMcpSection.tsx:133` carries the fallback literal `var(--bg-tertiary,#27272a)`.

**Related pills**
- `client/src/components/openspec/OpenSpecActivityBadge.tsx:31-41`: 9 phase hues; `:68` muted count.
- `client/src/components/openspec/openspec-helpers.tsx:16-19`: `statusColor`.
  - Consumers: `ArtifactLetters` (`:28-48`, 10 px), which feeds `AttachmentTrace.tsx:45,61` and `ArchiveBrowserView.tsx:208`; and `ArtifactLettersButton` (`:63` `hover:border-blue-500/50`, `:67` 10 px), rendered in `SessionHeader.tsx:287,505`.
- `client/src/components/openspec/OpenSpecGroupPills.tsx`:
  - active pills: `:37-40`, `:56-59`
  - manage link: `:77` (`text-[10px] text-muted hover:text-blue-400`)
- `flows-plugin/src/client/FlowActivityBadge.tsx:19-24` (statuses) and `:62` (Abort, 10 px).
- `client/src/components/session/SessionList.tsx`:
  - `ToggleButton`: `:373-392`
  - add-to-workspace node: `:1658`, rendered only as the folder actions menu node item (`:1621-1631`); `openspec/specs/folder-actions-menu/spec.md:463` lists it among neutral host items
  - pinned indicator: `:2186-2192`
  - include-archive chip: `:2893-2898`
- `client/src/components/worktree/WorktreeInitStack.tsx`: `:28` (amber spinner), `:51` (shadow `rgba`), `:60-98` (`✓`/`✕`, `green/red/amber-400`, `--text-muted`, 10.5–11 px).

**Guard**
- `scripts/theme-token-guard.mjs` scans `SCAN_ROOTS` (`:73-80`: client, client-utils, dashboard-plugin-runtime, every plugin client tree; 28 roots) with three ratchet arms.
- `grownEntries` refuses growth per arm (`:262`).
- `bootstrapArm` accepts only `accentText` today (`:282-316`).
- The D5 pattern currently matches **1,211 occurrences in 176 files, 399 `<file>::<hue>` sites**.

**Token facts verified palette-wide** (18 palettes; F16 in `ui-plan.md`; method mirrors `client/src/lib/__tests__/action-menu-tone-contrast.test.ts:13-49`):
- `--accent-<hue>-text` on `--tint-<hue>-bg` is ≥ 4.36:1 for blue / green / purple / red / orange.
- `--accent-<hue>-text` on `--bg-secondary` is ≥ 4.5:1 for all six hues.
- `--text-muted` on `--bg-secondary` is 1.78–3.77:1, failing AA in all 18.
- Severity triples meet the `message-severity-tokens` **relative** gate: ≥ 3:1 except the documented tokyo-night light `info`/`blue`/`purple` cells (~2.7:1, asserted ≥ 2.5:1). Sub-AA cells also occur in catppuccin and rose-pine light.

## Goals / Non-Goals

**Goals:**
- Every listed surface paints colour only through existing tokens. Each such paint carries the guarantee of its token family (`-text` ramp AA; severity / tint relative gate; `--text-secondary` AA).
- New raw palette classes are blocked repo-wide by a ratchet. Existing ones are not swept.

**Non-Goals:**
- No new colour token, no token value change, no palette remediation. F15 (nord light `success` 4.47:1) and the tokyo-night light `info` cell sit inside the relative gate.
- No migration of `SessionList.tsx`'s non-pill palette uses: resume-error banner `:2041-2047`, page error and load-more links `:2774-2799`, home link `:2832` (its `text-blue-500 hover:text-blue-400` is mandated verbatim by `session-sidebar` "Sidebar header brand mark (PiLogo)"), `:3358`. They stay baselined.
- No layout or behaviour change beyond the banner rung content shape, copy and the stated size floors.
- Not extending the `message-severity-tokens` aligned-surfaces list (D7).
- Not migrating `SessionOpenSpecActions.tsx` (`packages/client/src/components/openspec/SessionOpenSpecActions.tsx`: session-card OpenSpec action row and attached badge). It stays baselined and is a named follow-up.

## Decisions

### D1: Banner hook rungs pair a message with one inherited-colour action

`FolderActionBanner` renders the glyph and message for the `retrust` and `init-needed` rungs, then hosts `WorktreeInitButton` as the action.

The button's classes become colour-free:
- `border border-current` with a `currentColor` 10 % hover fill
- `focus-ring`, 12 px semibold
- `min-h-[44px] md:min-h-[32px]`

It inherits the region's `--severity-<sev>-fg`.

`WorktreeInitChip` (running / done / failed) drops its own border and fill tint and its palette text:
- Spinner arc and progress bar paint `currentColor`.
- Elapsed text, last output line, failure code and the `View log` toggle inherit the colour, as a smaller mono 11 px line, with no `--text-muted` and no `--text-tertiary`.
- The expanded log body (`WorktreeInitChip.tsx:59`, multi-line) keeps code colours: `--text-secondary` on `--bg-code`, 11 px. This follows `message-severity-tokens` "Severity styles the chrome, not multi-line body content" (`openspec/specs/message-severity-tokens/spec.md:164-210`); the banner is a contained surface, so its single-line label and status may carry the severity `-fg`.
- `✓` / `✕` / `↻` become `mdiCheckCircleOutline` / `mdiAlertCircleOutline` / `mdiReplay`. `mdiRefresh` is rejected because it is the folder menu's "Refresh folder" glyph (`SessionList.tsx:1923`).
- Retry uses the same `border-current` recipe at 12 px.

The compact chip and the setup action go to 12 px. On the hook rungs the action button drops its inner `mdiScriptTextPlayOutline`; the rung glyph at the start of the row is the only icon, so the shield and the script glyph never sit side by side with different meanings.

**Copy** (new i18n keys in `client/src/lib/i18n-en-source.json`, `client/src/lib/i18n/i18n-hu.ts`, `client/src/lib/i18n/i18n-zh-CN.ts`):

| key | en | hu | zh-CN |
|---|---|---|---|
| `folders.bannerRetrust` | Init hook needs your trust before it can run | Az init hook futtatásához jóváhagyás szükséges | 初始化钩子需要您的信任才能运行 |
| `folders.bannerRetrustAction` | Review & trust | Ellenőrzés és jóváhagyás | 审查并信任 |
| `folders.bannerInitNeeded` | Init hook hasn't run in this checkout | Az init hook még nem futott ebben a checkoutban | 初始化钩子尚未在此检出中运行 |
| `folders.bannerInitAction` | Initialize | Inicializálás | 初始化 |

`data-testid`s are unchanged: `worktree-init-btn`, `worktree-init-chip`, `worktree-init-error`, `worktree-init-retry`, `folder-banner-<rung>-<cwd>`, `folder-banner-chip-<cwd>`.

**Glyphs**
- retrust: `mdiShieldAlertOutline`
- init-needed: `mdiScriptTextPlayOutline`
- failed: `mdiAlertCircleOutline`
- done: `mdiCheckCircleOutline`
- retry: `mdiReplay`

None collides with the card's folder, cog, branch, setup or folder-menu glyphs.

**Copy truthfulness.** `trusted: false` covers both a changed hook and a never-trusted one (`packages/server/src/routes/git-routes.ts:450-454`; the client predicate is `WorktreeInitButton.tsx:128`). The retrust message therefore claims neither.

**Alternative rejected:** retone the button with `--accent-orange-text`. It keeps the box-in-box look and does not explain the block.

### D2: `done` stays on the info rung

`RUNG_SEVERITY` is unchanged. The done content (check glyph + "Initialized · Ns") inherits the info `-fg`. A `success` rung was rejected by the user; it adds a ladder rung for a colour change only.

### D3: `SlotAccent` resolves onto host hue tokens (option A)

`ACCENT` keeps its six keys and maps them:

| `SlotAccent` | host hue (four used) |
|---|---|
| `blue`, `indigo` | blue |
| `cyan`, `teal` | green |
| `purple` | purple |
| `red` | red |

Each key emits the literal classes `text-[var(--accent-<h>-text)] bg-[var(--tint-<h>-bg)] hover:border-[var(--tint-<h>-border)]`. They must be literal so Tailwind JIT compiles them (`SlotPill.tsx` header note).

- The glyph chip is the slot's **identity** tint, which `message-severity-tokens` "Identity tint triples" allows. Its text is the `-text` ramp, not `--tint-<h>-fg`, so the rule "tint fg only on its own bg" is not touched.
- `FolderOpenSpecSection`'s inline broken-state glyph uses the purple pair.
- Option B (neutral glyph) and option C (54 new palette values) were rejected.
- **Trade-off:** MCP and Goals become blue like Automations, and KB becomes green. The legend identifies the slot.

### D4: Size floor on touched surfaces

Controls go to 12 px:
- banner action, setup action, compact banner chip, Retry
- `ToggleButton`, include-archive chip, group pills, manage-groups link
- artifact letters, Abort, Dismiss

Other text goes to 11 px:
- slot-pill units (Automations, Goals, OpenSpec ×2) and markers
- init-stack mono lines and chip failure code
- `LogDisclosure`

### D5: `rawPalette` ratchet arm

**Pattern:** `(?<![\w-])(?:[\w-]+:)*(text|bg|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|fill|stroke|from|via|to|placeholder|decoration|caret|accent|shadow)-(<22 Tailwind hues>)-(50|[1-9]00|950)(?:/[\w.[\]]+)?(?![\w-])`
- Scope: `.ts` / `.tsx` under `SCAN_ROOTS`; test files are excluded as the other arms exclude them.
- Counting: site key `<file>::<hue>`, occurrence-counted, with the same `ratchet()` / `grownEntries` semantics.

**Arm plumbing.** Today the arm set is hard-coded in four places: `loadBaseline` (`:247-256`), `grownEntries` (`:262`), `bootstrapArm` (`:282-316`, accepts only `accentText`) and `writeBaseline` (`:321-350`, serialises a fixed key set). These become one `ARMS` list, so a `--write` after the bootstrap keeps `rawPalette`; a round-trip test (bootstrap → `--write` → key survives) pins it.

**Bootstrap**
- `--bootstrap-arm` gains `rawPalette`.
- `loadBaseline` requires the key once bootstrapped.
- The baseline is bootstrapped **after** the migration tasks. `SessionList.tsx` keeps entries for its non-pill sites; its four pill sites are proven clean by the source scan (D7), not the guard.

**Arm name:** `rawPalette` rather than extending `accentText`, because the syntax and the remedy differ. The failure message names the arm and the replacement families (`--accent-<hue>-text`, `--severity-*`, `--tint-*`, `--text-*`).

**Rejected:** a Biome/ESLint rule. This script is the repo's colour guard; a second mechanism splits the baseline.

### D6: Literal clean-up, roles and readable text on touched files

- `WorktreeInitStack`:
  - Shadow → `shadow-[0_8px_24px_var(--shadow-card)]`. This is a visible change: dark 0.5 → 0.4 alpha, light 0.5 → 0.08.
  - Failed row → `--severity-error-{bg,fg}`; it expresses severity, so per "Identity tint triples" it is not a tint.
  - Running spinner → `--accent-blue-text`; done / failed glyph and text → `--accent-green-text` / `--accent-red-text`.
  - Dismiss → neutral (`--text-primary` label, `--border-secondary` outline, no hue).
- `FolderMcpSection.tsx:133`: drop the `#27272a` fallback; this also shrinks the fallback arm.
- `OpenSpecGroupPills` / `ToggleButton` / include-archive chip:
  - Pressed state = the theme-system **selected chip** recipe: `--text-primary` on `--accent-soft`, border `--accent` (`openspec/specs/theme-system/spec.md:161-197`). It is not a tint, because selection is not identity.
  - Unpressed state and the manage link use `--text-secondary`; the manage link hovers to `--link-hover`.
- `ArtifactLettersButton` hover border → `--accent`.
- Flow Abort is destructive identity → `--tint-red-*`.
- Every readable `--text-muted` on these surfaces → `--text-secondary`.

### D7: A dedicated pill-surface requirement instead of the aligned-surfaces list

Adding these files to `message-severity-tokens` "No raw colour literals on aligned action surfaces" would also pull them under two `theme-system` requirements keyed off that list (`openspec/specs/theme-system/spec.md:274-306`):
- "Readable text on aligned action surfaces": ≥ 3:1 in every named theme.
- "Target size and focus on aligned action surfaces": every button ≥ 44×44 / ≥ 32 px.

This would cause two conflicts:
- Banner text inherits the info triple, documented at ~2.7:1 on tokyo-night light (`openspec/specs/message-severity-tokens/spec.md:52-84`).
- P/D/S/T letters, group pills and filter chips would become 32–44 px buttons, an unapproved layout change.

So `theme-system` gains its own requirements with the floors that do apply. They are proven by a sibling AST source scan, modelled on `client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts`, that uses the D5 pattern and can address the four `SessionList` sites by testid / component region.

### D8: Tests carry the contrast proof

- A palette-wide L1 test (resolver as in `action-menu-tone-contrast.test.ts:13-49`) pins D3 glyph 3:1 and the marker / `--text-secondary` 4.5:1 floors over 18 palettes.
- Rendered L3 checks use `tests/e2e/helpers/computed-contrast.ts`, which gains a `nonTextFailures` helper: svg `color` and spinner `border-top-color` against the composited backdrop, at 3:1.

## Risks / Trade-offs

- [Users map hue to slot identity] → Legend text is unchanged and colour is secondary. Noted in the changelog.
- [`SessionList.tsx` keeps a `::blue` / `::red` baseline for its non-pill sites, so a pill regression that swaps for a removed non-pill site would not grow the count] → The four pill sites are guarded by the region-scoped source scan (D7), not by the ratchet.
- [Ratchet regex matches a non-class string] → It is baselined on landing and shrinkable by editing; a numeric shade is required.
- [Banner inherits documented sub-AA severity cells in some light palettes] → This is the existing relative gate; the result is no worse than any severity surface and far better than today's 1.3:1.
- [Changed colour on non-card consumers of `statusColor` (`AttachmentTrace`, `ArchiveBrowserView`, `SessionHeader`)] → The same improvement applies; listed in Impact; `ArtifactLettersButton.test.tsx` is updated.
- [Plugin builds] → `dashboard-plugin-runtime` is `@source`-scanned, so the literal arbitrary-value classes compile; verified by the rendered L3 check.

## Migration Plan

Visual only. Land in one commit: surfaces → tests → guard bootstrap. Rollback = revert; there is no persisted data and token values are untouched.
