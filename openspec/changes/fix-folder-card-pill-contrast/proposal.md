## Why

In the light theme, the folder-card retrust banner's "Review & trust changes" control is unreadable (1.34:1). The banner itself is fine: it paints through the `--severity-*` triple (≥ 6:1 in base light). The problem is what it hosts.

Controls, chips, glyphs and markers on the folder card and session card paint raw Tailwind `*-400` colours tuned for dark backgrounds, and these wash out on every light palette. The mockup board measured base dark, base light, nord dark and nord light:

- **As-built:** 42 / 100 / 50 / 100 contrast, size and non-text failures.
- **Token-only proposal:** 0.

Beyond those four palettes, banner content carries the `message-severity-tokens` relative gate. That gate includes a documented sub-AA tokyo-night light `info` cell (~2.7:1), which this change leaves as is.

The pattern is widespread: 1,211 raw palette classes in 176 files under the theme-token guard's scan roots. `align-ui-with-theme-tokens` fixed one set of surfaces and explicitly left "a lint rule banning palette classes" out of scope. Without that guard, every fixed surface can regress.

## What Changes

**Folder action banner (hook rungs).**
- The `retrust` and `init-needed` rungs render a glyph, a one-line message and one action button. The button inherits the banner's colour (`border-current`), the shape the shipped "Not a pi project yet" rung already uses.
- Every descendant inherits the banner's `--severity-<sev>-fg`: the action, the running / done / failed content, the spinner, the progress bar, the log disclosure and Retry.
- `WorktreeInitButton` and `WorktreeInitChip` drop their own `amber/green/red` paint, `--text-muted` / `--text-tertiary` text and `✓ ✕ ↻` symbols; the symbols become MDI icons.
- The expanded multi-line log body keeps code colours (`--text-secondary` on `--bg-code`), per `message-severity-tokens` "Severity styles the chrome, not multi-line body content".
- Retrust: message "Init hook needs your trust before it can run", action "Review & trust". The init-status payload does not distinguish a changed hook from a never-trusted one, so the copy claims neither.
- Init-needed: message "Init hook hasn't run in this checkout", action "Initialize".
- Messages and action labels are localised (en / hu / zh-CN).
- `done` stays on the info rung. Failure code and message move to a second line.

**Slot pills (`SlotPill`).**
- The six `SlotAccent` keys stay but resolve onto four host hues: glyph `--accent-<hue>-text` on `--tint-<hue>-bg`, hover border `--tint-<hue>-border`.
- Mapping: blue←blue/indigo, green←cyan/teal, purple←purple, red←red.
- State markers (Automations `⚠ N`, MCP `N off`, MCP parse-error `⚠`) → `--accent-orange-text` / `--accent-red-text`.
- Unit labels go from 10 to 11 px (Automations, Goals, OpenSpec).
- The `FolderOpenSpecSection` broken state's inline glyph copy uses the same tokens.

**Related pills, same recipe.**
- Folder-header pin → `--accent-yellow-text`.
- Add-to-workspace menu node → neutral (`folder-actions-menu` already declares it a neutral item).
- Sidebar toggle chips (`ToggleButton`, include-archive chip) and `OpenSpecGroupPills`: pressed state uses the theme-system selected-chip recipe (`--text-primary` on `--accent-soft`, `--accent` border); unpressed text and the manage link use `--text-secondary`.
- `OpenSpecActivityBadge`: 9 phase hues fold onto 4 of the `--accent-<hue>-text` tokens (blue, purple, yellow, green).
- Artifact letters (`statusColor`, `ArtifactLettersButton`) → `--accent-green-text` / `--accent-yellow-text` / `--text-secondary`.
- `FlowActivityBadge` statuses → `--accent-<hue>-text`; Abort → `--tint-red-*` (destructive identity).
- `WorktreeInitStack`:
  - hue text tokens and MDI glyphs;
  - failed row → `--severity-error-*`;
  - neutral Dismiss;
  - shadow → `--shadow-card`.

**Literal clean-up on the same files.**
- `FolderMcpSection`'s `var(--bg-tertiary,#27272a)` fallback literal → plain token.
- `ArtifactLettersButton`'s `hover:border-blue-500/50` → `--accent`.

**Readable metadata.** Readable `--text-muted` text on these surfaces (counts, timings, last output line, chip labels) moves to `--text-secondary`. `--text-muted` measures 1.78–3.77:1 on `--bg-secondary` in all 18 palettes.

**Type floor.**
- Touched controls go to 12 px.
- Other touched text goes to ≥ 11 px.

**Guard.** A fourth, shrink-only `rawPalette` ratchet arm in `scripts/theme-token-guard.mjs`.
- It counts raw Tailwind palette colour classes per `<file>::<hue>`, including side forms (`border-l-*`) and `ring-offset-*`.
- It is baselined after this change's migration. A new site, or growth of a baselined site, fails CI.

Mockup: mockups/folder-card-pill-contrast (in this change)

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `folder-action-banner`:
  - Re-trust copy and action label change.
  - Banner content inherits the severity `-fg`; no hosted control re-tints.
  - ADDS: hook rungs pair a message with one inherited-colour action.
- `worktree-init-feedback`: "muted preview" of the last log line becomes "de-emphasised preview", never `--text-muted`. Applies in both "Feedback replaces raw terminal output" and "Init progress and failure render in the tier-0 banner".
- `directory-card-layout`: ADDS slot-pill glyph and marker colours from host hue tokens, with a non-text 3:1 floor across all palettes, and the 11 px unit / marker floor.
- `openspec-attach-combo` and `proposal-attachment`: the PDST letters' "green, yellow, muted" colours become `--accent-green-text`, `--accent-yellow-text`, `--text-secondary`.
- `theme-system`: ADDS three requirements. The `message-severity-tokens` aligned-surfaces list is deliberately NOT extended (design D7).
  - "Card pill surfaces paint colour only through tokens"
  - "Card pill colour roles"
  - "Raw palette classes SHALL NOT be added"

## Impact

**Code**

| Area | Files |
|---|---|
| Folder banner | `packages/client/src/components/folder/FolderActionBanner.tsx` |
| Worktree init | `packages/client/src/components/worktree/WorktreeInitButton.tsx`, `WorktreeInitChip.tsx`, `WorktreeInitStack.tsx` |
| Slot pill | `packages/dashboard-plugin-runtime/src/SlotPill.tsx` |
| Plugin sections | `packages/automation-plugin/src/client/FolderAutomationSection.tsx`, `packages/goal-plugin/src/client/FolderGoalsSection.tsx`, `packages/mcp-client-plugin/src/client/FolderMcpSection.tsx` |
| OpenSpec | `packages/client/src/components/openspec/FolderOpenSpecSection.tsx`, `OpenSpecActivityBadge.tsx`, `openspec-helpers.tsx`, `OpenSpecGroupPills.tsx` |
| Flows | `packages/flows-plugin/src/client/FlowActivityBadge.tsx` |
| Session list | four sites in `packages/client/src/components/session/SessionList.tsx` |
| Guard | `scripts/theme-token-guard.mjs` + baseline + test |
| Test helper | `tests/e2e/helpers/computed-contrast.ts` (non-text helper) |
| Other | i18n catalogs, `ui-contract.md` |

**Indirect colour change via `statusColor`**
- `AttachmentTrace.tsx`
- `ArchiveBrowserView.tsx`
- `SessionHeader.tsx` (`ArtifactLettersButton`)

**Tokens and runtime.** No new colour token and no token value change. No protocol, server or data change.

**Tests whose assertions change**
- `WorktreeInitButton.test.tsx`: label.
- `ArtifactLettersButton.test.tsx`: `text-green-500` / `text-yellow-500` / `text-[var(--text-muted)]` class asserts.
- `SlotPill.test.tsx`: `hover:border-cyan-500/45`.
- `SessionOpenSpecActions.test.tsx:252` (`.text-blue-400`): unaffected. `SessionOpenSpecActions.tsx` (session-card OpenSpec action row and attached badge) is out of scope, baselined, and named as a follow-up.
- `data-testid`s are unchanged.

**Compatibility.** Visual only.
- Dark palettes look nearly identical.
- Indigo / cyan / teal slot glyphs become blue / green.
- The init-stack shadow lightens (`--shadow-card`: 0.4 dark, 0.08 light vs 0.5).
- Light palettes become readable within the token gates.
- Plugins keep passing the same `SlotAccent` keys.

**Rollback.** Revert the commit. Tokens are untouched, and the guard arm and its baseline go with the revert.

## Discipline Skills

- `security-hardening`: not triggered (no input, auth, secrets or untrusted data).
- `performance-optimization`: not triggered (no data path or latency budget; only class strings change).
- `observability-instrumentation`: not triggered (no new endpoint, job or external call).
- `doubt-driven-review`: triggered at planning, on the proposal and design, as part of `plan-proposal`. There is no irreversible step: the guard baseline is shrink-only and reverts cleanly.
- `review-code`: run before commit, as for any non-trivial change.
