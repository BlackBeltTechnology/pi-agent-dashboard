## Why

The global depth-aware back action (`goBack`) resolves depth and parent **from the URL alone**, via a hardcoded route allowlist in `back-target.ts`. Two classes of route escape it, so back is broken on three surfaces: (1) plugin-contributed `shell-overlay-route` routes (Automations board + run monitor) are unknown to the classifier → resolve to depth 0 → `goBack` no-ops → **back button is dead**; (2) in-surface selection that lives in React state instead of the URL (Directory Settings file picker) → no history entries → back **ejects to the card list** instead of walking file→file.

## What Changes

- **Route classifier becomes data-driven.** Replace the hardcoded `if (sub === …)` chain in `back-target.ts` `parseRouteDepthInput` with a `RouteDescriptor[]` table (`{ pattern, depth, computeParent }`, first-match / most-specific-first). Core routes migrate 1:1 into static descriptors — behavior-preserving refactor pinned by existing tests.
- **Plugin routes declare their depth.** Add optional `depth` (`1` | `2`) and `parentPath?` to the `shell-overlay-route` manifest claim + `ShellOverlayRouteClaim` type. The plugin registry emits one `RouteDescriptor` per claim; the classifier merges static ∪ plugin descriptors. `goBack` is **not modified** — it was always correct; it was starved of route knowledge.
- **Manifest validation.** `manifest-validator.ts` SHOULD-warns when a `shell-overlay-route` claim omits `depth`; missing `depth` defaults to `2` (overlay → cards) so legacy plugins degrade to a working back instead of a dead no-op.
- **Automations routes gain depth.** `/folder/:encodedCwd/automations` → depth 1 (parent `/`); `/automation/run/:sid` → depth 2 (parent = the board route). Back button on both surfaces works.
- **File picker selection moves into the URL.** `FilePicker.onSelect` navigates to `/folder/:cwd/settings/instructions?file=<relPath>`; `InstructionsPage` derives the selected file from `?file=` (URL = source of truth). Mirrors the editor pane's `?file=` and the OpenSpec-artifact-tab precedent. Browser/OS back then walks file→file→page→launcher.
- **Phasing.** Phase 1 (hotfix): add the two automation routes as static descriptors + the picker `?file=` push. Phase 2 (durable): the registry-fed data-driven classifier + manifest `depth` field; migrate the Phase-1 static automation entries into the manifest.

## Capabilities

### New Capabilities
<!-- none — this is a defect fix against existing routing + plugin contracts -->

### Modified Capabilities
- `url-routing`: back-target resolution becomes a `RouteDescriptor` table that merges core static descriptors with plugin-registry-contributed descriptors; plugin overlay routes resolve to a defined depth/parent (no more depth-0 no-op).
- `shell-overlay-route`: manifest claim gains optional `depth` + `parentPath`; contributes a route descriptor consumed by the back-target classifier; missing `depth` defaults to overlay (2).
- `automation-content-view`: the board route (depth 1) and run-monitor route (depth 2, parent = board) declare depth so the global back action returns to cards / board respectively.
- `directory-settings-page`: Instructions file selection is encoded as `?file=<relPath>` on the settings route so each selection is a discrete, refresh-safe, back-walkable history entry.

## Impact

- **Client lib**: `packages/client/src/lib/back-target.ts` (table refactor), `mobile-depth.ts` (unchanged contract, fed by table), consumers `history-back.ts` / `App.tsx` `goBack` (unchanged).
- **Plugin runtime**: `packages/dashboard-plugin-runtime/src/slot-consumers.tsx` (`ShellOverlayRouteClaim` type + descriptor emit), `manifest-validator.ts` (depth warn).
- **Automation plugin**: `packages/automation-plugin/package.json` manifest (`depth`/`parentPath` on the two `shell-overlay-route` claims).
- **Directory Settings**: `packages/client/src/components/DirectorySettings/FilePicker.tsx` + `InstructionsPage.tsx` (URL-driven selection).
- **Tests**: `back-target.test.ts`, `mobile-depth.test.ts`, `history-back.test.ts`, `back-regression.test.ts` (new cases: automations depth, run→board parent, `?file=` walk); new registry→descriptor unit test in `dashboard-plugin-runtime`.
- **No breaking changes**: `depth` is optional (defaults to 2); `goBack` API unchanged.
