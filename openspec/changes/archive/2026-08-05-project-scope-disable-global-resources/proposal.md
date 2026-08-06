# Project-scope disable of globally-defined resources

## Why

Disabling a globally-defined skill for one project does not stick. The Resources view offers the toggle, the toggle appears to work, and the setting evaporates on refresh.

The dashboard writes the wrong thing. `toggleLoose()` derives `baseDir` from the **resource** (`item.metadata.baseDir`) but selects the destination file from the **request scope**. A project-scope toggle of a global skill therefore computes a pattern rooted at `~/.pi/agent`, writes it into `<proj>/.pi/settings.json`, and returns `200 OK`. pi resolves that pattern against `<proj>/.pi`, matches nothing, and reports the skill enabled. Verified: project settings received `{"skills":["-skills/image-to-3d-threejs/SKILL.md"]}`, global settings were untouched, and pi's `resolve()` still reported `enabled=true`.

pi supports this scenario natively. There are four distinct project-scope forms, one per resource origin, and the dashboard currently emits the wrong one for three of the four:

| resource origin | pi-standard project-scope disable | dashboard today |
|---|---|---|
| project loose (`<proj>/.pi/skills/*`) | `skills: ["-skills/foo/SKILL.md"]`, relative to `.pi` | ✅ correct |
| project `.agents` (cwd or an ancestor) | force-exclude relative to that entry's own `.agents` base dir | ❌ uses the wrong base dir |
| package-contributed | `packages: [{ source, autoload: false, skills: ["-skills/foo/SKILL.md"] }]`, relative to the package root | ❌ returns `404 package not found in settings for scope` |
| global loose (`~/.pi/agent/*`, `~/.agents/*`) | `skills: ["~/.pi/agent/skills/foo/SKILL.md", "!**/.pi/agent/skills/foo/**"]` — re-declare **the resource's own file** (tilde form), then exclude it with a home-independent anchored glob | ❌ writes an inert relative pattern, reports success |

All forms were verified against the pinned pi version. The package form is pi's documented delta mechanism (`package-manager.js:1383`: *"A project entry with autoload=false is a delta over the global entry, so both are kept"*). The global-loose form works because pi's `skills` array accepts directories as well as files, and a project settings entry outranks user auto-discovery in pi's own precedence order (`package-manager.js:54-57`).

The global-loose form is **narrow and home-independent by construction**, and both properties are load-bearing rather than stylistic. Re-declaring the whole `~/.pi/agent/skills` root pulls every sibling into project-scope resolution, and any glob elsewhere in the project's `skills` array then disables them (verified). An absolute-path force-exclude matches nothing in a collaborator's checkout, and a `~`-prefixed force-exclude matches nothing anywhere, because pi expands `~` for plain path entries but not inside patterns (both verified). The anchored-glob form was verified identical under two different `$HOME` values, leaving siblings enabled at user scope and leaving a same-named project skill untouched.

This change therefore needs **no new enforcement mechanism, no bridge-side interception, and no spawn-time flags**. It corrects which pi-standard form the dashboard writes.

Two further defects turn the failure silent and must be fixed alongside:

1. **Dead guard.** The scope-containment check in `toggleLoose()` compares `item.path` against a `baseDir` derived from `item.path`. It is tautologically true whenever `metadata.baseDir` is present — always, for pi-resolved resources — so the safety property its comment describes was never enforced.
2. **Silent revert.** `useResourceActivation.ts` calls `revert()` on any failure with no error surface, hiding both the phantom write and the genuine package-scope 404 that every package-contributed resource returns at project scope today.

## What Changes

- **The toggle emits the correct pi-standard form per resource origin.** Same-scope loose resources keep today's relative-path pattern. Package-contributed resources get an `autoload: false` delta entry in the project's `packages` array — at project scope only, since at global scope that form is silently discarded and the existing in-place mutation is correct. Globally-defined loose resources get a re-declaration of the resource's own **file** plus a home-independent anchored glob exclusion; re-declaring a directory is wrong because a bare `.md` skill, and every prompt and theme, have the shared root as their directory.
- **Re-enabling reverses each form exactly**, including removing the file re-declaration together with its exclusion, so a resource is not left permanently pinned to project precedence.
- **The package delta always carries `autoload: false`.** Verified: omitting it makes the project entry resolve at project scope, miss the user install path, and contribute **nothing** — the package's entire resource set disappears. The naive form is worse than doing nothing.
- **A genuinely project-owned package entry is never rewritten into a delta.** This repo already has one (`{ source: "<repo>", extensions: ["+packages/kb-extension/src/index.ts"] }`).
- **Re-enabling removes the force-exclude and writes nothing else.** The current path writes a `+` force-include, which never round-trips and — because `stripPrefix` also strips `!` — converts a user's hand-written `!` exclude into a force-include that inverts their intent.
- **Classification is by resolved path, not by reported metadata.** Disabling a global-loose resource flips its reported `scope` to `project`, `source` to `local` and drops `baseDir`, so metadata is not stable across the operation that mutates it. Path-relative-to-scope-base is.
- **The scope guard is directional, not containment-based.** A containment guard would reject the very write the global-loose form requires.
- **Force-excludes are matched as an equivalence class.** `-skills/foo` and `-skills/foo/SKILL.md` are different strings addressing the same file, and a force-exclude beats a force-include unconditionally, so a stale entry from pi's own `config-selector` would otherwise make a re-enable a silent no-op.
- **A trust decision is recorded before the write, not merely read.** Writing `.pi/settings.json` is itself what makes a folder trust-requiring, so a write against an implicitly-trusted folder leaves the next session with no recorded decision and silently discards the setting. When no decision exists the toggle returns a `trust_required` result for the client to present as a dialog — trust this folder, trust its parent, or decline. pi's own option builder is not exported, so the options are dashboard-authored; the decision is persisted through `ProjectTrustStore`, which is public, so the recorded result is indistinguishable from one pi wrote.
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
- **A re-declared global resource is reported at project scope.** Only that one resource, because the re-declaration is per-resource; its siblings stay at user scope. Presentation must handle the flip; the underlying file is untouched.
- **Re-enable semantics change for same-scope resources too.** Removing the `-` instead of writing `+` is a deliberate behaviour change, adopted so that disable-then-enable round-trips and never overrides a broader inherited exclude the user set on purpose.
- **The global-loose exclude pattern encodes pi's directory layout.** `!**/.pi/agent/skills/<name>/**` depends on the `~/.pi/agent` and `~/.agents` layouts staying as they are. A layout change upstream would make it inert; the `bump-pi-version` checklist gains a line.

## Capabilities

### New Capabilities
- `cross-scope-resource-disable`: selecting and writing the correct pi-standard project-scope deactivation form for each resource origin, reversing each form exactly on re-enable, and refusing scope combinations pi cannot express.

### Modified Capabilities
- `pi-resources-view`: the project-scope toggle must persist for globally-defined and package-contributed resources; toggle failures must surface instead of silently reverting; a re-declared resource's scope flip must not disorient the user; the repository-wide blast radius of a folder-scope change must be stated.

## Impact

**Code**
- `packages/server/src/pi/resource-activation-toggle.ts` — path-based origin classification and four write branches; replace the tautological guard with a directional one; remove the package-scope 404 by writing an `autoload: false` delta; equivalence-class stripping; real trust check.
- `packages/server/src/pi/pi-resource-activation.ts` — report the real trust state alongside the resolved resources. Note that removing the `projectTrusted: true` argument is a no-op, since the option defaults to true; an explicit check is what is missing.
- `packages/server/src/routes/resource-activation-routes.ts` — `trust_required` response carrying dashboard-authored options, and an endpoint to persist a choice via `ProjectTrustStore`.
- `packages/server/src/pi/resource-activation-toggle.ts` — also correct the header comment's false claim that pi's settings write is JSONC-preserving; it is a whole-file `JSON.parse`/`JSON.stringify` round trip.
- `packages/client/src/hooks/useResourceActivation.ts` — surface failures instead of `revert()`; drive the trust dialog and retry.
- `packages/client/src/components/settings/` — trust dialog, scope-flip presentation, repository-scope notice.

**Unchanged**
- `pi-resource-scanner.ts` activation sourcing — it already reads `enabled` from pi's resolver, which becomes correct once the writes are correct.
- `packages/extension/` and `packages/server/src/spawn-process/` — no bridge handler, no argv changes.
- pi itself, package install/uninstall, and global-scope toggling, which already works.

**Behaviour**
- `<proj>/.pi/settings.json` gains pi-standard entries only: relative force-excludes, `autoload: false` package deltas, and file re-declarations paired with anchored glob exclusions. Because pi rewrites the whole file on every save, each toggle produces a whole-file diff in version control rather than a one-line one.

## Discipline Skills

- `security-hardening` — the settings file is git-tracked and therefore attacker-influenceable via a hostile clone. The dashboard currently **forces** `projectTrusted: true` on both the read and the write path, so pi's trust gate is already bypassed here; this change removes that bypass and routes the decision to the user. Confirm no path around it remains.
- `doubt-driven-review` — the write path gained branches whose failure mode is silent-and-wrong (a delta missing `autoload: false` destroys a package's whole contribution); worth an adversarial pass before it stands.
- `review-code` — non-trivial change across server and client before commit.
