## 1. Tests (write first, expect red)

- [x] 1.1 In `packages/client/src/components/__tests__/SessionList.test.tsx`, extend the existing add-to-workspace coverage: assert the button (testid `add-to-workspace-btn-<cwd>`) renders the visible text "Workspace" and no longer renders the `+ws` label.
- [x] 1.2 Confirm existing behavior tests still assert: clicking the button opens `AddToWorkspaceMenu`, and gating (renders only with a workspace present or `onCreateWorkspace`) holds.
- [x] 1.3 Run the file and verify the new label assertion fails (red) before implementing.

## 2. Implementation

- [x] 2.1 Add `mdiViewGridPlus` to the `@mdi/js` import in `SessionList.tsx`.
- [x] 2.2 In `renderGroupWithWorkspaceMenu`, replace the `+ws` button content/className with a labelled pill: `<Icon path={mdiViewGridPlus} size={0.55} />` + i18n "Workspace" text, using the shared blue affordance classes (`text-xs px-2 py-1 rounded border flex items-center gap-0.5 text-blue-500 border-blue-500/40 bg-blue-500/5 hover:text-blue-400 hover:border-blue-500/70`).
- [x] 2.3 Adjust the overlay position so the wider pill does not overlap the pin / open-home icons (retain `add-to-workspace-btn-<cwd>` testid, `stopPropagation`, and `title`).

## 3. Verify

- [x] 3.1 `npm test` (client project) — 3849 passed, 0 failed; SessionList add-to-workspace suite green.
- [x] 3.2 Biome on changed files — 21 warnings both before and after (all pre-existing, out-of-scope); zero net-new.
- [x] 3.3 `npm run build` — client builds clean.
- [x] 3.4 UI check: design confirmed via `mockups/add-to-workspace-button/` (Option A) in dark + light; rendered label + menu-open asserted by unit tests. Live dashboard not restarted (active sessions preserved).
