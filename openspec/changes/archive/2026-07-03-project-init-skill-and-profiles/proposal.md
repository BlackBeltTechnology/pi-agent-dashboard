## Why

The `generalize-worktree-init-hook` change makes the Initialize button run a project's declared init hook. But a brand-new, unconfigured directory has **no** hook, no `AGENTS.md`, no toolset settings — nothing to run. Today there is no guided way to turn a bare directory into a configured pi project.

Setting up a project well is repetitive and easy to get wrong: which discipline rules go in `AGENTS.md`, whether OpenSpec is wired in, which skills to enable, what the worktree-init hook should be. Different *kinds* of project want different answers — a coding repo and a documentation repo share almost nothing.

## What Changes

- **Make the Initialize button polymorphic.** When a directory has a `worktreeInit` hook → run it (the `generalize-worktree-init-hook` behavior). When it has **no** hook → run a pi-dashboard-delivered **project-init skill**: an interactive scaffolder.
- **Ship a `project-init` skill** that runs as a **first-class, interactive dashboard session** (it asks questions via `ask_user` and guides). It is NOT a detached process — the user converses with it.
- **Introduce project profiles.** A profile bundles everything that varies by project style: an `AGENTS.md` template, a `worktreeInit` hook, toolset toggles (e.g. OpenSpec on/off, enabled skills), and a set of prompt files. Shipped profiles: `coding`, `docs`. Profiles are discovered from the shipped skill dir AND from `~/.pi/project-profiles/` (user overrides win by name).
- **Prompts live as separate files** inside each profile, so they can be extended and overridden later without touching skill code.
- **Ship a canonical DOX doctrine artifact** (`dox-doctrine.md`, adapted from agent0ai/dox) ONCE with the skill — the read-before-editing / update-after-editing per-directory `AGENTS.md` doctrine. It is a single shared file (profiles reference it, they don't each hand-copy it) and is kb-indexable so `kb_search "dox doctrine"` retrieves it. A profile MAY opt into DOX (`dox: true`).
- **Seed the DOX doctrine into the scaffolded root `AGENTS.md` when absent.** When the chosen profile opts into DOX and the target `AGENTS.md` does not already carry the doctrine (detected by a stable marker), the scaffold appends the doctrine block and enables the directory-level AGENTS.md toolset (`indexAgentsFiles` / `directoryLevelAgents`) in the written `settings.json`. Idempotent: re-running never double-seeds.
- **The skill performs a full scaffold** of the chosen profile: writes `AGENTS.md`, `.pi/settings.json` (including the `worktreeInit` hook), toolset settings, and the profile's prompt files. Writing the hook flips the directory to "configured" — the next Initialize click falls through to the hook (change A).

## Capabilities

### New Capabilities

- `project-init-skill`: A pi-dashboard-delivered interactive skill that scaffolds an unconfigured directory into a pi project. Runs as a first-class dashboard session, asks guiding questions, selects a profile, and writes a full scaffold (`AGENTS.md`, `.pi/settings.json` with a `worktreeInit` hook, toolset settings, prompt files).
- `project-profiles`: A profile system. A profile is a directory bundling an `AGENTS.md` template, a `worktreeInit` hook, toolset toggles, and prompt files, plus an optional `dox` opt-in. Profiles resolve from shipped defaults (`coding`, `docs`) plus `~/.pi/project-profiles/`, with user profiles overriding shipped ones by name. A DOX-opted profile seeds the shared `dox-doctrine.md` into the scaffolded root `AGENTS.md` when absent and enables the directory-level AGENTS.md toolset.

### Modified Capabilities

- `folder-action-bar`: The Initialize button becomes polymorphic. For a row with no declared hook (`hasHook: false`), the button is shown and routes to the project-init skill (spawning an interactive session). For a row with a hook, the change-A behavior (gate-gated hook run) applies.

## Impact

**Code touched:**
- New skill `packages/.../skills/project-init/` (SKILL.md + `profiles/coding/`, `profiles/docs/` each with `AGENTS.md.tmpl`, `settings.json.tmpl`, `prompts/*.md`).
- Profile resolver (server or skill-side): merge shipped `<skill>/profiles/*` with `~/.pi/project-profiles/*`, user-wins-by-name.
- `packages/client/src/components/WorktreeSpawnDialog.tsx` + folder-action-bar — when init-status reports `hasHook: false`, show Initialize → spawn an interactive session preloaded with the project-init skill (reuse existing spawn-session machinery).
- Possibly a small server endpoint to enumerate available profiles for the skill / dialog.

**Not touched:**
- The worktree-init hook engine, gate, trust, and hook-run endpoints (owned by `generalize-worktree-init-hook`).
- The detached agent-flavor run path — the project-init skill is explicitly a normal interactive session, not the detached agent flavor.
- **The DOX tree data structure + `kb dox init` source-awareness** (owned by `migrate-file-index-to-agents-tree`). This change only seeds the ROOT `AGENTS.md` doctrine into a NEW/bare project and flips the toolset toggles; it does NOT walk source, build the recursive per-directory tree, or migrate this repo's `docs/file-index-*.md`. Standing up the tree is the agent's job later, per the seeded doctrine.
- **kb bring-up UI + cold-worktree reindex** (owned by `add-kb-folder-slot`) — the doctrine here is retrievable via kb once indexed, but making an uninitialized kb visible/indexable from the dashboard is that change's concern.

**Dependency:** This change DEPENDS ON `generalize-worktree-init-hook`. It needs the hook schema (so the skill can write a valid `worktreeInit`), the init-status endpoint (to know `hasHook`), and the Initialize button (to extend its routing). Land A first.

**End-user impact:** A bare directory gains a guided "Initialize" path that scaffolds a working pi project. Existing configured projects are unaffected (they have a hook → change-A path).

**Risk:** Spawning an interactive session from a button is heavier than a script run; must reuse the existing, tested spawn-session path. Writing files into a user's directory must be confirmed/visible (the session is interactive, so the user drives it). Profile templates must produce a valid `worktreeInit` per change A's schema, or the scaffold leaves the directory half-configured.
