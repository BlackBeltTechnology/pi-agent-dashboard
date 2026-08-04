## Context

The dashboard deliberately does not re-implement pi's activation semantics: it reads `ResolvedResource.enabled` from `PackageManager.resolve()` and writes through pi's `SettingsManager` (see `pi-resource-activation.ts`). That contract is sound. The bug is that the write path picks the wrong *form* for two of the three resource origins, producing settings entries pi cannot match.

### Verified findings

Every statement below was established by reading the pinned pi source or by executing probes in a sandboxed `HOME`. None is inferred.

**F1 — three origins, three project-scope forms.** pi expresses a project-scope disable differently depending on where the resource comes from:

| origin | form | probe result |
|---|---|---|
| project loose | `skills: ["-skills/foo/SKILL.md"]` (relative to `<proj>/.pi`) | disabled |
| package | `packages: [{ source, autoload: false, skills: ["-skills/foo/SKILL.md"] }]` (relative to package root) | disabled |
| global loose | `skills: ["<dir>", "-<abs path>"]` | disabled |

**F2 — the current cross-scope write is inert.** `toggleLoose()` takes `baseDir` from `item.metadata.baseDir` while `persistLoose()` picks the destination from `isProject`. A project-scope toggle of a global skill wrote `{"skills":["-skills/image-to-3d-threejs/SKILL.md"]}` into project settings, left global settings untouched, and pi still reported `enabled=true`.

**F3 — the scope guard is dead code.** The containment check derives `baseDir` from `item.path`, so it cannot fail while `metadata.baseDir` is present. Its comment ("a global toggle can therefore never write a folder file") describes an unenforced property.

**F4 — no bare-name or free-floating pattern reaches a global resource.** Against a global skill from project settings, all of `-skills/g/SKILL.md`, `-g`, `-<abs>`, `-<abs parent>`, `-**/g/**`, `!g` were silent no-ops; the same pattern in global settings worked. `matchesAnyPattern()` is permissive — it tests relative path, basename, absolute path, and for `SKILL.md` the parent directory in three forms — so patterns were never the blocker. `addAutoDiscoveredResources()` simply pairs each resource set with one override array chosen by where the resource lives, and never hands project overrides to a user resource set. **A force-exclude alone does not work; the directory must also be re-declared** (probe: `force-exclude only (no redeclare)` → still enabled).

**F5 — the package delta requires `autoload: false`, and omitting it is destructive.** Against a simulated npm install:

```
baseline (no project entry)             → alpha=ON  beta=ON
project filter WITHOUT autoload:false   → (no skills at all)
project DELTA with autoload:false       → alpha=ON  beta=OFF
project .pi/npm created?                  false
```

`findAutoloadDeltaBase()` engages **only** when `autoload === false`, and resolves the entry against the *user's* install path. Without it, `resolvedScope` stays `"project"`, `getNpmInstallPath()` points at `.pi/npm/`, the path does not exist, and the loop `continue`s — dropping the package's entire contribution. Local-path package sources tolerate the naive form (no install path is involved); `npm:` and `git:` sources do not.

**F6 — re-declaration works for every global loose location and for extensions.** Probes covering `~/.pi/agent/skills`, `~/.agents/skills`, and `~/.pi/agent/extensions`, individually and together, each disabled exactly the targeted resource and left its siblings enabled. No duplicate resource entries were produced.

**F7 — re-declaration flips the reported scope.** `scope: user` / `source: auto` / `baseDir: <agentDir>` becomes `scope: project` / `source: local` / `baseDir: undefined`. This is pi's precedence model working as designed — a project settings entry ranks 0, user auto-discovery ranks 3 (`package-manager.js:54-57`) — but it is visible in the scanner output and therefore in the UI.

**F8 — `.pi/settings.json` is git-tracked** in this repo. A project-scope disable is a shared, committed, branch-scoped decision inherited by every worktree of the branch.

**F9 — the real distribution.** In this workspace: 25 project-loose skills (already working), 32 package-contributed skills, 2 global-loose skills; 16 package-contributed extensions and 0 global-loose extensions. Both cases the change fixes are heavily populated.

### Superseded findings

Earlier exploration concluded that no native mechanism existed and designed two enforcement layers around that conclusion. F1, F5 and F6 supersede it. Recorded so the reasoning is not repeated:

- A `before_agent_start` splice of `event.systemPromptOptions.skills` does work — the array is a live alias of the ResourceLoader's own array — but it is unnecessary, applies only to skills, and would diverge from pi's own view of activation.
- A `--no-extensions` plus explicit `-e` spawn allowlist does work, but `--no-extensions` also suppresses project-local discovery, so it would force the dashboard to re-enumerate pi's entire discovery result. Unnecessary, and with 0 global-loose extensions it never had a target.
- `ResourceLoader` exposes a purpose-built `skillsOverride` hook, but it is constructor-only and unreachable when spawning `pi --mode rpc`.

## Goals / Non-Goals

**Goals:**
- Write the correct pi-standard form for each of the three resource origins, so pi enforces the result.
- Reverse each form exactly on re-enable, leaving no residue that pins a resource to project precedence.
- Never damage a package's contribution or a project-owned package entry while writing a delta.
- Make every toggle failure legible.

**Non-Goals:**
- Changing pi.
- Any dashboard-side enforcement mechanism. Enforcement is pi's, and this change's whole point is to stop working around it.
- Any read-path change. Once the writes are correct, `resolve().enabled` is correct.
- Uninstalling packages, removing files, or altering `/skill:name` registration.
- A machine-local (untracked) disable scope. `.pi/settings.json` is shared by design here.

## Decisions

### D1 — Classify by resource origin, then write pi's form for that origin

The toggle resolves the resource through `PackageManager.resolve()` (as it already does), reads `metadata.origin` and `metadata.baseDir`, and dispatches to one of three writers. No dashboard-specific notation is introduced anywhere.

*Alternatives considered.* A name-based `-<name>` notation interpreted by the dashboard was the previous design; it is rejected now that all three origins have native forms. It would have required a read-side overlay, a bridge enforcement path, and would have left pi's `/config` permanently disagreeing with the dashboard.

### D2 — Package resources: always an `autoload: false` delta, never a plain filter

F5 makes this a correctness requirement, not a style preference. The writer creates `{ source, autoload: false, <type>: ["-<relative to package root>"] }` when the project has no entry for that source, and augments the existing delta when it does.

**Guard:** if the project already has a *non-delta* entry for that source — a package the project genuinely declares, such as this repo's `{ source: "<repo>", extensions: ["+packages/kb-extension/src/index.ts"] }` — the writer adds the exclusion to that existing entry using pi's ordinary filter semantics and does **not** convert it to a delta. Converting it would re-point resolution at a user install that may not exist.

### D3 — Global loose resources: re-declare the directory, then force-exclude by absolute path

F4 shows a force-exclude alone is inert; the directory entry is what brings the resource into project-scope resolution so the exclusion can outrank auto-discovery. The exclusion is written as an absolute path because `matchesAnyExactPattern()` compares against the absolute path directly, making the entry independent of the project's base directory.

The directory entry is added only if not already present, and the pair is treated as a unit.

### D4 — Re-enable must clean up the re-declaration

Removing only the `-` pattern would leave the bare directory entry behind, permanently reclassifying every resource in that directory as project-scope (F7). The writer removes the force-exclude and, when no force-excludes remain for that directory and the directory was added by the dashboard rather than by the user, removes the directory entry too.

This is the subtlest part of the change and the easiest to get wrong: the failure is invisible in activation state and shows up only as resources silently migrating between UI sections.

### D5 — Reject scope combinations pi cannot express

A `global` scope toggle of a project resource has no pi form — the global settings file cannot reference a project resource without the same re-declaration trick, which would be nonsensical (a machine-wide setting pointing into one checkout). The server rejects it with a clear error rather than writing something inert. Repairing the guard from F3 is what makes this enforceable.

### D6 — Present the scope flip rather than hide it

F7 is pi's model, not an artefact to paper over. A resource disabled via re-declaration genuinely is a project-scope settings entry now. The view keeps the row where the user acted on it and indicates that the project has taken ownership of the resource's activation, rather than letting it silently jump sections.

*Alternative considered.* Suppressing the flip in the scanner was rejected: it would put the dashboard back in the business of second-guessing pi's resolution, which is the failure mode this change removes.

## Risks / Trade-offs

**[A delta written without `autoload: false` destroys the package's contribution]** → F5. Silent and total: every skill from that package vanishes, not just the targeted one. *Mitigation:* single writer for package deltas; a test asserting the flag is present; a test asserting sibling resources of the same package remain enabled after a disable.

**[Re-enable leaves a stale directory re-declaration]** → D4. Invisible in activation state; surfaces as resources migrating between UI sections and as project settings accreting entries. *Mitigation:* a round-trip test asserting `.pi/settings.json` returns to its exact prior content after disable-then-enable.

**[Clobbering a project-owned package entry]** → D2's guard. *Mitigation:* a test using this repo's real shape — a project entry with a `+` include filter — asserting it is preserved and merely extended.

**[Scope flip disorients the user]** → F7. *Mitigation:* D6 presentation; documented in `docs/architecture.md`.

**[Team-wide blast radius]** → F8. Accepted deliberately; the UI must state that a folder-scope change is written to the tracked settings file and shared.

**[Untrusted project silently ignores the setting]** → pi's existing behaviour. *Mitigation:* documented; not worked around.

## Migration Plan

No data migration. Inert entries written by the current buggy path are relative patterns that match nothing; once the write path is fixed, the next toggle of that resource replaces them with a correct form. Rollback is reverting the code — the settings entries left behind are valid pi syntax either way.

## Open Questions

- Should the toggle proactively clean inert legacy entries it recognises (a relative pattern in project settings that resolves to no existing file), or leave them for the user? Cleaning is tidier but edits entries the user may have written by hand.
- When a package is declared in **both** global and project settings with different filters, which entry should a project-scope toggle extend? D2 picks the project entry; confirm that matches pi's dedupe precedence in every source type.
- Should the Resources view offer a bulk "reset this folder's activation overrides" action, given that a re-declaration plus exclusions is harder to unpick by hand than a single pattern?
