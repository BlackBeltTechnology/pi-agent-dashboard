## 1. Shared protocol

- [x] 1.1 Add `set_folder_collapsed { path: string; collapsed: boolean }` to the browser→server message union in `packages/shared/src/browser-protocol.ts`, beside `set_workspace_collapsed` (field is `path`, matching the folder-addressed siblings); verify `npx tsc --noEmit -p packages/shared` passes.
- [x] 1.2 Add a `collapsed_folders_updated { collapsedFolders: string[] }` server→browser message to the same file; verify type-check passes and no existing broadcast payload shape changed.

## 2. Server persistence

- [x] 2.1 Implement `getCollapsedFolders()` / `setFolderCollapsed(dirPath, collapsed)` in `packages/server/src/persistence/preferences-store.ts`, canonicalizing via `pathKey(dirPath, inferPlatform([dirPath, ...existing collapsedFolders]))` — NOT `process.platform` (design Decision 3: it folds case on macOS server-side only and re-breaks the key match) and NOT `canonicalize()`/`safeRealpathSync` (the client cannot resolve symlinks). Returns `true` only on a real mutation; verify the 2.3–2.9 tests pass.
- [x] 2.2 Add `collapsedFolders` to the `PreferencesData` type and to **both** `writeJsonFile` object literals (`preferences-store.ts:379` debounced write and `:391` `flushNow`) — `satisfies` will not flag a missed optional field; verify task 2.10's round-trip test passes.

### Tests — server persistence (L1, vitest · see `packages/server/src/__tests__/preferences-store.test.ts`)

- [x] 2.3 (test-plan #E1) `preferences.json` with no `collapsedFolders` field · store loads the file · load succeeds, `getCollapsedFolders()` returns `[]`, no throw.
- [x] 2.4 (test-plan #E2) empty store · `setFolderCollapsed("/repo/a", true)` · returns `true`, array is exactly `["/repo/a"]`.
- [x] 2.5 (test-plan #E3) store holding `/repo/a` · `setFolderCollapsed("/repo/a", true)` again · returns `false`, array unchanged, no broadcast emitted.
- [x] 2.6 (test-plan #E4) store holding `/repo/a` · `setFolderCollapsed("/repo/a", false)` · returns `true`, array is `[]`.
- [x] 2.7 (test-plan #E5) empty store · `setFolderCollapsed("/repo/a", false)` · returns `false`, no broadcast.
- [x] 2.8 (test-plan #E10) `/tmp/x` where `/tmp` symlinks to `/private/tmp` · store then read back · stored value is `/tmp/x`, NOT `/private/tmp/x` (unlike `pinnedDirectories`; see `preferences-store.ts:322`).
- [x] 2.9 (test-plan #E11) `preferences.json` carrying 1,000 collapsed entries (~80KB) · server start + `getCollapsedFolders()` · all 1,000 load, lookup for a known key returns collapsed, no truncation.
- [x] 2.10 (test-plan #E12) store holding a persisted entry · debounced write flushed, store re-read from disk · entry survives the restart round-trip (guards the two `writeJsonFile` literals).
- [x] 2.11 (test-plan #E13) store holding `/repo/main`, a worktree main path no session reports as its cwd · session list changes (spawn, then archive) · entry still present after both.
- [x] 2.12 (test-plan #X8) `preferences.json` where `collapsedFolders` is a string, not an array · server start · falls back to `[]`, rest of the file still loads, no crash.

### Tests — key canonicalization (L1, vitest · see `packages/shared/src/__tests__/` path-key tests)

- [x] 2.13 (test-plan #E6) store holding `/repo/a` · lookup for `/repo/a/` · recognised as collapsed.
- [x] 2.14 (test-plan #E7) store holding `C:\repo\a` on win32 · lookup for `c:/repo/a` · recognised as collapsed.
- [x] 2.15 (test-plan #E8) store holding `/repo/a` on a POSIX host · lookup for `/repo/A` · NOT recognised as collapsed — case folding is Windows-only; this test fails against a `process.platform` implementation and is the regression guard for design Decision 3.
- [x] 2.16 (test-plan #E9) folder collapsed via `/repo/a` · expand issued via `/repo/a/` · exactly one entry affected, folder renders expanded.

## 3. Server gateway

- [x] 3.1 Handle `set_folder_collapsed` in `packages/server/src/pairing/browser-gateway.ts` beside `set_workspace_collapsed`, emitting `collapsed_folders_updated` only when the store reports a mutation.
- [x] 3.2 Add `collapsed_folders_updated` to `frameClassOf` as `{ cls: "state", key: msg.type }` beside `pinned_dirs_updated`/`workspaces_updated`.
- [x] 3.3 Send `collapsed_folders_updated` in the connect-time unicast snapshot beside `pinned_dirs_updated`/`workspaces_updated` and **before `sessions_snapshot`**, unconditionally including when the array is empty (it is the migration's "initial state arrived" signal).

### Tests — gateway (L1, vitest · see `packages/server/src/__tests__/browser-gateway-critical-frames.test.ts`)

- [x] 3.4 (test-plan #X7) browser send-buffer saturated · `collapsed_folders_updated` emitted · classified `cls: "state"` and coalesced by type, NOT shed as a `transcript` frame (the `default` branch).

## 4. Client state ownership

- [x] 4.1 Handle `collapsed_folders_updated` in `packages/client/src/hooks/useMessageHandler.ts` (where `pinned_dirs_updated`/`workspaces_updated` are parsed — NOT in `App.tsx` directly) and hold the array in `App.tsx`, dispatching `set_folder_collapsed` with **no optimistic mirror** (matching the stated convention at `App.tsx:1834`).
- [x] 4.2 Delete the prune effect (`pruneStaleCollapsedGroups` and its `[sessions.length]` effect) and the `collapsedGroups` `useState` from `packages/client/src/components/session/SessionList.tsx`; accept `collapsedGroups` + `onSetFolderCollapsed` as props and canonicalize the lookup in `isFolderCollapsed` via `pathKey(group.cwd, platform)`, deriving `platform` from a component-scoped `inferPlatform` over the same sample shape grouping uses (session cwds + worktree main paths + pinned dirs) — NOT the value at `SessionList.tsx:549`, which is scoped inside a `useMemo` and omits worktree main paths.
- [x] 4.3 Convert all four in-place expand sites from a guarded toggle to an ADD-ONLY `onSetFolderCollapsed(path, false)`: the reveal path, `seekToFolderOpenSpec` (`SessionList.tsx:1197`), both `FolderSpawnButtons` handlers, and `EndedSubgroupCard`'s standalone-render `onActivate` fallback (`SessionList.tsx:1649`).
- [x] 4.4 Change `resolveFoldAncestors` to key the folder ancestor off the resolved group path (`resolveSessionGroupPath`) instead of `s.cwd`.
- [x] 4.5 Add the collapsed-folders echo to the reveal completion-signal effect (today keyed to `[workspaces]` only, per the `session-card-seek` requirement this change modifies).
- [x] 4.6 Remove `getCollapsedGroups` / `setCollapsedGroups` / `pruneStaleCollapsedGroups` from the live path in `packages/client/src/lib/session/session-filter-storage.ts`, retaining only the read the migration needs; verify the prune tests are deleted and the remaining suite passes.
- [x] 4.7 Update `SessionList.test.tsx` and `SessionList.seek-to-card.test.tsx` to seed collapse via the prop instead of `dashboard:collapsedGroups`; verify both suites pass.

### Tests — client rendering (L1, vitest · see `packages/client/src/components/__tests__/SessionList.test.tsx`)

- [x] 4.8 (test-plan #F10) folder with no stored entry · first render · renders expanded (guards the untouched default through the storage move).

## 5. Migration

- [x] 5.1 Implement the one-shot migration in `App.tsx`: wait for the connect snapshot, canonicalize legacy `dashboard:collapsedGroups` entries, send `set_folder_collapsed` **only** for keys absent from the known set, and `removeItem` once the known set contains every legacy key — with a 10-load attempt backstop that drops the key regardless and logs once.

### Tests — migration (L1, vitest · see `packages/client/src/lib/__tests__/session-filter-storage.test.ts`)

- [x] 5.2 (test-plan #X1) connection drops before any echo confirms · migration runs with a legacy value present · legacy key RETAINED, attempt counter incremented, retried next load.
- [x] 5.3 (test-plan #X2) legacy value present, server already holds every legacy key · migration runs after the connect snapshot · sends nothing (a no-op mutation emits no echo and would hang the handshake forever), removes the legacy key immediately.
- [x] 5.4 (test-plan #X3) legacy value never confirmed, attempt counter at 9 · 10th load · legacy key dropped regardless, logged once, no 11th send.
- [x] 5.5 (test-plan #X4) legacy value holding `/repo/a` and `/repo/a/` · migration runs · deduplicates to one key, one message sent.
- [x] 5.6 (test-plan #X5) legacy value present, server holds a folder the legacy set does NOT contain · migration runs · server's folder preserved (union, not overwrite).
- [x] 5.7 (test-plan #X6) migration already completed (no legacy key) · page reloads · no messages sent, no-op.

## 6. Browser E2E

Level L3 · Playwright vs the docker harness; read the dashboard port from
`.pi-test-harness.json` (`dashboardPort`), never hardcode `:18000`.
Harness exemplars: `tests/e2e/worktree-grouping-survives-remove.spec.ts`
(worktree-grouped folders), `tests/e2e/folder-actions-menu.spec.ts` (folder
header interaction), `tests/e2e/openspec-init-affordances-folder.spec.ts`
(folder seek/reveal wiring).

- [x] 6.1 (test-plan #F1) dashboard with ≥2 folder groups · collapse a folder, reload · converges to that folder collapsed and others expanded, with no intermediate frame showing it expanded. See `tests/e2e/folder-actions-menu.spec.ts`.
- [x] 6.2 (test-plan #F2) server holding a collapsed folder · fresh client connect · `collapsed_folders_updated` arrives before `sessions_snapshot`; folder never renders expanded-then-corrects. See `tests/e2e/folder-actions-menu.spec.ts`.
- [x] 6.3 (test-plan #F3) two browser contexts on one dashboard · collapse a folder in context A · context B converges to collapsed without a reload. See `tests/e2e/folder-membership-drag.spec.ts` for the multi-context pattern.
- [x] 6.4 (test-plan #F4) a session in `.worktrees/feat-x` grouped under its main path · collapse that group, reload · group renders collapsed (the leak that motivated the change). See `tests/e2e/worktree-grouping-survives-remove.spec.ts`.
- [x] 6.5 (test-plan #F5) target card inside a collapsed folder · activate Seek · scroll fires when the collapsed-folders echo lands, not at the backstop timeout; no Retry toast. See `tests/e2e/openspec-init-affordances-folder.spec.ts`.
- [x] 6.6 (test-plan #F6) collapsed folder ancestor · activate Seek twice, the second before the first echo lands · folder ends expanded, never re-collapses (toggle-inversion race). See `tests/e2e/openspec-init-affordances-folder.spec.ts`.
- [x] 6.7 (test-plan #F7) active session in a worktree, group rendered under the main path · activate Seek · the rendered group expands. See `tests/e2e/worktree-grouping-survives-remove.spec.ts`.
- [x] 6.8 (test-plan #F8) collapsed folder · click `+ Session` twice, the second before the first echo · folder ends expanded, not re-collapsed. See `tests/e2e/folder-actions-menu.spec.ts`.
- [x] 6.9 (test-plan #F9) a pinned directory with no sessions, collapsed · spawn a session elsewhere, then reload · pinned folder still collapsed (Leak B). See `tests/e2e/folder-actions-menu.spec.ts`.

## 7. Verification

- [x] 7.1 Run `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and verify zero failures.
- [x] 7.2 Manual check against a running dashboard on macOS: collapse a worktree-backed folder, a pinned zero-session folder, and an ended-only folder; reload; verify all three stay collapsed and `~/.pi/dashboard/preferences.json` shows their case-preserved paths in `collapsedFolders`.
- [x] 7.3 Open the dashboard in a second browser and verify the collapse state from 7.2 is reflected there.
