## Context

`generalize-worktree-init-hook` (change A) turns the Initialize button into "run the project's declared init hook." It explicitly scopes its folder-action-bar requirement to rows that HAVE a hook, leaving the no-hook case for this change.

This change fills that gap: an unconfigured directory's Initialize button launches an interactive **project-init skill** that scaffolds the directory — including writing the very `worktreeInit` hook that change A then consumes. B bootstraps A.

## Goals / Non-Goals

**Goals:**
- A bare directory can be turned into a configured pi project through a guided, conversational flow.
- The flow is driven by **project profiles** so different project kinds (coding, docs, …) get appropriate instructions, hooks, and toolsets.
- Profiles are data, extensible by users via `~/.pi/project-profiles/`, with prompts as separate files.
- The scaffold output is a valid change-A `worktreeInit` hook plus `AGENTS.md` and toolset settings.

**Non-Goals:**
- The hook engine, gate, trust, or hook-run endpoints (owned by change A).
- A non-interactive / detached scaffolder. This skill is conversational by design.
- A profile marketplace or remote profile fetching. Local shipped + `~/.pi/project-profiles/` only.
- Editing/upgrading an already-configured project (out of scope — Initialize only triggers for no-hook dirs).

## Decisions

### Decision 1: Polymorphic Initialize button — hook present vs absent

The button's behavior keys off change A's `init-status` `hasHook` flag:

```
   init-status.hasHook ?
   ┌────────────┴─────────────┐
  true                       false
   │                          │
 change A:                  change B:
 gate → run hook            spawn interactive
 (script | detached agent)  project-init session
```

**Why the same button:** one affordance ("get this directory ready"). The user doesn't care whether that means "install deps" or "scaffold from scratch"; the system routes by configuration state.

### Decision 2: The project-init skill is a first-class interactive session

Unlike change A's detached `agent` flavor, project-init must converse — it asks which profile, confirms writes, guides. So clicking Initialize on a no-hook directory SHALL spawn a **normal dashboard session** (reusing the existing spawn-session machinery) with the project-init skill pre-injected, cwd = the directory.

```
   click Initialize (no hook)
        │
        ▼
   spawn_session { cwd: <dir>, skill: project-init }   ← existing path
        │
        ▼
   visible session, full transcript, ask_user Q&A, abortable
```

**Why interactive, not detached:** the value is the guidance. A detached agent can't ask "coding or docs?" and can't show the user what it's about to write.

### Decision 3: Profile = a directory bundle

```
skills/project-init/
  SKILL.md
  profiles/
    coding/
      AGENTS.md.tmpl
      settings.json.tmpl     # contains the worktreeInit hook + toolset toggles
      prompts/*.md
    docs/
      AGENTS.md.tmpl
      settings.json.tmpl
      prompts/*.md
```

Each profile carries: `AGENTS.md` template, a `settings.json` template (with a change-A `worktreeInit` hook and toolset toggles such as OpenSpec on/off and enabled skills), and a `prompts/` directory of separate, extensible prompt files.

| Profile | AGENTS.md emphasis | worktreeInit hook | Toolset |
|---|---|---|---|
| `coding` | TDD, simplicity, surgical changes | `gate: test ! -d node_modules`, `run: npm ci` (or lockfile-aware) | OpenSpec ON |
| `docs` | writing structure, style | docs build (or none) | OpenSpec OFF, docs skills |

**Why a directory, not a single config blob:** prompts-as-files is the extensibility requirement — users drop/edit `.md` files without touching skill logic.

### Decision 4: Profile resolution — shipped + user, user wins by name

```
   resolution order (later wins on name collision):
   1. <skill>/profiles/*           shipped defaults (coding, docs)
   2. ~/.pi/project-profiles/*      user profiles / overrides
```

A user `coding` profile fully shadows the shipped `coding`. NOT resolved from the target `./.pi/` (chicken/egg — the project isn't configured yet).

**Why user-wins:** lets a user standardize their own `AGENTS.md` / hook across all their projects without forking the skill.

### Decision 5: Full scaffold writes a valid change-A hook

On profile selection + confirmation, the skill writes:

```
   <dir>/AGENTS.md              from AGENTS.md.tmpl
   <dir>/.pi/settings.json      from settings.json.tmpl  (worktreeInit hook + toolset)
   <dir>/.pi/prompts/*.md       (or profile-appropriate location) from prompts/
```

Writing `worktreeInit` flips the directory to "configured." The next Initialize click hits change A's `hasHook: true` path. Idempotent by construction.

**Constraint:** `settings.json.tmpl`'s `worktreeInit` MUST conform to change A's schema (gate + run script|agent), or the directory ends up half-configured (a hook that A rejects → fail-open `null` → Initialize loops back to the skill).

## Flow

```
   Bare directory row
        │ init-status → hasHook: false
        ▼
   [Initialize] button (this change)
        │ click → spawn interactive project-init session (cwd=dir)
        ▼
   skill: list profiles (shipped ∪ ~/.pi/project-profiles)
        │ ask_user: which profile?
        ▼
   skill: preview what it will write → confirm
        ▼
   write AGENTS.md + .pi/settings.json(worktreeInit) + prompts/
        ▼
   directory now configured → init-status flips to hasHook: true
        ▼
   next Initialize → change A (run the written hook)
```

## Open Questions

- Exact on-disk location for profile prompt files in the scaffolded project (`.pi/prompts/` vs profile-defined paths).
- Whether profile enumeration needs a server endpoint or the skill reads the dirs itself (skill runs in a session with fs access → likely skill-side).
- Template substitution surface (project name, package manager) — keep minimal; the skill can ask and fill.
- Whether `docs` profile's hook is "no-op gate" (never needs init) or a real docs-build; depends on shipped profile content.
