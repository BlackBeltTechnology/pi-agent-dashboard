## Why

The sidebar renders a single amber "Initialize" button (`WorktreeInitButton.tsx`) that is
polymorphic on `init-status.hasHook` and hides two semantically different actions behind an
identical label, icon (`mdiCogPlayOutline`), and color:

- **`hasHook: false`** → spawns an interactive **project-init** session that *scaffolds a new
  pi project* (writes `AGENTS.md` + `.pi/settings.json`).
- **`hasHook: true`** → runs the repo-declared **worktree-init hook** (`POST /api/git/worktree/init`),
  which executes *repo-provided, possibly untrusted code*.

A user cannot tell, before clicking, whether the button will create a scaffold or execute a
hook — actions at different levels (one-time project bootstrap vs per-checkout provisioning)
with different stakes.

Worse, the `init-status` API collapses **three** real-world states into a binary `hasHook`:

| State | `.pi/settings.json` | `worktreeInit` key | API today | Correct action |
|---|---|---|---|---|
| ① Unconfigured (bare dir) | absent | — | `{hasHook:false}` | scaffold ✅ |
| ② Configured + hook, unprovisioned | present | present | `{hasHook:true, needsInit:true}` | run hook ✅ |
| ③ Configured, no hook | present | absent | `{hasHook:false}` | **nothing** ❌ shows scaffold |

State ① and ③ both return `{hasHook:false}`, so an **already-configured project that simply
declares no worktree-init hook (③) is wrongly offered a "scaffold a pi project" button** — it
is already a pi project; there is nothing to initialize.

See [`mockups/index.html`](mockups/index.html) for the before/after across all three states:
the amber "Initialize" splits into a distinct indigo "Set up project" (scaffold, `ProjectInitButton`)
vs the unchanged amber "Initialize" (hook run, `WorktreeInitButton`), with state ③ rendering nothing.

## What Changes

- **Server — split the `hasHook:false` signal.** `GET /api/git/worktree/init-status` adds a
  `configured: boolean` field to every `hasHook:false` response:
  - `configRoot === null` → `{ hasHook:false, configured:false }` (state ①).
  - hook null but `<configRoot>/.pi/settings.json` exists → `{ hasHook:false, configured:true }` (state ③).
- **Client — split the button into two monomorphic components.**
  - Extract the no-hook branch out of `WorktreeInitButton` into a new **`ProjectInitButton`**
    with its own label ("Set up project"), icon, and neutral/primary color; it renders **only**
    when `hasHook===false && configured===false`.
  - `WorktreeInitButton` keeps **only** the hook-run branch (`hasHook===true`), retaining its
    amber "executes repo code" identity.
  - **State ③ renders nothing** — an already-configured project with no hook shows no button.

## Capabilities

### Modified Capabilities
- `git-operations-api`: `init-status` `hasHook:false` responses gain a `configured` boolean
  distinguishing an unconfigured directory (①) from a configured project with no hook (③).
- `folder-action-bar`: the no-hook "Initialize" action becomes a distinct `ProjectInitButton`
  gated on `configured===false`; a configured-but-hookless row (③) renders no button; the
  hook-run "Initialize" stays a separate control with its own identity.

## Non-Goals / Boundary

- Does **not** touch the `hasHook:true` hook-run feedback surface (status chip, opt-in log,
  boot rehydration) — that is owned by the active `friendlier-worktree-init` change, which
  explicitly scopes `hasHook:false` as "out of scope, a separate capability." This change *is*
  that separate capability. The only overlap is the shared file `WorktreeInitButton.tsx`;
  extracting the no-hook branch here does not alter the hook-branch behavior that change
  reworks.

## Discipline Skills

- `security-hardening` — the untrusted-hook execution path (TOFU trust, `configured`
  detection reading repo files) is touched; verify the split does not weaken the trust gate.
