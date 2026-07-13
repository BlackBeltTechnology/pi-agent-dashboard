## 1. Server — `configured` on init-status (TDD)

- [x] 1.1 In `packages/server/src/routes/__tests__` (or the existing git-routes test file), add failing tests for `GET /api/git/worktree/init-status`: (a) directory with no reachable `.pi/settings.json` → `{ hasHook:false, configured:false }`; (b) config root with `.pi/settings.json` but no `worktreeInit` → `{ hasHook:false, configured:true }`; (c) `hasHook:true` responses have NO `configured` field.
- [x] 1.2 In `packages/server/src/routes/git-routes.ts`, extend the two `hasHook:false` return points: `configRoot === null` → add `configured:false`; hook `null` but `fs.existsSync(<configRoot>/.pi/settings.json)` → add `configured:true`. Leave both `hasHook:true` branches untouched.
- [x] 1.3 Verify: the git-routes init-status tests pass; existing init-status tests still green.

## 2. Shared/client type — `configured` field

- [x] 2.1 In `packages/client/src/lib/git-api.ts`, add `configured?: boolean` to `WorktreeInitStatus` (present only on `hasHook:false`). Confirm the fail-open path (`{ hasHook:false }` on error) leaves `configured` undefined.
- [x] 2.2 Verify: `tsc --noEmit` clean; `auto-init-worktree.ts` and its tests still compile (they read `hasHook`/`needsInit`/`trusted` only).

## 3. Client — extract `ProjectInitButton` (TDD)

- [x] 3.1 Add `packages/client/src/components/__tests__/ProjectInitButton.test.tsx` (failing): renders the "Set up project" button ONLY when status is `{ hasHook:false, configured:false }` and `onInitializeProject` is provided; renders nothing for `{ hasHook:false, configured:true }`, for absent `configured`, and for `hasHook:true`; click calls `onInitializeProject(cwd)`. Assert testid `project-init-btn` and a non-amber class identity.
- [x] 3.2 Create `packages/client/src/components/ProjectInitButton.tsx`: distinct label ("Set up project"), distinct icon (not `mdiCogPlayOutline`), neutral/primary color. Gate strictly on `hasHook===false && configured===false && !!onInitializeProject`.
- [x] 3.3 Verify: `ProjectInitButton.test.tsx` passes.

## 4. Client — slim `WorktreeInitButton` to hook-only (TDD)

- [x] 4.1 Update `packages/client/src/components/__tests__/WorktreeInitButton.test.tsx`: remove the no-hook / `project-init-btn` cases (moved to ProjectInitButton); add/keep a case asserting `{ hasHook:false, configured:true }` renders nothing.
- [x] 4.2 In `WorktreeInitButton.tsx`, remove the `showProjectInit` branch, the `onInitializeProject` prop, and the now-unused `Props` field + imports. Keep the `hasHook===true` hook-run behavior unchanged.
- [x] 4.3 Verify: `WorktreeInitButton.test.tsx` passes; no orphaned imports (biome clean).

## 5. Wiring — call site renders both, single probe

- [x] 5.1 Find the row/component that renders `WorktreeInitButton` today (folder-action-bar row / `WorktreeInitButton.tsx.AGENTS.md` owner). Lift the `init-status` probe to the row (or a small `useInitStatus(cwd)` hook) so ONE fetch feeds both children (avoid double-probing).
- [x] 5.2 Render `ProjectInitButton` (with the existing `onInitializeProject` handler wired) and the slimmed `WorktreeInitButton` side by side; each self-gates on the shared status. Confirm state ③ shows neither.
- [x] 5.3 Verify: manual/RTL check — ① shows "Set up project", ② shows amber "Initialize", ③ shows nothing.

## 6. Docs & gates

- [x] 6.1 Update the per-file `AGENTS.md` rows: add `ProjectInitButton.tsx` row; update the `WorktreeInitButton.tsx` / `.AGENTS.md` sidecar to drop the polymorphic no-hook description and add `See change: distinguish-initialize-actions`. Update the `git-api.ts` row if `WorktreeInitStatus` note exists.
- [x] 6.2 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm green; `npm run quality:changed`.
- [x] 6.3 Run the `security-hardening` checkpoint over the diff: confirm the `configured` detection and the button split do not weaken the TOFU trust gate or expose repo-file reads beyond the existing `existsSync`.
- [x] 6.4 `npx openspec validate distinguish-initialize-actions --strict` passes.
