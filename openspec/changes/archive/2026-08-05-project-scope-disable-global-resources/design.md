## Context

The dashboard deliberately does not re-implement pi's activation semantics: it reads `ResolvedResource.enabled` from `PackageManager.resolve()` and writes through pi's `SettingsManager`. That contract is sound. The bug is that the write path picks the wrong *form* for most resource origins, producing settings entries pi cannot match.

An earlier revision of this design was rejected by two independent adversarial reviews. The findings that survived reconciliation are folded in below and marked; the rejected shapes are recorded under *Superseded* so they are not re-proposed.

### Verified findings

Every statement was established by reading the pinned pi source or by executing probes in a sandboxed `HOME`. None is inferred.

**F1 — four origins, four project-scope forms.**

| origin | form |
|---|---|
| project loose | `skills: ["-skills/foo/SKILL.md"]`, relative to `<proj>/.pi` |
| project `.agents` (cwd or ancestor) | force-exclude relative to that entry's own `.agents` base dir |
| package | `packages: [{ source, autoload: false, skills: ["-skills/foo/SKILL.md"] }]`, relative to the package root |
| global loose | `skills: ["~/.pi/agent/skills/foo/SKILL.md", "!**/.pi/agent/skills/foo/**"]` |

**F2 — the current cross-scope write is inert.** `toggleLoose()` takes `baseDir` from `item.metadata.baseDir` while `persistLoose()` picks the destination from `isProject`. A project-scope toggle of a global skill wrote `{"skills":["-skills/image-to-3d-threejs/SKILL.md"]}` into project settings, left global settings untouched, and pi still reported `enabled=true`.

**F3 — the scope guard is dead code.** The containment check derives `baseDir` from `item.path`, so it cannot fail while `metadata.baseDir` is present.

**F4 — a force-exclude alone never reaches a global resource.** `addAutoDiscoveredResources()` pairs each auto-discovered set with one override array chosen by where the resource lives, and never hands project overrides to a user set. Probe: `-skills/g/SKILL.md`, `-g`, `-<abs>`, `-<abs parent>`, `-**/g/**`, `!g` were all silent no-ops from project settings; the same pattern in global settings worked. `force-exclude only (no redeclare)` → still enabled. The directory must also be re-declared.

**F5 — the package delta requires `autoload: false`, and omitting it is destructive.**

```
baseline (no project entry)             → alpha=ON  beta=ON
project filter WITHOUT autoload:false   → (no skills at all)
project DELTA with autoload:false       → alpha=ON  beta=OFF
project .pi/npm created?                  false
```

`findAutoloadDeltaBase()` engages only when `autoload === false`, and resolves against the *user's* install path. Without it `resolvedScope` stays `"project"`, `getNpmInstallPath()` points at `.pi/npm/`, the path does not exist, and the loop `continue`s — dropping the package's entire contribution.

**F6 — re-declaration works for every global loose location.** Probes across `~/.pi/agent/skills`, `~/.agents/skills`, `~/.pi/agent/extensions`, individually and combined, each disabled exactly the target. No duplicate resource entries.

**F7 — re-declaration flips the reported scope of whatever it covers.** `scope: user` / `source: auto` / `baseDir: <agentDir>` becomes `scope: project` / `source: local` / `baseDir: undefined`. `resolveLocalEntries` supplies metadata without a `baseDir` key at all.

**F8 — `.pi/settings.json` is git-tracked**, so a project-scope disable is shared with collaborators and inherited by every worktree of the branch.

**F9 — the real distribution.** 25 project-loose skills (already working), 32 package-contributed skills, 2 global-loose skills; 16 package-contributed extensions, 0 global-loose extensions.

**F10 — an absolute force-exclude is machine-local; a tilde force-exclude is inert everywhere.** *(review finding V1)* `normalizeExactPattern` only strips `./`, so `~` is never expanded inside a pattern, while `resolvePathFromBase` does expand it for plain path entries. Probes:

```
tilde force-exclude                    → gskill=ON   (inert on the author's own machine)
absolute force-exclude                 → gskill=OFF  (works here)
absolute path from a different $HOME   → gskill=ON   (a collaborator gets nothing)
```

Committing an absolute path into a tracked file therefore satisfies the letter of "team-wide" while delivering nothing to the team.

**F11 — re-declaring the root has directory-wide side effects.** *(review finding V4)* Auto-discovery evaluates only `!`/`+`/`-` entries via `isEnabledByOverrides`; local-entry resolution evaluates the whole array via `applyPatterns`, where plain entries act as *includes*. Once the root is a plain project entry, every file under it is filtered by the project's entire pattern set. Probe with an unrelated `skills/*/SKILL.md` glob present: the untouched sibling `keepme` was **disabled**. Re-declaring only the resource's own file leaves siblings at `ON/user` (F24).

**F12 — a narrow tilde directory plus an anchored glob is portable and precise.** *(resolution of V1 + V4)* Verified identical under two different `$HOME` values:

```
skills: ["~/.pi/agent/skills/gskill", "!**/.pi/agent/skills/gskill/**"]
  → target OFF/project · sibling ON/user · same-named project skill ON/project
```

The bare-name alternative `!gskill` is portable but **also disables a same-named project skill** (verified), because `matchesAnyPattern` matches the basename and the skill's parent-directory name.

**F13 — a force-exclude beats a force-include unconditionally, and equivalent patterns are different strings.** *(review finding V8)* `isEnabledByOverrides` applies excludes, then force-includes, then force-excludes last. `matchesAnyExactPattern` matches four distinct spellings of the same file (relative, absolute, parent-relative, parent-absolute), while `rewriteArray` de-duplicates by raw string equality. A `-skills/foo` left by pi's own `config-selector` therefore survives the dashboard writing `+skills/foo/SKILL.md`, and the re-enable silently does nothing.

**F14 — the dashboard forces project trust on both paths.** *(review finding V5)* `resource-activation-toggle.ts` and `pi-resource-activation.ts` both call `SettingsManager.create(cwd, agentDir, { projectTrusted: true })`. For an untrusted folder the write succeeds, the dashboard's own re-read confirms the resource is disabled, and every real session ignores the file. This is the "reports success for an entry that matches nothing" failure the change exists to remove, and it also means pi's trust gate is *already* bypassed here.

**F15 — pi exposes a public trust API.** `ProjectTrustStore` (`get`/`getEntry`/`set`/`setMany`), `getProjectTrustOptions(cwd, { includeSessionOnly })`, `getProjectTrustParentPath(cwd)`, and `hasTrustRequiringProjectResources(cwd)` are all exported. `getProjectTrustOptions` returns the same labelled options pi's own trust dialog offers, including trusting the parent folder, each carrying the `updates` to persist.

**F16 — a fourth origin exists.** *(review finding V7)* `collectAncestorAgentsSkillDirs` yields skills with `scope: "project"` whose `baseDir` is `<ancestor>/.agents`, not `<proj>/.pi`. A form computed relative to `<proj>/.pi` is inert for them.

**F17 — `projectTrusted: true` is the default, so removing it is a no-op.** *(cycle-2 finding C1)* `settings-manager.js:153`: `const projectTrusted = options.projectTrusted ?? true`. F14's cause was never the flag; it is that **no trust check exists at all**.

**F18 — pi's real trust decision is `resolveProjectTrusted`, not `ProjectTrustStore.get`.** *(C1)* Its order is: explicit override → `hasTrustRequiringProjectResources(cwd)` false means **trusted without consulting the store** → `project_trust` extension event → `trustStore.get(cwd)` when non-`null` → `defaultProjectTrust ?? "ask"` (`always`/`never` decide; `ask` prompts) → no UI means untrusted. Reading the store alone diverges in both directions: it can report untrusted where pi loads unconditionally, and `null` is ambiguous.

**F19 — only two trust symbols are public.** *(C2)* `Object.keys(pi)` filtered on trust yields exactly `["ProjectTrustStore", "hasTrustRequiringProjectResources"]`. The package `exports` map allows only `.` and `./rpc-entry`, so a deep import of `core/trust-manager.js` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` (verified). `getProjectTrustOptions` and `getProjectTrustParentPath` are **not reachable**.

**F20 — an `autoload: false` delta is project-scope only.** *(C3)* `findAutoloadDeltaBase` redirects to the user install only when `scope === "project"`. Appending such an entry at **global** scope produces a second user-scope entry for the same identity, and `dedupePackages` has no branch for two same-scope entries — the delta is silently dropped and the disable is inert. The existing `togglePackage` mutates the entry **in place**, which is correct at global scope and must not be replaced.

**F21 — pi matches packages by normalised identity, not source string.** *(C4)* `getPackageIdentity` reduces npm to `npm:<name>` (version stripped) and git to `git:<host>/<path>` (SSH and HTTPS unified). Matching on the raw string misses a user entry spelled differently for the same package, so the dashboard appends and `dedupePackages` then shadows the user's entry.

**F22 — a relative force-exclude is not scoped to one base directory.** *(C6)* pi evaluates each resource against the project array using **that resource's own** `baseDir`. `-skills/shared/SKILL.md` therefore matches both `<proj>/.pi/skills/shared/SKILL.md` and `<ancestor>/.agents/skills/shared/SKILL.md`.

**F23 — a force-include beats an exclude.** *(C5)* `["!skills/foo/SKILL.md", "+skills/foo/SKILL.md"]` resolves to enabled. Stripping the `+` as part of a "remove everything addressing this file" rule flips a resource the user had deliberately force-included.

**F24 — re-declaring the resource's FILE works for every resource shape.** *(cycle-3 findings #2/N4; cycle-4 probe)* `collectFilesFromPaths` accepts a file as readily as a directory. Verified in one run:

```
redeclare FILE (dir-shaped SKILL.md)  → target OFF/project, siblings ON/user
redeclare FILE (flat .md skill)       → target OFF/project, sibling flat skill ON/user
prompt  (always a flat file)          → OFF/project
theme   (always a flat file)          → OFF/project
```

This removes the file-versus-directory distinction entirely. A bare `.md` skill directly under the skills root, and **every** prompt and theme, are flat files whose "own directory" is the shared root — re-declaring which would reproduce the F11 collateral. Re-declaring the file does not.

**F25 — a stray `+` did not defeat the anchored `!` in practice.** *(cycle-3 finding #4)* With `+flatskill.md` present alongside the anchored exclusion, the resource stayed disabled. `matchesAnyExactPattern` compares the force-include against the path relative to `<proj>/.pi`, the absolute path, and the parent forms; a bare name matches none of them for a global resource. A force-include therefore only bites when spelled as the absolute path — possible, but not a spelling any current writer produces. Downgraded from blocking to a documented residual risk.

**F26 — writing `.pi/settings.json` is what makes a folder trust-requiring.** *(cycle-3 findings #1/N1)* `TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES` begins with `"settings.json"`. A folder with no `.pi` is trusted implicitly; the first toggle creates the file and the folder becomes trust-requiring, so the *next* session finds no recorded decision, falls to `defaultProjectTrust`, and — headless or on decline — loads untrusted and ignores the file just written. Checking trust before the write cannot see this, because the write is what changes the predicate.

**F27 — pi's settings write is not JSONC-preserving.** *(cycle-3 finding #8)* `persistScopedSettings` does `JSON.parse(current)` → `JSON.stringify(mergedSettings, null, 2)`: a whole-file rewrite that discards comments and reformats. Worse, a settings file containing comments fails to parse, the error is retained as `projectSettingsLoadError`, and `saveProjectSettings` then returns without writing — while the toggle reports success. The claim that the write is JSONC-preserving appears in this repo's own `resource-activation-toggle.ts` header and propagated unexamined into three revisions of this design; it is false and is corrected here and in the repo.

### Superseded

Recorded so the dead ends are not re-explored:

- **No native mechanism exists.** False — it exists for all four origins (F1). The earlier conclusion generalised from testing only the auto-discovery path.
- **Dashboard-side enforcement.** A `before_agent_start` splice of the live `systemPromptOptions.skills` array works, and a `--no-extensions` + explicit `-e` spawn allowlist works, but both are unnecessary once the writes are correct, and both would diverge from pi's own view of activation.
- **A dashboard-private `-<name>` notation.** Unnecessary, and it would have required a read-side overlay.
- **Re-declaring the global skills *root* with an absolute force-exclude.** Rejected by F10 (not portable) and F11 (sibling collateral).
- **Provenance tracking for directory-entry cleanup.** The earlier design needed to know whether it had authored a shared root entry, which is unpersistable. F12's per-resource entry is 1:1 with its exclude, so the pair is self-identifying and no provenance is needed.

## Goals / Non-Goals

**Goals:**
- Write the correct pi-standard form for each of the four resource origins, so pi enforces the result.
- Keep every written entry portable across machines, since the file is shared.
- Confine each write's effect to the resource the user acted on.
- Round-trip exactly: disable-then-enable leaves no residue that changes how other resources resolve.
- Route an untrusted folder to a trust decision instead of a false success.

**Non-Goals:**
- Changing pi.
- Any dashboard-side enforcement mechanism.
- Uninstalling packages, removing files, or altering `/skill:name` registration.
- A machine-local (untracked) disable scope.

## Decisions

### D1 — Classify by longest-prefix path match, not by reported metadata or candidate order

*(resolves review finding V2)* Disabling a global-loose resource mutates the very fields a metadata-based classifier would key on: `scope` flips to `project`, `source` to `local`, `baseDir` disappears (F7). A classifier reading `metadata.origin` + `metadata.baseDir` therefore cannot recognise, on re-enable, the resource it itself re-declared — the disable would be a one-way door.

Classification is instead by the resolved absolute path against the candidate base directories, selecting the **longest matching prefix** rather than the first in a fixed order. *(cycle-2 finding C8)* An ordered scan breaks when `cwd` is `$HOME`, because `<cwd>/.pi` is then a strict ancestor of the global base `~/.pi/agent`, and a global skill would be misclassified as project-loose and given an inert relative write. Longest-prefix is order-independent and handles nesting correctly.

Path is stable across the operation; metadata is not.

### D2 — Package resources: always an `autoload: false` delta, never a plain filter

F5 makes this a correctness requirement **at project scope**. The writer creates `{ source, autoload: false, <type>: ["-<relative to package root>"] }` when the project has no entry for that package, and augments the existing delta when it does.

**Global scope keeps the existing in-place mutation.** *(cycle-2 finding C3, F20)* At global scope the delta form is not merely unnecessary, it is inert: a second user-scope entry for the same identity is dropped by `dedupePackages`, so the disable silently does nothing. The current `togglePackage` — which converts the string entry to object form in place and adds a plain filter — is correct there and is preserved unchanged. The delta form is a **project-scope-only** branch.

**Entries are matched by normalised identity, not source string.** *(cycle-2 finding C4, F21)* The lookup reduces the source the way `getPackageIdentity` does — npm to name without version, git to host/path across SSH and HTTPS, local to its resolved path — so a user entry spelled differently for the same package is found and extended rather than shadowed by an appended duplicate.

**Guard:** if the project already has a *non-delta* entry for that package — a package the project genuinely declares, such as this repo's `{ source: "<repo>", extensions: ["+packages/kb-extension/src/index.ts"] }` — the exclusion is added to that entry using ordinary filter semantics and it does **not** gain `autoload: false`. Converting it would re-point resolution at a user install that may not exist.

### D3 — Global loose resources: re-declare the resource's FILE + anchored glob exclude

*(resolves review findings V1 and V4; corrected by cycle-3 findings #2/N4 via F24)* The pair is:

```json
{ "skills": ["~/.pi/agent/skills/foo/SKILL.md", "!**/.pi/agent/skills/foo/**"] }
```

- **The file, not a directory** — F24. An earlier revision re-declared the resource's own directory, which is undefined for flat-file resources: a bare `.md` skill, and every prompt and every theme, have the shared root as their directory. Re-declaring the file is uniform across all shapes and is the narrowest possible unit.
- **Narrow, not the root** — F11. Only the toggled resource enters project-scope resolution; siblings keep their user scope and are untouched by unrelated patterns in the array.
- **Tilde for the path entry** — expanded by `resolvePathFromBase`, so it resolves per-machine.
- **Anchored glob for the exclusion** — F10 rules out both the absolute form (machine-local) and the tilde form (inert). The glob matches the absolute path via `matchesAnyPattern` without naming a home directory, and being path-anchored it does not collide with a same-named project skill the way a bare name does (F12).

The exclusion uses `!` rather than `-` because `!` is evaluated by `matchesAnyPattern`, which supports globs; `-` is evaluated by `matchesAnyExactPattern`, which does not.

**The anchor is derived, not hardcoded.** *(cycle-2 finding C9)* The glob's anchor is computed at write time as the resolved agent directory relative to the home directory, so a non-default agent directory produces a correct anchor instead of an inert one. When the agent directory is **not** under the home directory no portable form exists at all — neither the `~` path entry nor a home-relative anchor — and the toggle surfaces that rather than writing something that silently works only on one machine.

*Cost, accepted:* the form still assumes the agent directory sits under the home directory. Mitigated by deriving the anchor, by surfacing the unsupported layout, by a `bump-pi-version` checklist line, and by tests that assert observed activation rather than pattern text.

### D9 — Fall back to the anchored form when a relative pattern is ambiguous

*(resolves cycle-2 finding C6, F22; the escalation target is defined here per cycle-3 findings #6/N5)* pi matches a relative pattern against every resource using that resource's own base directory, so `-skills/shared/SKILL.md` disables a `.pi` skill and a same-named `.agents` skill together.

The writer therefore checks pi's resolved set before writing a relative pattern: if another resource of the same type would produce the identical string relative to its own base directory, an anchored-glob exclusion is written instead. The anchor is the resource's base-directory **leaf plus its path within that base** — `!**/.pi/skills/shared/**` for a `<cwd>/.pi` resource, `!**/.agents/skills/shared/**` for a `.agents` one. These are home- and checkout-independent, so they remain portable for a collaborator, and they are distinct from each other, which is the whole point.

No directory re-declaration is involved: these resources are already in project-scope resolution. Only the exclusion spelling changes. The common case keeps pi's familiar relative spelling; only genuinely ambiguous names escalate.

### D4 — Re-enable removes the exclusion and writes nothing

*(resolves review finding V6)* The two earlier specs contradicted each other, and the behaviour they disagreed about is itself wrong: writing `+` never round-trips, and because `stripPrefix` strips `!` as well, a user's hand-written `!` exclude would be replaced by a force-include that inverts their intent.

Re-enable therefore strips the entry and adds nothing. For the global-loose form it removes both halves of the pair, which is unambiguous for entries the dashboard itself wrote. A plain entry a *user* hand-authored is indistinguishable from one the dashboard wrote by inspection alone, so ownership is tracked explicitly — see D10. For a package delta it removes the entry entirely once its last exclusion goes.

This changes existing same-scope behaviour deliberately.

### D5 — The scope guard is directional, not containment-based

*(resolves review finding V2, second horn)* A containment guard — "the resource must live under the scope's base directory" — would reject the global-loose write at the front door, since that resource lives outside `<proj>/.pi` by definition. The guard instead rejects the one direction that has no pi form: a **global-scope** toggle of a project-local resource, which would require the machine-wide settings file to reach into one checkout.

### D6 — Strip force-excludes as an equivalence class

*(resolves review finding V8)* Before writing, the writer removes every existing **exclusion** that addresses the same file under pi's own matching rules — relative, absolute, parent-relative and parent-absolute spellings, plus the anchored-glob form this design writes — rather than de-duplicating by raw string. Without this, a stale entry from pi's `config-selector` survives and silently defeats the toggle, because force-exclude is applied last and unconditionally.

**Only `-` and `!` entries are stripped; `+` entries are never touched.** *(cycle-2 finding C5, F23)* A force-include beats an exclude, so a user holding both `!foo` and `+foo` has that resource deliberately enabled. Removing the `+` as part of a blanket "everything addressing this file" strip would flip it off on a disable-then-enable round trip — the exact class of silent user-intent corruption this change exists to remove.

**The strip is by exact spelling, never by evaluating a user's glob.** *(cycle-3 finding N2)* An earlier wording — "every exclusion that addresses the same file under pi's matching rules" — would, taken literally, match a user's broad `!skills/**` against the toggled file and delete it, **enabling every sibling** they had excluded. The strip therefore removes only the enumerated exact spellings of this resource (relative, absolute, parent-relative, parent-absolute) plus the exact anchored-glob string this design itself writes. A user's glob is never evaluated and never removed, even when it happens to cover the resource.

*Residual, accepted:* a stale exclusion the user wrote as a glob still wins over an enable. That is the user's own instruction, and honouring it is correct.

### D7 — An untrusted folder prompts for trust, using pi's own options

*(resolves review finding V5; corrected by cycle-2 findings C1 and C2)*

**Removing the `projectTrusted: true` argument is not the fix** — F17 shows the option defaults to `true`, so omitting it changes nothing. The fix is to add a trust check that does not exist today.

**Trust is recorded at write time, not merely read.** *(cycle-3 findings #1/N1, F26)* An earlier revision replicated pi's read-side order, including its first step: a folder with no trust-requiring resources is trusted without prompting. That step is correct for pi and **self-defeating here**, because the toggle's own write creates `.pi/settings.json` and thereby makes the folder trust-requiring. The write would succeed against an implicitly-trusted folder, and the next session — now facing a trust-requiring folder with no recorded decision — would fall to `defaultProjectTrust` and, headless or on decline, ignore the file just written.

The gate therefore ensures an **explicit recorded decision exists after the write**:

1. `ProjectTrustStore.get(cwd)` is non-`null` → that decision stands. `false` → refuse with an explanation; `true` → proceed.
2. `null` → consult `defaultProjectTrust ?? "ask"`. `always` → proceed **without recording**. `never` → refuse without prompting; it is already a standing decision. `ask` → prompt, then record the choice.

**`always` deliberately does not record.** *(cycle-4 finding T3)* Recording would make the disable survive a later tightening of the default, but it would also grant a durable trust record — and therefore untrusted extension loading — in every folder the user merely toggled, persisting after they set the default back to `ask`. A user who chose `always` chose it to avoid prompts, not to enrol folders permanently. Security is preferred over durability here, consistent with the change's `security-hardening` discipline. The cost is disclosed: if the default is later tightened, previously written disables stop applying until the folder is trusted explicitly.

`hasTrustRequiringProjectResources(cwd)` is still consulted, but only to **explain** the prompt: when it is currently false, the dialog says the folder is trusted implicitly today and that saving this setting will require an explicit decision from now on. It is never used to skip recording.

Consequence, accepted: the first-ever toggle in a fresh folder prompts once, where pi would not have. That is the honest cost of writing a file that changes the folder's trust status, and it is strictly better than a success that silently will not hold.

**The dialog's options are dashboard-authored** (F19). `getProjectTrustOptions` and `getProjectTrustParentPath` are not exported and are unreachable through the package's `exports` map, so mirroring pi's exact option list is not possible without a deep import that throws. The dashboard offers the equivalent choices — trust this folder, trust its parent folder, do not trust — and persists the result through the two symbols that **are** public: `ProjectTrustStore.set` / `setMany`. Session-only options are not offered, because the artefact being written is persistent and would outlive its own permission.

Trust is resolved **before** any write, and the decision is persisted **with** it.

*Known limitation (cycle-3 finding N6):* the write primitive itself still constructs the settings manager as trusted, because an untrusted manager loads `{}` and refuses to flush. The gate is therefore a front-gate, not a property of the primitive; any future code path that reaches the writer without passing through it reinstates the original bypass. A single choke point for the write is required, and the tests assert it.

Ordering matters: trust is resolved **before** the write. Writing first would create trust-requiring project resources in a folder that has not been trusted, changing `hasTrustRequiringProjectResources(cwd)` as a side effect of an operation that was supposed to be gated by it.

### D10 — Track entry ownership outside the settings file

*(resolves cycle-3 finding N3 / cycle-4 T-series)* Re-enable must remove the file re-declaration it added, and must not remove one the user hand-authored. Those entries are byte-identical, so ownership has to be recorded somewhere.

**Not inside `.pi/settings.json`.** The repo's existing ownership precedent, `_dashboardManagedPackages`, is written by a direct `fs` read/modify/write, because pi's `SettingsManager` exposes typed setters only and has no writer for an unknown key. Putting the record in the settings file would therefore mean two non-atomic writers on one file per toggle — a desync whenever one succeeds and the other fails — and would also put dashboard-private notation into a git-tracked file this design promises to keep pi-standard.

**In the dashboard's own store instead**, alongside the existing `~/.pi/dashboard/worktree-init-trust.json`: a map from project path to the entry strings this dashboard added, per resource type. On re-enable the plain entry is removed only if it appears there, and the record is cleared with it.

This keeps `<proj>/.pi/settings.json` purely pi-standard, keeps each toggle to a single settings write, and correctly makes ownership a **machine-local** fact — whether *this* dashboard added an entry is not something to share with the team.

*Consequence, accepted:* a collaborator's dashboard has no ownership record for entries written on another machine, so its re-enable strips the exclusion and leaves the plain entry behind. That is the conservative direction — residue rather than destruction — and the residue is inert, because a plain entry alone changes only the resource's reported scope, not its activation.

### D8 — Present the scope flip rather than hide it

A resource disabled via re-declaration genuinely is a project-scope settings entry. With the narrow form this affects exactly one row. The view keeps that row where the user acted and indicates the project has taken over its activation.

## Risks / Trade-offs

**[A delta written without `autoload: false` destroys the package's contribution]** → F5, silent and total. *Mitigation:* single writer; a test asserting the flag; a test asserting siblings of the same package stay enabled.

**[The anchored glob encodes pi's directory layout]** → D3. *Mitigation:* tests assert observed activation, not pattern text, so a layout change fails loudly; `bump-pi-version` checklist line.

**[Re-enable leaves a stale file entry]** → D4. *Mitigation:* round-trip test per origin asserting behavioural equivalence.

**[Clobbering a project-owned package entry]** → D2's guard. *Mitigation:* a test using this repo's real shape.

**[Round-trip cannot restore byte-identical content]** → the JSONC setters leave `"skills": []` where the key was previously absent. Behaviourally equivalent, but the file is tracked, so the residue appears as a diff for collaborators. *Mitigation:* the requirement is stated as behavioural equivalence, and the writer removes an emptied array key where the setter allows.

**[Trust prompt appears where users do not expect one]** → D7 introduces a dialog into a toggle interaction. *Mitigation:* step 1 of the check suppresses it entirely for folders pi would load unconditionally, so it fires only where a real session would also have asked.

**[The trust dialog diverges from pi's own]** → F19 makes pi's option list unreachable, so the wording is ours. *Mitigation:* offer the same choices pi does and persist through pi's store, so the recorded decision is indistinguishable from one pi wrote. Revisit if pi exports the helper.

**[Writing settings makes a folder trust-requiring]** → a folder with no `.pi` is trusted by step 1; the first toggle creates `.pi/settings.json` and the *next* session will ask. *Mitigation:* documented, and the toggle surfaces that the folder will require a trust decision from now on.

**[Concurrent *external* edits to the same array are lost]** → pi's `persistScopedSettings` re-reads on disk inside its lock but replaces each modified field wholesale from the snapshot its `SettingsManager` took at construction. Dashboard-internal concurrency is safe, because each toggle constructs its manager and completes its flush inside the per-settings-file write lock, so every toggle observes the previous one's write (pinned as a requirement). The exposure is limited to *other processes* — pi's `config-selector` or a hand edit landing between one toggle's construction and its flush. *Mitigation:* accepted — narrowing it means reaching inside pi's storage layer. The window is small and the loss is one array, recoverable from git since the file is tracked.

**[The settings write is not JSONC-preserving]** → F27. Every toggle reformats the whole tracked file and discards comments, so a collaborator sees a whole-file diff rather than a one-line one. Worse, a settings file containing comments fails to parse and the write is silently skipped while the API reports success. *Mitigation:* detect a settings load error before writing and fail loudly rather than reporting success; correct the false JSONC claim in `resource-activation-toggle.ts` and `docs/architecture.md`.

**[The dashboard must reimplement unexported pi internals]** → cycle-3 finding N3. `matchesAnyExactPattern`, `getPackageIdentity` and `collectAncestorAgentsSkillDirs` are not exported, yet D2's identity match, D6's spelling strip and D9's ambiguity check depend on their semantics. *Mitigation:* keep each reimplementation to the narrowest possible surface (exact spellings only, not glob evaluation — see D6), assert observed activation rather than pattern text in tests so a semantic drift fails loudly, and extend the `bump-pi-version` checklist to cover matching and identity semantics, not just directory layout.

**[A force-include spelled as an absolute path could defeat an anchored exclusion]** → F25. Not reproduced with any spelling a current writer produces. *Mitigation:* documented; the equivalence-class strip covers the dashboard's own spellings.

**[Team-wide blast radius]** → F8. Accepted deliberately; the UI states it.

**[FORM 2's exception drops the user's global entry]** → `dedupePackages` keeps both entries only when the project entry is a delta. Harmless for local-path sources; stated as a limitation.

**[Only newly-started sessions are affected]** → `resolve()` runs at session start. The claim is qualified accordingly.

## Migration Plan

No data migration. Inert entries written by the current buggy path are relative patterns matching nothing; D6's equivalence-class strip removes them the next time that resource is toggled. Rollback is reverting the code; entries left behind are valid pi syntax either way.

## Open Questions

- Does the ownership store need to survive a dashboard reinstall, or is losing it acceptable given the failure mode is inert residue?

- Should the toggle proactively clean inert legacy entries it recognises, or only those for the resource being toggled? D6 does the latter.
- When a package is declared in both global and project settings with different filters, which entry should be extended? D2 picks the project entry; confirm against `getPackageIdentity` normalisation for `npm:`, `git:` and local sources.
- Should the Resources view offer a bulk "reset this folder's activation overrides" action?
- Does `hasTrustRequiringProjectResources(cwd)` need to be consulted before offering the toggle at all, so a folder with no `.pi` yet is not pushed into a trust prompt by a single toggle?
