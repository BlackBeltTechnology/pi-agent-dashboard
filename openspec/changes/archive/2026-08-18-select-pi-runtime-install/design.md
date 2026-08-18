## Context

`pi` resolves from several independent locations that can each hold a different version. Today the choice is made entirely by the fixed strategy chain in `packages/shared/src/tool-registry/definitions.ts` → `piExecutorDef`:

```
unix:  override → bare-import(bundle) → managed-bin → where(PATH)
win32: override → bare-import → managed-module → npm-global → managed-bin → where
```

Three facts from the current code shape this design.

**1. There are two pi consumers, registered as two tools.** `piExecutorDef` registers `pi` (`kind: "executor"`) — the process sessions spawn. Separately, `registerDefaultTools` registers `pi-coding-agent` (`kind: "module"`, `definitions.ts` ~line 786) — the library the server *imports*; `package-manager-wrapper.ts` loads `DefaultPackageManager` from it for package installs, model lists and skill discovery. Overriding one and not the other splits the runtime in half, and nothing surfaces that today.

**2. The version-reading half already exists, in the wrong place.** `packages/extension/.pi/skills/doctor/_lib/checks.ts` exports `enumeratePiInstalls(locations)`, `piVersionDivergence(installs)` and `readPiFloor(serverPkgJsonPath)`. They are pure and filesystem-only — they read `<dir>/package.json` and never spawn `pi --version`. But they live in a skill directory the server has no business importing from, and they only *read* caller-supplied dirs; nothing discovers the candidate set.

**3. Overrides are currently unvalidated.** `PUT /api/tools/:name` (`packages/server/src/routes/tool-routes.ts`) accepts any non-empty string and calls `registry.setOverride` directly. `overrideStrategy` (`strategies.ts:257`) checks only `exists(p)`. So an override pointing at any executable on disk is accepted and subsequently spawned as pi on every session start.

**4. An override must be a FILE, and not every spawn path consults the registry.** Every strategy returns a file: `bareImportStrategy` resolves through `createRequire`, `managedModuleStrategy`/`npmGlobalStrategy` join an explicit entry (`dist/index.js`), `resolveModule` (`registry.ts:261`) imports `resolution.path` directly, and `resolveJsScript` (`definitions.ts:449`) accepts a `.js` path or a symlink to one and otherwise hands the raw path to `spawn`. A **directory** is not a legal override value for any tool — it produces `EACCES` on the spawn side and `ERR_UNSUPPORTED_DIR_IMPORT` on the import side. Separately, `buildTmuxCommand` (`process-manager.ts:248`) emits the literal string `cd <cwd> && pi`, so tmux sessions resolve pi from the shell's `PATH` and never consult the registry at all — and `selectMechanism` (`spawn-mechanism.ts:55`) makes tmux the default on macOS and Linux.

Comparison helpers already exist server-side: `parseVersion` / `compareVersions` / `isBelow` in `packages/server/src/pi/pi-version-skew.ts`. The floor lives in `packages/server/package.json` → `piCompatibility` (`minimum: "0.78.0"`, `recommended: "0.84.1"`).

## Goals / Non-Goals

**Goals:**

- Make the active pi install visible, per consumer, without reading logs or running the doctor.
- Let a user pick a discovered install from a list instead of typing an absolute path.
- Make a spawn/import mismatch impossible to create by accident, and impossible to miss once it exists.
- Refuse to select an install below the compatibility floor, and say why.
- Close the unvalidated-override hole that this feature would otherwise widen.
- Have exactly one implementation of pi-install enumeration, shared by the doctor skill and the server.
- Make the selection actually take effect on the default interactive spawn path (tmux), not just headless and Windows Terminal.

**Non-Goals:**

- Installing or updating pi at a chosen location — that stays in the existing Packages section.
- Per-project or per-session runtime selection. This is one global setting.
- Choosing the Node runtime that executes pi.
- Replacing the Tools section or its free-text override inputs.
- Any change to the strategy chain's ordering or behaviour when no override is set.

## Decisions

### D1. Promote the doctor's helpers into `packages/shared/`, don't duplicate them

`enumeratePiInstalls`, `piVersionDivergence` and `readPiFloor` move into a shared module; the doctor skill's `_lib/checks.ts` re-exports from there.

**Why:** two copies of "what version is pi" will drift, and the drift is invisible until a support case where the doctor and the UI disagree. The functions are pure and dependency-free, so the move is mechanical.

**Alternative rejected:** have the server import from `packages/extension/.pi/skills/doctor/_lib/`. A skill directory is a prompt-and-script payload, not a published module surface; nothing guarantees its shape across versions, and it is not in the server's dependency graph.

### D2. Candidate enumeration mirrors the strategy chain, and is derived not hardcoded

The new enumerator produces candidates from the same locations the chain walks: the `bare-import` anchor (the packaged Electron app bundle in production, the repo root in a dev checkout), the managed install at `<MANAGED_DIR>/node_modules/@earendil-works/pi-coding-agent` (**not** `<MANAGED_DIR>/package.json` — `MANAGED_DIR` is `~/.pi-dashboard`, which has no pi `package.json` of its own), npm-global / `PATH`, and the repo-root `node_modules` in a dev checkout, plus the currently-active override when it points somewhere not otherwise listed. Both package aliases (`@earendil-works/...`, `@mariozechner/...`) are probed at each location, upstream first, matching the chain's alias order.

**Why:** if the picker offered a location the chain cannot reach, selecting it would produce a pin that silently resolves elsewhere. Deriving from the same inputs keeps "what you can pick" and "what can be resolved" the same set.

**Trade-off:** the enumerator and the chain are separate code paths that must be kept aligned. The drift test asserts the *usable* property — see D2a — not merely that resolution returns ok.

### D2a. Each candidate carries per-consumer ENTRY paths; the drift test must be non-vacuous

A candidate is `{ key, label, pkgDir, spawnEntry, moduleEntry, version, meetsFloor }`. The picker writes `spawnEntry` to the `pi` override and `moduleEntry` to the `pi-coding-agent` override.

**Why:** per Context fact 4, a directory is illegal for both consumers. `enumeratePiInstalls` returns the package *directory*, so the promoted helper is the wrong shape to write directly — the enumerator must derive entries from it.

**Why not teach the resolver to accept a directory (alternative rejected):** it would change `overrideStrategy` for **every** registered tool (`openspec`, `npm`, `node`, `git`, `zrok`…), make override values polymorphic in a way no other strategy is, and touch the shared resolution core that this change's non-goals say stays untouched. It also has no clean answer for a bare binary such as `/usr/local/bin/pi` that has no adjacent package directory.

**Non-vacuous drift test.** `overrideStrategy` only checks `exists(p)`, so "the candidate resolves when set as an override" is true for any path on disk and proves nothing. The test therefore asserts the *usable* outcome: for each candidate, setting `spawnEntry` yields an argv whose script is a real `.js` entry or an executable file, and setting `moduleEntry` yields a path that actually imports. A directory candidate must FAIL this test.

### D3. Version probing is filesystem reads, never a `pi --version` spawn — but enumeration is not spawn-free

Every candidate's version comes from its `package.json`.

**Why:** `enumeratePiInstalls` already works this way; a spawn per candidate would cost ~100–300ms × 5 on a settings-panel open, and would execute a binary purely to render a list — precisely the thing D6 is trying to gate.

**Honest scope of the claim.** *Version probing* is filesystem-only. *Locating* some candidates is not: the npm-global prefix comes from `npm root -g` (`platform/npm.ts` `rootGlobal()`, a subprocess) and a `PATH` lookup can fall back to a login shell (`binary-lookup.ts`). The registry's cache does **not** cover this — it holds one *winning* `Resolution` per tool, not the per-location intermediates enumeration needs. This change therefore adds its own enumeration cache, invalidated by the same `rescan()` that invalidates the registry, so the subprocess cost is paid on first enumeration and on explicit rescan rather than on every Settings open. Describing this as reuse of an existing cache would have been false. The invariant that holds literally and in tests is: **no `pi --version` is ever spawned.**

**Consequence:** the reported version is what the package declares, not what the binary reports. A hand-tampered install could disagree. Accepted: the floor check is a compatibility guard, not a security boundary.

### D4. Two consumers, one candidate list, linked by default

The UI renders one candidate list with two selection columns (*Spawn* / *Import*), plus a "Keep both in sync" checkbox that is **checked by default**. While linked, one click sets both. Unchecking is the deliberate act that permits divergence.

**Why:** the user's requirement is that a deliberate mismatch is *possible*. The default must still be one decision, because the mismatch is a specialist configuration. Making "unlink" the gate means divergence is always chosen, never stumbled into.

**Alternative rejected:** two stacked copies of the candidate list, one per consumer. Same capability, but it doubles the scroll length and pushes the two selections across a scroll boundary — which hides exactly the state the user most needs to see. The matrix makes a mismatch a single glance: two dots on different rows.

**Alternative rejected:** forbid divergence entirely and always write both. Simpler and safer, but overruled — see D5.

### D5. Divergence is supported, and therefore must be observable everywhere — over ONE defined input set

Because divergence is permitted, it is surfaced in three places, not one: a persistent banner in the section, a restatement in the apply-confirmation dialog, and machine-readable fields in `/api/health` plus the doctor's `pi-resolution` output.

**The three surfaces must compute divergence over the same input set AND the same axis.** The promoted `piVersionDivergence` helper flags ">1 distinct version across all enumerated installs", which is a *different question* — under it, a user with one unused old install in a workspace would see divergence reported by the doctor while the picker shows none. Consumer divergence and install-set divergence are named separately and never conflated; `/api/health` and the picker report the former, the doctor reports both and labels which is which.

**Consumer divergence is defined on the realpath'd package directory, not on the version** — the same axis D7a uses for the sync checkbox. Defining sync on package directory and divergence on version would leave a gap: two *different installs that happen to hold the same version* would render the checkbox unchecked while every divergence surface reported agreement, so the spec scenario "mismatch created outside the picker is detected" would fail for that class. One axis, one answer. The reported *message* still names both versions, because that is what a human needs; the *predicate* is directory inequality.

**Why:** permitting a mismatch means "what pi version is this dashboard on" stops having a single answer. Every future bug report needs the pair. If the pair is only visible in a UI banner, support cases will keep arriving with one version string and we will keep guessing.

**Risk accepted:** this is the least reversible decision in the change. Once shipped, the mismatch is a supported configuration whose failure modes we own permanently. It is flagged for `doubt-driven-review` in the proposal, to be run before the UI ships the capability.

### D6. Validate override paths at the write boundary, and fix the existing hole

A new shared validator runs before any runtime override is persisted: the path must exist, resolve through symlinks to a real location, and yield a readable pi `package.json` version. `PUT /api/tools/pi` and `PUT /api/tools/pi-coding-agent` adopt it; picker-driven writes go through the same route.

**Why:** the picker is a new, discoverable, network-reachable path to setting a value that becomes an executed binary. The existing route accepts any string with no validation at all, so this change would widen a hole that is already open. Fixing it at the route is the narrowest place that covers both the picker and the existing free-text inputs.

**Trade-off:** this tightens an existing endpoint. A user with an exotic wrapper-script override that has no adjacent `package.json` would now be rejected. Mitigated by validating on the *resolved package directory*, and by the error naming exactly which check failed.

**The package-directory walk does not always succeed, and the validator must not require it to.** A Windows `.cmd` shim on `PATH` is a plain file with no adjacent pi `package.json`; realpath does not lead anywhere useful. Validation therefore accepts **either** a resolvable pi package directory **or** an executable file, and only the former yields a version. The consequence is stated rather than hidden: such an install is displayed as the active resolution with an unknown version, is **not** floor-gated (no version to compare), and remains selectable. Requiring a readable version would make a legitimate Windows install permanently unpinnable; spawning it to ask its version would break the no-spawn invariant. Unknown-version candidates are labelled as such in the UI.

**Explicitly not claimed:** this is not a sandbox. A user who can reach the settings API can already spawn sessions. The validator prevents fat-finger and drive-by misconfiguration, not a determined operator.

### D7. One atomic write for both consumers; "Automatic" clears in the same transaction

Applying issues a single `POST /api/pi/runtime` carrying both selections. The route persists both overrides in one override-store transaction; `Automatic` for a consumer clears that consumer's entry within the same transaction. No new persistence format, no new config field — it still writes only `~/.pi/dashboard/tool-overrides.json`.

**Why one call instead of two PUTs:** two sequential `PUT`s can fail between them, leaving spawn written and import not — which produces exactly the mismatch the spec's "Divergence cannot be created while linked" scenario forbids. An invariant that a crash can break is not an invariant. One request, one transaction, one failure domain.

**This requires a new store primitive — the existing one is not sufficient.** `OverridesStore.set()` and `.clear()` each mutate the in-memory cache and then run their own `persist()` (tmp+rename). The existing atomicity is **per single write**, not across a pair; two calls are two writes with a crash window between them, and the cache is mutated before the write succeeds. This change therefore adds a multi-key `setMany(changes)` that applies every key to a copy, persists once, and only then swaps the cache — so a failed persist leaves both the file and the cache untouched. Claiming the pair was already atomic because tmp+rename exists would have been false.

**Bypassing `setOverride` means the registry cache must be invalidated explicitly.** `registry.resolve()` serves a cached `Resolution`; today only `setOverride`/`clearOverride`/`rescan` invalidate it. A `setMany` that writes the store directly would leave the registry serving the *previous* argv, so the very next spawn would use the old binary — silently failing the "sessions started afterwards use the new binary" scenario while the UI showed the new selection. The route therefore rescans both `pi` and `pi-coding-agent` after a successful persist, inside the same request, and a test asserts the post-write resolution reflects the new selection.

**Why still the tool-override store:** it is already the single source of truth for tool overrides, already read-through/write-through cached, and already atomic per write. A parallel store for "the pi choice" would create two places to disagree — the class of bug this change exists to fix.

**Consequence:** the Tools section's free-text `pi` input and the picker edit the same state. That is intended; the picker's Advanced disclosure names the file so the relationship is visible.

### D7a. The sync state is DERIVED, never persisted

"Keep both in sync" renders checked exactly when both consumers resolve to the same **package directory**, compared after realpath. It is not stored anywhere.

**The comparison is on package directory, NOT on entry path.** The two consumers resolve to *different files by design* — `dist/cli.js` for the executor, `dist/index.js` for the module. Comparing entries would render sync unchecked permanently, including in the default no-override state, contradicting the "enabled by default" scenario. The package directory is the only value that is equal exactly when the two consumers come from the same install. Realpath first, so a symlinked and a direct path to the same install compare equal.

**Why derived at all:** the change's own invariant forbids a new persistence format, so there is nowhere legitimate to put a checkbox flag. More importantly, a stored flag can disagree with reality — the upgrade case (a pre-existing `pi`-only override) would open "checked" while actually diverged, and one click would then silently clobber the user's existing pin. Deriving the state makes that unrepresentable: a diverged pair always opens unchecked.

**"Enabled by default" is a consequence, not an assumption.** With no overrides the two chains are *not* guaranteed to land on the same install — the executor chain ends at `where("pi")` while the module chain ends at `npm root -g`, and on Windows the executor carries extra tails. Where those disagree, a fresh install legitimately opens **unchecked and diverged**, having never been configured. That is correct behaviour and the UI must not pretend otherwise: the section reports it as divergence with a one-click re-link, exactly as it would for a user-created mismatch. The spec's "enabled by default" scenario is therefore scoped to the case where both chains resolve to the same install — the common case, not a guarantee.

### D8. Apply semantics are asymmetric, and the UI says so

A spawn change affects newly started sessions only; running sessions keep the binary they were spawned with, and the section counts how many are still on the previous version. An import change requires a server restart, offered on apply via the existing `/api/restart`.

**Why:** this is a property of the system, not a choice — `process-manager` resolves `pi` at spawn time, and the imported module is bound for the server process's lifetime. Hiding the asymmetry would produce "I changed it and nothing happened" reports for the import side and "it changed under me" surprise for the spawn side.

### D9. tmux invocation converts to argv form and carries the resolved pi argv

`buildTmuxCommand` stops returning a shell string. It returns an **argv array**, and `spawnTmux` invokes it without a shell. The pi invocation embedded in the tmux command is the registry-resolved **argv** (`[node, cli.js, …flags]`), not a bare path.

**Why the feature needs it:** `selectMechanism` returns `tmux` for interactive sessions on macOS and Linux whenever tmux is available; those sessions currently run whatever `pi` the shell's `PATH` finds. A picker that leaves the default interactive path untouched would not merely be incomplete — it would be *wrong on screen*, because the divergence banner, the running-session count and "new sessions use it immediately" would all describe a selection those sessions ignore.

**Two shells exist here, and only one of them goes away.** The current builder embeds the pi command inside a **double-quoted** segment: `` tmux new-window … "${piCmd}" ``, handed to `execSync` (a shell). `shellEscape` produces single quotes, which are inert inside that double-quoted context — `$(…)`, backticks and `$VAR` still expand. An earlier draft claimed a `shellEscape`d path would make metacharacters safe there; false, and recorded so it is not re-proposed.

But the opposite overcorrection is also false. **tmux runs the pane command through a shell of its own**: the `shell-command` argument to `new-session`/`new-window` is executed via the default shell, so the pi invocation inside it is a shell string no matter how the dashboard invokes the tmux CLI. The design is therefore *both*, at two distinct layers:

1. **The tmux CLI invocation becomes argv** — no dashboard-side shell, so the workspace path travels as a literal `-c <cwd>` argv element. The redundant `cd <cwd> &&` prefix is dropped entirely, which is what actually closes the pre-existing cwd injection.
2. **The pane command remains one argv element that IS a shell string** — so every value interpolated into it (the resolved pi argv, each session flag) is still `shellEscape`d, now in a clean context with no enclosing double quotes, where single-quoting is sound.

Removing `shellEscape` from this path, as an earlier draft of the companion fix proposed, would have failed this change's own spec scenario "each flag value SHALL reach pi as a single literal argument".

**Why a bare path is also wrong.** `resolveExecutor("pi")` returns argv — typically `[node, dist/cli.js]` (`makeNodeScriptToArgv`). Embedding only `cli.js` would depend on its `#!/usr/bin/env node` shebang finding a suitable node on the *pane's* PATH, which is precisely the failure mode `toArgv` exists to eliminate. The resolved argv is carried whole.

**This also fixes a pre-existing vulnerability.** `cd ${safeCwd}` is interpolated into that same double-quoted, shell-executed string today, so a workspace path containing `$(…)` is a live command-injection vector in shipped code, independent of this change. The argv conversion removes it. It is recorded as its own change (`fix-tmux-cwd-command-injection`) so it is visible as a security fix rather than buried in a feature, with this change as the vehicle.

**`wsl-tmux` needs an explicit builder variant, not the same call.** `spawnWslTmux` currently wraps the same builder as `` wsl ${cmd} ``, so the command runs inside WSL while a host-resolved path would be a Windows path — not executable in that namespace. A single builder cannot both embed the host-resolved argv (native tmux) and omit it (WSL); the builder therefore takes an explicit **pi-invocation parameter**, and the two call sites pass different values: `spawnTmux` passes the registry-resolved argv, `spawnWslTmux` passes the bare `pi` so WSL resolves it in its own namespace. Escaping and argv construction are shared; only the invocation differs. Making WSL installs selectable would require enumerating inside the WSL namespace — out of scope, and the picker says so.

**Electron and asar do not interact with this.** `selectMechanism` returns `headless` whenever `electronMode` is set, so tmux is never selected under the packaged Electron app; an `app.asar`-internal resolution can therefore never reach a tmux pane. Stated explicitly because the combination looks dangerous until you check the mechanism gate.

**Behavioural side effect, disclosed:** tmux sessions change which binary they run even for users who never touch the picker, whenever the shell's first `pi` differs from the registry's resolution. This aligns tmux with headless and Windows Terminal (which already resolve through the registry) but it is a real change on the default path and belongs in the release notes.

**Alternative rejected:** scope-limit the feature and warn that tmux sessions use `PATH` pi. Honest, but it leaves the primary interactive path unmanaged and makes every other surface in the change misreport for the majority of users.

### D10. Mapping a resolved binary back to a candidate

The `Automatic` row and each candidate's "used by" marker require mapping a resolved *entry path* back to a candidate. The mapping realpaths both sides and compares the containing package directory, reusing the walk `readCurrentPiVersion` (`pi-version-skew.ts`) already performs.

**Unmatched case is explicit:** a `PATH` pi outside every enumerated location (homebrew, a custom bin dir, a non-first `which -a` hit) SHALL render as an additional read-only "current" candidate carrying its own version, rather than leaving the `Automatic` row versionless. The spec requires `Automatic` to display what the chain currently resolves to; that is only satisfiable if an unrecognised resolution is still representable.

### D11. Version comparison and the floor live in shared, with one reader

`parseVersion` / `compareVersions` / `isBelow` currently live in `packages/server/src/pi/pi-version-skew.ts`, but the shared enumerator (D2) and validator (D6) need them. They move to `packages/shared/` alongside the promoted helpers; the server re-exports so `pi-version-skew.ts` keeps its public surface.

The floor gets **one** reader. `readPiFloor` (returns `null` when absent) and the server's `readPiCompatibility` (falls back to `minimum: "0.6.7"`) disagree on the missing-file case: a packaged deployment without `packages/server/package.json` would silently disable floor gating in the picker while `/api/health` reported `0.6.7`. The promoted reader is the single implementation and its missing-file behaviour is stated explicitly rather than differing per caller.

### D12. Section placement: immediately above Tools — which is now the Developer tab

The new section goes immediately above `<ToolsSection />` in `SettingsPanel.tsx`.

**Correction, found during implementation:** this decision originally said "Settings → General", which was true when it was written. `ToolsSection` has since moved to the **Developer** page (Advanced group) under change `reorganize-settings-pages-and-descriptions`; the line number quoted here still matched, but the tab around it did not. The picker follows Tools.

**Why:** the picker is the curated front door and Tools is the raw escape hatch; front door first. Adjacency is the load-bearing half of that rationale — it makes the "same underlying `tool-overrides.json`" relationship legible, and splitting the two across pages would leave two places to edit one file with nothing on screen saying so. Discoverability on General was the other half and is deliberately traded away: a user who needs to pin a pi install is already in the same territory as the Tools overrides.

`PiVersionAdvisory` stays where it is — it answers "should you upgrade", a different question from "which install".

## Risks / Trade-offs

- **Pre-existing `pi`-only overrides surface as a new red banner on upgrade.** Users who set a `pi` override through the Tools row are already split-brained and don't know it. → Intended, but expect support questions on release. The banner offers one-click re-link, and the release note should call it out explicitly rather than letting it look like a regression.

- **Permitting deliberate mismatch is close to irreversible.** Removing the capability later breaks anyone depending on it. → Gated on `doubt-driven-review` before the UI ships it; divergence is machine-readable from day one (D5) so support cost stays bounded.

- **Enumerator and strategy chain can drift apart.** A candidate could be offered that the chain cannot actually resolve. → Non-vacuous drift test per D2a: assert the candidate's entries actually spawn/import, not merely that `resolve()` returns ok (which is true for any existing path and would have hidden the directory defect entirely).

- **tmux behaviour changes for users who never open the picker.** Where the shell's first `PATH` pi differs from the registry's resolution, those sessions silently switch binaries. → Disclosed in the release notes; aligns tmux with the mechanisms that already resolve through the registry. Rollback is the same as the rest of the change.

- **The tmux conversion changes a load-bearing spawn path.** `buildTmuxCommand`'s return type changes from string to argv, breaking its existing tests and both call sites. → Sequenced early (migration step 3) and independently revertable; the existing tests are updated as part of that step rather than after the picker lands.

- **`wsl-tmux` remains PATH-resolved inside WSL.** → Explicitly stated in the UI rather than silently misreported; enumerating WSL-namespace installs is out of scope.

- **Tightening `PUT /api/tools/:name` is a behaviour change to a shipped endpoint.** An existing exotic override could start failing. → Validate on the resolved package directory rather than the binary path; error names the failed check. Only `pi` and `pi-coding-agent` adopt the validator initially, so no other tool's overrides change behaviour.

- **Declared version can differ from binary reality (D3).** → Accepted; the floor check is a compatibility guard, not an integrity check.

- **Electron users can point outside the immutable bundle**, defeating part of the `eliminate-electron-runtime-install` architecture (finding F9). → Permitted but warned, per the proposal; the bundle remains the default and `Automatic` still resolves to it.

## Migration Plan

1. Promote the three helpers + the version comparators into `packages/shared/`; re-export from the doctor skill's `_lib/checks.ts` and from `pi-version-skew.ts` so both are unchanged behaviourally.
2. Add the enumerator (with per-consumer entries) + validator in shared, with tests, before any route or UI work.
3. Convert `buildTmuxCommand` to argv form with its injection test, updating `spawnTmux`, `spawnWslTmux` and the existing `process-manager.test.ts` assertions (which currently assert on the returned *string*). This is independently valuable and independently revertable — it closes the pre-existing cwd injection and makes tmux consistent with headless/wt regardless of whether the picker ships.
4. Add `POST /api/pi/runtime`, `GET /api/pi/installs`, and the `PUT` route validation. At this point the API is complete and testable with no UI.
5. Add the Settings section. Default state (no override) renders `Automatic` for both consumers and writes nothing.
6. Add the `/api/health` + doctor divergence fields.

**Rollback:** the feature is additive and default-inert. With no override set the strategy chain behaves exactly as before, so reverting the client section alone is safe. A user who has pinned a selection can clear it from the Tools section, which is unchanged, or by deleting `~/.pi/dashboard/tool-overrides.json`.

## Open Questions — RESOLVED

Each answered during implementation; recorded here rather than left open.

- **Should the `Automatic` row show the resolved version only, or also which strategy won?**
  → **Version + location only.** The row already renders `<version> · <path>`, which
  answers "what am I actually on" without teaching the reader what `bare-import`
  means. The strategy name stays available where jargon is expected: `Resolution.tried`
  is on `GET /api/tools/:name` and in the diagnostics export.

- **Should the running-session count offer a bulk "restart these sessions"?**
  → **Informational only in this change.** Restarting live sessions is destructive and
  irreversible in a way the picker is not; folding it in would make one confirm-dialog
  cover two very different blast radii. The count names the exposure; acting on it stays
  a per-session decision. Sessions with an unrecorded `piVersion` are reported separately
  and never folded into the count.

- **Does the import-side restart offer belong in the apply dialog, or should it defer to
  the existing restart affordance?**
  → **In the section, after a successful apply — not in the dialog.** The dialog fires
  BEFORE the write, when the restart is still hypothetical; offering it there would ask
  the user to consent to two things at once. The offer renders only when the import
  consumer actually changed, and delegates to the existing `POST /api/restart`.

- **Should the validator be extended to every tool's override?**
  → **No — `pi` and `pi-coding-agent` only.** The two pi entries are the ones this change
  makes newly and discoverably writable. Broadening it would change shipped behaviour for
  `openspec`, `npm`, `node`, `git` and `zrok` overrides that nothing here touches, and the
  validator's "must not be a directory" rule is a pi-consumer fact, not a universal one.
  A regression test asserts a non-pi tool's override is still unvalidated.

- **Should the WSL-tmux path translate the resolved Windows path to a WSL path?**
  → **No translation — WSL resolves `pi` itself.** `spawnWslTmux` passes bare `["pi"]`, so
  the pane resolves pi inside the WSL namespace. `wslpath` translation was rejected: a
  translated host path points at a Windows-side install whose Node and native modules are
  the wrong platform, so it would resolve to a binary that cannot run. Making WSL installs
  selectable needs enumeration inside the WSL namespace, which is out of scope; the UI
  states that WSL sessions are not covered by the selection.
