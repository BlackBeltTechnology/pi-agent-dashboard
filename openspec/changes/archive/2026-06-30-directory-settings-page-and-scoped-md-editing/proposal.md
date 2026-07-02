## Why

The dashboard has two "settings" surfaces with wildly different polish. **Global settings** (`SettingsPanel.tsx`, route `/settings/:page?`) is a cog-iconed page with a grouped left-nav, 10 pages, dual-URL routing, and a mobile hierarchy. The **directory surface** (`PiResourcesView.tsx`, route `/folder/:cwd/pi-resources`) is reached from a toy-brick (`mdiToyBrickOutline`) button on `FolderActionBar`, and is a flat two-tab bar — `Resources` + `Packages` — with no page hierarchy.

Two gaps follow:

1. The directory surface looks like a package browser, not settings. It should be a real **Directory Settings** page (cog icon, same left-nav + mobile hierarchy as global settings), where Packages is just one tab.
2. Neither surface lets the user **edit the markdown instruction files** that drive pi — project `AGENTS.md` / `.pi/*.md` (directory scope) and `~/.pi/agent/*.md` (global scope). Today markdown is render-only (`MarkdownContent.tsx`); there is no write path anywhere in the dashboard.

## What Changes

### Part 1 — Directory Settings page (cosmetic / structural)

- **MODIFIED**: `FolderActionBar` button icon `mdiToyBrickOutline` → `mdiCog`; label "Pi Resources" → "Directory Settings".
- **NEW capability** `directory-settings-page`: a directory-scoped settings page at route `/folder/:cwd/settings/:page?` that mirrors `SettingsPanel`'s left-nav grouping + mobile hierarchy in a **separate, dedicated component** (not a reuse of `SettingsPanel` itself).
- **MODIFIED**: today's `PiResourcesView` tabs become pages inside the new shell — `Instructions` (NEW) · `Packages` (demoted from co-equal tab to one page) · `Resources`. OpenSpec folding is deferred (see Open Questions).

### Part 2 — Scoped markdown editing (builds on Monaco roadmap)

- **NEW capability** `scoped-markdown-editing`: an editable markdown surface, mounted as the `Instructions` page in **both** Directory Settings (directory scope) and global `SettingsPanel` → Advanced (global scope).
- **REUSES** `add-internal-monaco-editor-pane` primitives rather than building parallel ones:
  - `packages/shared/src/file-kind.ts` — flip `editable: true` for the writable markdown subset (v1 hardcodes `false`).
  - `MarkdownViewer.tsx` / the Monaco `markdown` viewer — flipped from read-only to an editable Monaco buffer.
  - `POST /api/file/write` (Monaco v3/v4) — the single write path, with mtime `409 Conflict` detection.
- **NEW**: dirty / Save / Discard contract mirroring `unify-settings-save-contract` (dirty-gated Save Bar, unsaved-changes guard).

### Part 3 — Global-scope write path (genuinely new; security-sensitive)

The Monaco roadmap's write path is strictly **session-`cwd`-gated**. Global pi markdown (`~/.pi/agent/*.md`) lives **outside any session cwd**, so cwd-containment does not cover it. This change adds:

- **NEW**: an explicit **allowlist** write-guard for the global pi directory, independent of cwd containment — narrow to `~/.pi/agent/**/*.md` (+ the directory-scope set `<cwd>/**/*.md` and `<cwd>/.pi/**`). No free-form filesystem write.

### Part 4 — Scoped file picker

- **NEW**: a bounded file picker ("any `.pi/` or `.md` in scope") backed by `pi-resource-scanner` output for directory scope and an enumerator over the global pi dir for global scope. Strictly bounded to the Part 3 allowlist — **no free-form filesystem browse**.

## Dependencies

**This change depends on `add-internal-monaco-editor-pane`.** Specifically it requires that change's **v3** (`POST /api/file/write`, refuse-overwrite, cwd-gated) and **v4** (edit existing files, mtime `409` conflict, dirty buffer) to exist. Monaco **v1** (read-only pane, `file-kind.ts`, `MarkdownViewer`) is the foundation all later parts sit on.

Sequencing:

- **Part 1** (icon + page shell) has **no Monaco dependency** and MAY ship first.
- **Parts 2–4** (md editing) MUST land after Monaco v1, and advance/reuse v3+v4. If v3/v4 are not yet implemented when this change is applied, this change carries them forward for the markdown subset (and they remain the canonical write path; this change does not fork a second one).

## Capabilities

### New Capabilities

- `directory-settings-page`: directory-scoped settings page mirroring global settings' left-nav + mobile hierarchy; Packages demoted to one page; Instructions page added.
- `scoped-markdown-editing`: editable markdown surface (Monaco buffer + `POST /api/file/write`), mounted in both directory and global settings, gated by a scope-aware write allowlist.

### Modified Capabilities

- `internal-monaco-editor-pane`: `file-kind.ts` `editable` flag becomes `true` for the markdown subset; the markdown viewer gains an editable mode + save. (Advances v3/v4 for `.md`.)

## Impact

- **Code (shared)**: `packages/shared/src/file-kind.ts` — `editable` true for markdown subset. `packages/shared/src/rest-api.ts` — typed `POST /api/file/write` + scoped-picker list response.
- **Code (server)**: `POST /api/file/write` handler (cwd-gated + global allowlist branch); a global-pi-dir enumerator for the picker; a pure `isWritableMdTarget(path, {cwd?})` guard with unit tests (the security boundary).
- **Code (client)**: `packages/client/src/components/DirectorySettings/` (NEW page shell mirroring `SettingsPanel` nav/mobile hierarchy); editable `MarkdownEditor` surface + dirty/Save Bar; scoped `FilePicker`. `FolderActionBar.tsx` icon/label swap. `App.tsx` route `/folder/:cwd/settings/:page?`. `SettingsPanel.tsx` Advanced → Instructions page.
- **Routing**: new `/folder/:cwd/settings/:page?`; legacy `/folder/:cwd/pi-resources` redirects to `…/settings/packages`.
- **Docs**: file-index rows for new components; `docs/architecture.md` note on the scope-aware write allowlist as the dashboard's first user-facing write surface.
- **No breaking changes** for end users; the directory entry-point icon/label and route change (with redirect).

## References

- Depends-on: `openspec/changes/add-internal-monaco-editor-pane/` (proposal.md, design.md — v3/v4 roadmap)
- Global settings precedent: `packages/client/src/components/SettingsPanel.tsx` (left-nav + mobile hierarchy, change `reorganize-settings-into-pages`)
- Save contract precedent: change `unify-settings-save-contract` (dirty-gated Save Bar, unsaved-changes guard)
- Directory surface today: `packages/client/src/components/PiResourcesView.tsx`, `packages/client/src/components/FolderActionBar.tsx`
- Resource enumeration: `packages/server/src/__tests__/pi-resource-scanner.test.ts` (scanner output shape)
- Path-containment precedent: change `git-root-file-containment` (`isAllowed({anchors:[cwd]})`)
- Design: `openspec/changes/directory-settings-page-and-scoped-md-editing/design.md`
