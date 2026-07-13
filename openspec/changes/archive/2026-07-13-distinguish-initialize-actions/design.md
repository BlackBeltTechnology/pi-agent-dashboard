## Context

`WorktreeInitButton.tsx` renders one amber "Initialize" button that is polymorphic on
`GET /api/git/worktree/init-status`'s `hasHook` field. Two unrelated actions hide behind one
identity:

- `hasHook:false` + `onInitializeProject` → spawns an interactive project-init session that
  *scaffolds a new pi project*.
- `hasHook:true` + (`needsInit` OR `!trusted`) → runs the repo-declared *worktree-init hook*
  (`POST /api/git/worktree/init`), executing possibly-untrusted repo code.

Server detection (`git-routes.ts` → `init-status`) collapses three real states into a binary:
`resolveConfigRoot(cwd)` then `readInitHook(configRoot)`. `hasHook:false` is returned both
when the directory has no `.pi/settings.json` at all (state ①, truly unconfigured) AND when
a `.pi/settings.json` exists but declares no `worktreeInit` hook (state ③, already a
configured project). The client cannot tell ① from ③, so ③ is wrongly offered a "scaffold"
button.

The active `friendlier-worktree-init` change owns the `hasHook:true` feedback UI and declares
`hasHook:false` out of scope. This change is that complementary capability. The only shared
file is `WorktreeInitButton.tsx`.

## Goals / Non-Goals

**Goals:**
- Make the `init-status` API able to distinguish state ① (unconfigured) from state ③
  (configured, no hook) via a `configured` boolean.
- Split the polymorphic button into two monomorphic components with distinct identities.
- Ensure a configured-but-hookless row (③) renders no initialize control.
- Preserve the hook-run path (state ②) behavior unchanged.

**Non-Goals:**
- Redesigning the `hasHook:true` hook-run feedback surface (chip, opt-in log, rehydration) —
  owned by `friendlier-worktree-init`.
- Adding an "Add worktree-init hook" affordance for state ③ (deferred; ③ renders nothing).
- Changing the project-init skill, scaffold logic, or spawn-session machinery.
- Changing the TOFU trust model or gate-evaluation cache.

## Decisions

### D1 — Add `configured: boolean` to `hasHook:false` responses (not a new endpoint)

The `init-status` route already computes `configRoot` and reads the hook. Extend the two
`hasHook:false` return points rather than adding a second probe:

- `configRoot === null` → `{ hasHook:false, configured:false }`.
- hook is `null` but `fs.existsSync(<configRoot>/.pi/settings.json)` → `{ hasHook:false, configured:true }`.

`configured` is present ONLY on `hasHook:false` responses (absent when `hasHook:true`), keeping
the hook-branch payload untouched.

*Why:* the config-root resolution already runs; one `existsSync` distinguishes ① from ③ with
no extra I/O of note. Alternative (a separate `/configured` endpoint) doubles round-trips per
row for no benefit.

*Edge case:* a git repo with no `.pi/settings.json` — `configRoot = resolveConfigRoot(cwd)`
(non-null, since it falls through to `resolveMainPath` for a git repo) but the settings file is absent → `existsSync` false → `configured:false` → state ①
(scaffold), which is correct (a git repo not yet set up for pi should be scaffoldable).

### D2 — Extract `ProjectInitButton` as a new component; slim `WorktreeInitButton`

Create `packages/client/src/components/ProjectInitButton.tsx` owning the no-hook scaffold
branch (its own probe, or a shared status prop — see D3). Remove the `showProjectInit` branch
and the `onInitializeProject` prop from `WorktreeInitButton`, leaving it hook-only.

- `ProjectInitButton`: label "Set up project", distinct icon (e.g. `mdiFolderPlusOutline` /
  wand), neutral or primary color — NOT amber. testid `project-init-btn`.
- `WorktreeInitButton`: unchanged amber identity, testid `worktree-init-btn`.

*Why:* monomorphic components are individually testable, and the two visual identities make
scaffold-vs-execute unmistakable. Alternative (keep one component, branch on `configured`)
preserves the footgun of a shared identity and a growing polymorphic component.

### D3 — Gating: `ProjectInitButton` renders iff `hasHook===false && configured===false`

State ③ (`hasHook:false, configured:true`) renders nothing from either component. Fail-open
stays: any probe error → `{hasHook:false}` with `configured` absent → treat as *not shown*
(absent `configured` MUST NOT render the scaffold button, to avoid offering scaffold on a
degraded probe).

*Decision:* the scaffold button requires `configured === false` **explicitly** (strict
`=== false`, not falsy), so an error/absent `configured` hides it.

### D4 — Call-site wiring

Whatever renders `WorktreeInitButton` today (folder-action-bar row) renders **both** buttons;
each self-gates on the shared init-status. Prefer a single `init-status` fetch shared between
the two (lift the probe to the row or a small hook) over two independent probes per row, to
avoid doubling requests. If the current architecture has `WorktreeInitButton` self-probe, the
row now owns the probe and passes `status` down to both children.

## Risks / Trade-offs

- **Shared file with `friendlier-worktree-init`** → both changes edit `WorktreeInitButton.tsx`.
  Mitigation: this change only *removes* the no-hook branch + prop; that change *reworks* the
  hook branch. Land order is flexible but do a rebase/merge check; note in tasks.
- **Absent `configured` on degraded probe hides the scaffold button** → a truly-unconfigured
  dir whose probe errors shows no "Set up project". Mitigation: acceptable (fail-open, matches
  existing hidden-on-error behavior); the button reappears on the next successful probe.
- **Type change ripples** → `WorktreeInitStatus` type in `git-api.ts` gains `configured?`.
  Mitigation: optional field; existing consumers (`auto-init-worktree.ts`) read `hasHook`/
  `needsInit`/`trusted` only and are unaffected.
- **Existing tests** reference `project-init-btn` on `WorktreeInitButton`. Mitigation: move
  those assertions to the new `ProjectInitButton` test; update `WorktreeInitButton.test.tsx`
  to drop the no-hook cases.

## Migration Plan

Pure additive API field + client component split; no data migration, no persistence change.
Rollback = revert the commit. No feature flag needed — behavior change is limited to which
button (if any) a row shows.

## Open Questions

- Final copy/icon for `ProjectInitButton` ("Set up project" vs "Initialize project" vs "Set
  up pi") — resolve during implementation with the tailwind/react pass; not blocking.
- Should the shared probe live in the folder-action-bar row or a `useInitStatus(cwd)` hook?
  Decide at D4 implementation based on the current call-site shape.
