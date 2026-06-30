## Context

Two settings surfaces exist (global `SettingsPanel`, directory `PiResourcesView`) with very different hierarchy depth. Separately, pi's behaviour is steered by markdown instruction files (`AGENTS.md`, `.pi/*.md`, `~/.pi/agent/*.md`) that the dashboard can render but not edit. The active `add-internal-monaco-editor-pane` change introduces — across a v1→v4 roadmap — a shared `file-kind` classifier, a Monaco viewer, and a `cwd`-gated `POST /api/file/write` with mtime conflict detection. This change reuses those primitives to add editing for the markdown subset, and adds the one thing the Monaco roadmap deliberately does not cover: a write target **outside any session cwd** (the global pi dir).

## Goals / Non-Goals

**Goals**
- Directory surface becomes a real settings page: cog icon, left-nav + mobile hierarchy matching global settings; Packages demoted to one page; Instructions page added.
- Edit markdown instruction files in both directory scope and global scope, through **one** write path and **one** security model.
- A bounded, scope-aware file picker — never a free-form filesystem browser.

**Non-Goals**
- No new editor engine. Reuse Monaco (the roadmap explicitly rejected CodeMirror).
- No second write API. `POST /api/file/write` is canonical.
- No cross-device persistence of editor state (inherits Monaco's `localStorage` decision).
- No editing of non-markdown files in this change (the picker is `.md` / `.pi`-scoped).
- OpenSpec is NOT folded into the directory-settings tabs in this change (deferred).

## Decisions

### 1. Separate Directory Settings component, not a reuse of `SettingsPanel`

**Decision:** Build `packages/client/src/components/DirectorySettings/` that mirrors `SettingsPanel`'s nav grouping + mobile-hierarchy *shape* but stays a distinct component tree.

**Why:** `SettingsPanel` is tightly coupled to global config sources (`computeConfigPartial`, `CONFIG_FIELD_PAGE`, multi-source Save fan-out). Scoping it to a directory would mean threading a `cwd` through every global concern and risk cross-contaminating the global save contract. A sibling component reuses the *layout primitives* (left-nav list, mobile depth derivation, Save Bar) without inheriting global-config baggage.

**Trade-off:** Some layout duplication. Mitigated by extracting the nav/mobile-hierarchy chrome into a shared presentational shell both pages consume, if duplication proves real during implementation.

### 2. Markdown editing is Monaco v3/v4 for the `.md` subset, not a parallel editor

**Decision:** Flip `file-kind.ts` `editable` to `true` for the writable markdown subset; make the Monaco `markdown` viewer editable; save through `POST /api/file/write` with mtime `409` conflict detection.

**Why:** The Monaco roadmap already plans exactly this (v3 write endpoint, v4 edit-existing + mtime conflict). A separate textarea/CodeMirror editor would create two write surfaces, two security models, and contradict the Monaco design's explicit CodeMirror rejection. One path = one thing to security-review and maintain.

**Trade-off:** Couples this change to Monaco v1 landing first. Accepted — Parts 2–4 are sequenced behind it; Part 1 ships independently.

### 3. Scope-aware write guard — cwd containment is NOT enough

**Decision:** Add a pure `isWritableMdTarget(absPath, { cwd? }): boolean` as the single authorization gate, with two branches:

- **Directory scope** (`cwd` present): allow `<cwd>/**/*.md` and `<cwd>/.pi/**` — reuses the `isAllowed({anchors:[cwd]})` containment model from `git-root-file-containment`.
- **Global scope** (`cwd` absent): allow **only** `~/.pi/agent/**/*.md`. An explicit allowlist root, NOT cwd containment.

`POST /api/file/write` calls this guard before any write; failure → `403`. Symlink/`..` traversal is normalized away (realpath) before the check.

**Why:** The dashboard is tunnellable/remote. The moment global editing exists, there is a write surface above every project root. cwd containment cannot express "this specific home subtree", so a dedicated allowlist is the boundary. This guard is the security-critical unit — it gets exhaustive tests (traversal, symlink escape, sibling-dir bypass, non-`.md` rejection, missing-home).

**Alternatives considered:**
- *Configurable global roots.* Rejected for this change: widens the attack surface; default-narrow first, configurability later if asked.
- *Let code-server handle global edits.* Rejected: code-server sandboxes to a cwd, same gap; and the user chose a lightweight in-dashboard editor.

### 4. Bounded file picker, sourced from the scanner + a global enumerator

**Decision:** The picker lists candidates from `pi-resource-scanner` output (directory scope) and a small enumerator over `~/.pi/agent` (global scope), filtered to the Part 3 allowlist. No `fs` browse endpoint that takes an arbitrary path.

**Why:** "Any `.pi/` or `.md` in scope" must not become "any file on the host". Deriving the candidate set server-side from the same allowlist the write-guard enforces keeps picker and guard in lockstep — the UI can never offer a target the guard would reject.

### 5. Route + redirect

**Decision:** New canonical route `/folder/:cwd/settings/:page?` (pages: `instructions`, `packages`, `resources`). Legacy `/folder/:cwd/pi-resources` issues a replace-redirect to `…/settings/packages`. Mobile depth derives via the existing `getMobileDepth` route-flag pattern (`lib/mobile-depth.ts`), adding a `hasFolderSettingsRoute` flag.

**Why:** Mirrors the `reorganize-settings-into-pages` dual-URL approach (canonical `:page?` + legacy redirect) so existing deep-links and the FolderActionBar handoff keep working.

## Migration & Rollout

- Part 1 (icon/label/route + page shell) is independently shippable and low-risk; legacy route redirects.
- Parts 2–4 gate behind Monaco v1. If Monaco v3/v4 are unimplemented at apply-time, this change carries them forward for the markdown subset and they remain the canonical write path.
- No data migration; editor state is `localStorage` (inherited from Monaco).

## Open Questions (for tasks-time clarification)

1. **OpenSpec tab.** Fold the per-cwd OpenSpec board into Directory Settings as a page, or leave it where it is? (Proposal leaves it out.)
2. **Global write guard breadth.** Hard-allowlist `~/.pi/agent/**/*.md` only, or include `~/.pi/agent/**/*.pi`-tree files too?
3. **Conflict UX.** On `409` mtime mismatch — reload-and-lose, diff-and-merge, or force-overwrite confirm?
4. **Picker default selection.** Open `AGENTS.md` (dir) / top-level global md by default, or empty until picked?

## References

- `openspec/changes/add-internal-monaco-editor-pane/design.md` — file-kind classifier, write-endpoint v3/v4, Monaco lazy-load
- `packages/client/src/components/SettingsPanel.tsx` — nav + mobile hierarchy + Save Bar to mirror
- change `git-root-file-containment` — `isAllowed({anchors:[cwd]})` containment to reuse for dir scope
- change `unify-settings-save-contract` — dirty-gated Save Bar + unsaved-changes guard
- `packages/client/src/lib/mobile-depth.ts` — route-flag depth derivation
