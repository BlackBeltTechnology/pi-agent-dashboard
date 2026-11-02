# Proposal — add-drive-office-craft-handoff (seed)

> **Status: seed.** Split from `add-google-docs-pane` during its doubt review (2026-10-24). Specs, design and tasks are not drafted yet. Run `plan-proposal` on this change after `add-google-docs-pane` has passed its renderer gate.

## Why

Office files stored in Google Drive (`.docx`, `.xlsx`) are ordinary bytes. Editing them in Craft (WordCraft / GridCraft, both save in place, `docs/craft-web-plugin.md` §1) is lossless. Drive exposes `md5Checksum` / `headRevisionId` for a stale-write check.

User intent from explore: when the user opens such a file from the Google view (`add-google-docs-pane`), it opens in Craft rather than in Google's Office-compatibility editor, and saving writes back to the same Drive file. `.pptx` stays in Google, because DeckCraft cannot write `.pptx`.

## What Changes (direction; to be designed)

- Intercept the Office-file open in the Google view (double-click intercept, or Drive "Open with"; scope `drive` vs `drive.file`).
- Re-check the kind with the Drive API (`mimeType`; never by name).
- Download via Drive OAuth and open the bytes in the Craft edit mode.
- Save with a revision guard: re-read `headRevisionId` before upload; if it changed, ask the user to choose save-as-copy in Drive, overwrite, or cancel.

## Seams that do not exist yet (from the add-google-docs-pane cycle-1 review)

1. **Cross-plugin claim open.** `openFile(path, claimId)` only opens the calling plugin's own claims (`packages/client/src/components/editor-pane/file-handler/file-handler-store.ts:396`; `openspec/specs/editor-pane-file-handlers/spec.md:88`). Options: a core cross-plugin open, or put the handoff inside `craft-web-plugin`.
2. **Cache location.** Handler modes are offered only under the session cwd (`editor-pane-file-handlers` spec:13). Choose between a workspace cache (git/agent visibility, `.gitignore`) and an out-of-cwd claim delta.
3. **Post-write upload hook.** Turn a cache-file save into a guarded Drive upload, and re-mark the Craft instance dirty when the upload fails. `setDirty` is owned by the handler instance (`packages/shared/src/dashboard-plugin/slot-props.ts:180`).
4. **Revision bookkeeping.** Re-record `headRevisionId` after each successful upload. Define which file id the tab binds to after "save as copy in Drive".
5. **Size cap.** Check the Drive `size` before download against the Craft claim `maxBytes`.
6. **Accounts.** The gmail plugin is multi-account (`openspec/specs/gmail-plugin/spec.md`). Decide single vs multi Drive account and account selection. Browsing-account detection in the view is unverified. `ctx.credentials` is per plugin, so tokens are not shared with gmail.
7. **Google Cloud setup.** The gmail wizard enables only the Gmail API (`gmail-plugin` spec, "Guided OAuth client setup"). Enabling Drive is a gmail-plugin or shared-wizard delta.
8. **Cleanup.** Cache retention and purge on disable or disconnect; token removal.
9. **Test seam.** A Drive API base-URL override that is test-only (harness-guarded), never active in production.
10. **Residual race.** Google has no write precondition (unlike Dropbox `rev` / OneDrive `eTag`); verify this, and document it in the spec.

## Capabilities

### New Capabilities
- `drive-office-craft-handoff`: hand Drive `.docx`/`.xlsx` files from the Google view to Craft and save them back to the same Drive file under a revision guard (to be specified).

### Modified Capabilities
- To be determined by the seam choices above (likely `editor-pane-file-handlers`, `craft-web-editor`, `gmail-plugin` or `plugin-oauth-flow`).

## Impact

- Depends on `add-google-docs-pane` (Google view and fence).
- Touches `packages/craft-web-plugin`, the editor-pane file-handler core, and the Google OAuth setup.

## Discipline Skills

- `security-hardening`: Drive OAuth tokens, cache files on disk, untrusted Drive filenames into paths.
- `doubt-driven-review`: overwriting a Drive file under collaborators is irreversible, so the revision guard and scope choice must stand before build.
- `observability-instrumentation`: Drive download and upload are new external calls; count outcomes without names or ids.
