# Project-scope disable of globally-defined resources

## Why

Disabling a globally-defined skill for one project does not stick. The Resources view offers the toggle, the toggle appears to work, and the setting evaporates on refresh.

The dashboard writes the wrong thing. `toggleLoose()` derives `baseDir` from the **resource** (`item.metadata.baseDir`) but selects the destination file from the **request scope**. A project-scope toggle of a global skill therefore computes a pattern rooted at `~/.pi/agent`, writes it into `<proj>/.pi/settings.json`, and returns `200 OK`. pi resolves that pattern against `<proj>/.pi`, matches nothing, and reports the skill enabled. Verified: project settings received `{"skills":["-skills/image-to-3d-threejs/SKILL.md"]}`, global settings were untouched, and pi's `resolve()` still reported `enabled=true`.

pi supports this scenario natively. There are three distinct project-scope forms, one per resource origin, and the dashboard currently emits the wrong one for two of the three:

| resource origin | pi-standard project-scope disable | dashboard today |
|---|---|---|
| project loose (`<proj>/.pi/skills/*`) | `skills: ["-skills/foo/SKILL.md"]`, relative to `.pi` | ✅ correct |
| package-contributed | `packages: [{ source, autoload: false, skills: ["-skills/foo/SKILL.md"] }]`, relative to the package root | ❌ returns `404 package not found in settings for scope` |
| global loose (`~/.pi/agent/*`, `~/.agents/*`) | `skills: ["<global skills dir>", "-<absolute path to SKILL.md>"]` — re-declare the directory as a project settings entry, then force-exclude the member | ❌ writes an inert relative pattern, reports success |

All three forms were verified against the pinned pi version. The second is pi's documented delta mechanism (`package-manager.js:1383`: *"A project entry with autoload=false is a delta over the global entry, so both are kept"*). The third works because pi's `skills` array accepts directories as well as files, and a project settings entry outranks user auto-discovery in pi's own precedence order (`package-manager.js:54-57`).

This change therefore needs **no new enforcement mechanism, no bridge-side interception, and no spawn-time flags**. It corrects which pi-standard form the dashboard writes.

Two further defects turn the failure silent and must be fixed alongside:

1. **Dead guard.** The scope-containment check in `toggleLoose()` compares `item.path` against a `baseDir` derived from `item.path`. It is tautologically true whenever `metadata.baseDir` is present — always, for pi-resolved resources — so the safety property its comment describes was never enforced.
2. **Silent revert.** `useResourceActivation.ts` calls `revert()` on any failure with no error surface, hiding both the phantom write and the genuine package-scope 404 that every package-contributed resource returns at project scope today.

## What Changes

- **The toggle emits the correct pi-standard form per resource origin.** Same-scope loose resources keep today's relative-path pattern. Package-contributed resources get an `autoload: false` delta entry in the project's `packages` array. Globally-defined loose resources get a directory re-declaration plus an absolute force-exclude.
- **Re-enabling reverses each form exactly**, including removing a directory re-declaration once its last exclusion is gone, so a resource is not left permanently pinned to project precedence.
- **The package delta always carries `autoload: false`.** Verified: omitting it makes the project entry resolve at project scope, miss the user install path, and contribute **nothing** — the package's entire resource set disappears. The naive form is worse than doing nothing.
- **A genuinely project-owned package entry is never rewritten into a delta.** This repo already has one (`{ source: "<repo>", extensions: ["+packages/kb-extension/src/index.ts"] }`).
- **Toggle failures surface** instead of silently reverting.
- **The Resources view accounts for the scope flip.** Verified: a re-declared global resource reports `scope: project` / `source: local` instead of `scope: user` / `source: auto`, so it would otherwise jump from the Global section into the Local one.

### What this change does not need

Earlier exploration assumed no native mechanism existed and designed two enforcement layers around that assumption. Both are now unnecessary and are explicitly **not** part of this change:

- No `before_agent_start` skill-splice in the bridge extension.
- No `--no-extensions` spawn-time allowlist, and therefore no inversion of ownership of pi's discovery pipeline and no drift risk on pi version bumps.
- No dashboard-private notation, and no read-side activation overlay — because the dashboard writes pi-standard forms, `resolve().enabled` reports the truth and the read path needs no change at all.

Because pi enforces the result, the disable also applies to terminal-started sessions, agrees with pi's own `/config`, and covers all four resource types uniformly.

### Accepted limitations

- **A project-scope disable is a committed, team-wide decision.** `.pi/settings.json` is git-tracked here, so the setting propagates to collaborators and to every worktree of the branch. This is intended, but the UI must say so rather than imply a machine-local preference.
- **Project trust is required.** pi does not read project settings for an untrusted folder, so nothing is suppressed there. This is pi's existing behaviour, inherited rather than added.
- **A re-declared global resource is reported at project scope.** Presentation must handle it; the underlying file is untouched.

## Capabilities

### New Capabilities
- `cross-scope-resource-disable`: selecting and writing the correct pi-standard project-scope deactivation form for each resource origin, reversing each form exactly on re-enable, and refusing scope combinations pi cannot express.

### Modified Capabilities
- `pi-resources-view`: the project-scope toggle must persist for globally-defined and package-contributed resources; toggle failures must surface instead of silently reverting; a re-declared resource's scope flip must not disorient the user; the repository-wide blast radius of a folder-scope change must be stated.

## Impact

**Code**
- `packages/server/src/pi/resource-activation-toggle.ts` — origin classification and three write branches; repair the tautological scope guard; remove the package-scope 404 by writing an `autoload: false` delta.
- `packages/client/src/hooks/useResourceActivation.ts` — surface failures instead of `revert()`.
- `packages/client/src/components/settings/` — scope-flip presentation and the repository-scope notice.

**Unchanged**
- `packages/server/src/pi/pi-resource-activation.ts` and `pi-resource-scanner.ts` — the read path stays as-is. It already sources `enabled` from pi's resolver, which becomes correct once the writes are correct.
- `packages/extension/` and `packages/server/src/spawn-process/` — no bridge handler, no argv changes.
- pi itself, package install/uninstall, and global-scope toggling, which already works.

**Behaviour**
- `<proj>/.pi/settings.json` gains pi-standard entries only: relative force-excludes, `autoload: false` package deltas, and directory re-declarations with absolute force-excludes.

## Discipline Skills

- `security-hardening` — the settings file is git-tracked and therefore attacker-influenceable via a hostile clone; confirm pi's existing trust gate is the only thing standing between a clone and capability suppression, and that this change adds no path around it.
- `doubt-driven-review` — the write path gained branches whose failure mode is silent-and-wrong (a delta missing `autoload: false` destroys a package's whole contribution); worth an adversarial pass before it stands.
- `review-code` — non-trivial change across server and client before commit.
