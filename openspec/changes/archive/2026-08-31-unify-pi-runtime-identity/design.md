# Design — unify-pi-runtime-identity

## Context

See `proposal.md` — Why. Constraints that shape the approach:

- The resolution machinery already exists: `packages/shared/src/platform/binary-lookup.ts`
  implements `managed → extraBinDirs → system PATH → login shell` with the `-lc` non-interactive
  login-shell invariant. The ladder is a *reordering + gate* on top of these primitives, not a new
  engine.
- The version predicates already exist and are lint-locked: `packages/shared/src/node-version.ts`
  (`isAffectedNode`, `isOutOfEnginesRange`, `isUsableNodeVersion`), guarded by the
  `node-cap-message-matches-engines` repo lint and the "Range is defined in exactly one place"
  scenario of `server-startup-node-version-guard`.
- Two active changes overlap: `manage-node-runtime-updates` (defines `classifyNodeSource`) and
  `add-node-runtime-family-selection` (defines the selection surface + family-coherent npm). Both
  are 0-tasks-done; archive order is undetermined.
- Spawn surfaces that must agree: `process-manager.ts` (PATH env for pi sessions), the Windows
  headless explicit `node.exe + cli.js` argv path, and the dashboard-performed extension-tree
  mutations (installs, rebuilds).

## Goals / Non-Goals

**Goals:**

- One resolver, called at server start and re-validated at spawn time, whose result feeds *every*
  pi-session spawn surface and every shared-tree mutation.
- Gate built from existing predicates + the resolved pi package's `engines.node`; zero new version
  literals.
- ABI detection that can never destabilise the server and never false-positives on NAPI modules.
- Coordination contracts with the two overlapping changes explicit enough that either archive order
  works.

**Non-Goals:**

- Changing the Electron *server's* runtime (`electron-node-runtime-selection` stays authoritative:
  bundled Node preferred for the server process).
- Managed-runtime install/upgrade flows (`manage-node-runtime-updates` owns them).
- The family-selection UI and its atomic family write (`add-node-runtime-family-selection` owns
  them).
- Implementing the hermes `node:sqlite` migration or pi's per-ABI segregation (Part 4 files issues
  only).

## Decisions

### D1 — Ladder lives in `packages/shared/src/platform/` as a new module

A new `spawn-runtime.ts` (name indicative) exporting `resolveSpawnRuntime(opts) → ResolvedRuntime`
composes existing `binary-lookup.ts` primitives — note the login-shell resolver is currently a
private function there (`whichViaLoginShell`, ~line 623); it gets exported rather than
reimplemented. **Alternative considered**: extend `ToolRegistry`
with a `spawn-node` tool. Rejected — the registry's `node` chain is spec-pinned managed-first for
*dashboard tooling* (`managed-node-runtime` / `tool-registry` specs), and overloading it would
conflate the two axes this change deliberately separates. The registry chains stay untouched.

`ResolvedRuntime` carries `{ nodeBinary, nodeBinDir, version, abi, source, ephemeral }`. `abi`
comes from a one-shot candidate probe — `<node> -p "process.version + ' ' + process.versions.modules"`
— which yields version and ABI authoritatively in one spawn. The probe execs the candidate with
a **fixed argv, no shell** — the same trust boundary as the user running `node` in their own
terminal; "validation before exec" in the proposal's security framing means *before adopting a
runtime for pi spawns*, and the probe is that validation. (Family-selection's enumeration reads
versions without spawning because it lists *many* candidates for a picker; the ladder probes the
few it may actually adopt.) **Alternative considered**: a maintained
major→NODE_MODULE_VERSION mapping table. Rejected — it is a new version-literal class to keep in
sync, while the probe is already needed to validate the candidate at all. For the execPath rung
the probe is skipped: `process.version`/`process.versions.modules` of the running server are
authoritative.

### D2 — Gate = pi floor ∧ ¬affected; cap is advisory

`readPiEnginesFloor()`: walk up from the tool-registry-resolved pi entry (`dist/cli.js`) to the
nearest `package.json` whose `name` is the pi package — the pi copy that will actually be spawned
(bare-import wins even when a global pi exists, so under Electron this is the bundled pi; on the
npm arm the server's own dependency). Parse `engines.node`, extract the floor; on any failure →
fallback to the canonical floor. Parsing rule: support the shapes that occur in practice
(`>=X.Y.Z` optionally with a cap term, `^X`, `~X.Y`); anything else is "unreadable" → fallback. Gate: `meetsFloor(v, floor) && !isAffectedNode(v)`. Both `meetsFloor`
and the fallback constant (`MIN_SUPPORTED_NODE`) are **new, small additions** to
`node-version.ts` — today no floor constant exists anywhere (the floor lives only in
`package.json#engines` and the guard's message literal), so the constant *refactors the existing
inline arithmetic into a named export*, lockstep-asserted against `isOutOfEnginesRange` the same
way the guard spec already asserts its message literal. One defining occurrence, as before. Deliberately *not* `isUsableNodeVersion` wholesale: its `>=27` cap
rejection would recreate the ABI split on future Nodes (proposal — Version gate). Cap excess
surfaces as a Doctor info note only. A terminal global pi with a *different* floor than the
spawned pi copy is that runtime's own concern — shown in the Doctor runtime row when readable,
never a gate input.

### D3 — Application points: three, each mechanical

1. `process-manager.ts` — replace `prependManagedNodeToPath(env)` with env construction from
   `ResolvedRuntime.nodeBinDir` (first `PATH` entry).
2. Windows headless argv — the explicit node binary becomes `ResolvedRuntime.nodeBinary` (the
   argv-assembly seam `nodeScriptToArgv` already accepts an arbitrary node path).
3. Shared-tree mutations (recommended-extension install, Part-2 rebuild) — npm-of-the-resolved
   family, mechanism per `add-node-runtime-family-selection`'s per-member entry model
   (`nodeEntry`/`npmEntry` — a family member is an entry *file*, never a directory-sibling
   assumption: the bundled POSIX npm lives at `lib/node_modules/npm/bin/npm-cli.js`, not beside
   the node binary; `electron/src/lib/bundled-node.ts` already resolves it).

`pi-core-updater.ts` keeps the managed prepend — it mutates the *managed* tree, whose owning
runtime is the managed Node (spec: "Managed-tree mutations retain the managed runtime").

### D4 — `classifyNodeSource`: consume-or-vendor under one signature

If `manage-node-runtime-updates` has landed when implementation starts, import it. Otherwise
vendor `classifyNodeSource(nodePath)` in `packages/shared/src/platform/` with the exact spec'd
signature and semantics (`realpathSync` compare against managed dir and `resourcesPath`), marked
with a convergence comment naming that change. Either way exactly one implementation exists at any
time; if ours lands first, the other change's task list adopts it in place.

### D5 — Selection surface unification (coordination contract with family-selection)

One user intent, one precedence: an explicit Node-installation selection is the ladder's gated
step-1 candidate. Mechanically the two stores differ — the ladder override is
`runtime.override` in `~/.pi/dashboard/config.json`; family-selection persists its selection as
registry overrides for `node`/`npm`/`npx` (its "One selection writes the whole family atomically"
requirement, via `registry.setOverrides()`). The ladder therefore reads **both**: `runtime.override`
first, else the family-selection `node` override as the step-1 candidate, both under the same
gate. Mechanism: the ladder reads the persisted override *store*
(`~/.pi/dashboard/tool-overrides.json`, the file family-selection's atomic write targets)
directly via a small read-only helper — a file read, not a `ToolRegistry` instance, so
`spawn-runtime.ts` stays registry-free and has no init-ordering dependency. Axis split stays
intact: the selection governs *dashboard tooling* resolution directly; shared-tree operations
always follow the ladder result (which honours the selection at step 1 when it passes the gate).
A **gate-failing selection** (e.g. a hand-picked 24.1) keeps governing dashboard tooling but
never pi spawns — the ladder skips it with a recorded reason and the Doctor runtime row names
the divergence, so the refusal is visible, not silent. Two deliberate consequences of reading
that store: a **pre-existing manual `node` override** (Settings → Tools predates
family-selection) starts governing pi spawns too — intended unification of "use this node"
intent, called out in the migration plan and visible in the Doctor row's source label; and when
**both** `runtime.override` and a selection exist, `runtime.override` wins and the Doctor
runtime row shows the shadowed selection so neither surface is silently ignored.

**Archive-order contract**: whichever change archives *second* must reconcile the
spawned-children requirement — family-selection's "no selection preserves current behaviour"
scenario describes the pre-ladder default (unconditional managed prepend) and is superseded by the
ladder default (steps 2–4). This is a known, deliberate delta-vs-delta supersession; the second
archive carries a MODIFIED block for it. A coordination note stating this contract is written
into `add-node-runtime-family-selection/proposal.md` (that change has no design.md) so the
contract is visible from both changes and neither archive silently re-introduces the
unconditional prepend.

### D6 — ABI extraction: file inspection first, contained probe as fallback

Two tiers behind one `readNativeModuleAbi(dotNodePath)`:

- **Tier A (file inspection)**: parse the compiled binary for the classic `NODE_MODULE`
  registration struct's `nm_version` int (better-sqlite3 registers this way — 49 undefined `v8::`
  symbols, 0 NAPI). Feasible per-format (Mach-O/ELF/PE) but fiddly; implemented only as far as it
  stays a small pure reader.
- **Tier B (authoritative fallback)**: spawn the *resolved* node with a tiny probe script that
  `process.dlopen`s the module in the **child**, exiting 0 on success and printing the structured
  `ERR_DLOPEN_FAILED` message on mismatch; the parent parses the well-known "compiled against …
  NODE_MODULE_VERSION X … requires Y" shape. Crash containment is absolute (child process); cost
  is bounded (only V8-ABI candidates, cached).

N-API modules are excluded *before* either tier by a **new, small classifier** (no such signal
exists in the repo today): symbol-level inspection for N-API registration (`napi_register_*`) vs
V8 linkage — never by distribution layout, since per-platform prebuilds do not imply ABI
stability (better-sqlite3 v13 ships prebuilds and stays V8-bound). When classification is
uncertain, the module is treated as V8-bound and probed — Tier B answers definitively either way
(an N-API module simply loads fine on any ABI). **Alternative considered**: stamp files written
after dashboard-performed rebuilds. Rejected as primary — externally-run `npm rebuild` (the exact
terminal-side action in the incident) would go undetected; the manifest stat-check in D7 exists
precisely because external mutations must be caught.

### D7 — Manifest cache + pre-spawn budget

A discovery walk (depth-capped at **8 levels** below the tree root, skipping non-candidate dirs,
dependency dirs **included** — the real offenders live nested:
`better-sqlite3/build/Release/*.node`, `prebuilds/**` at ~5 levels) runs at server
start and on Doctor demand, producing a **manifest** of compiled-module files: stat signature `(path, size, mtimeMs)` plus
the classification verdict per file (`builtAbi` for V8-bound modules, or an N-API skip marker).
The pre-spawn check re-stats manifest entries and compares each stored `builtAbi` against the
resolved ABI — a handful of `stat` calls, no walk and no re-probe while signatures hold. Signature drift (e.g. an external
`npm rebuild` rewriting a `.node` in place, which changes no directory shape — the exact incident
action) invalidates the verdict and triggers re-evaluation; new modules appear via the next
discovery walk (server start / Doctor). Runtime re-validation at spawn time is two-tier by resolution shape: for symlink/concrete-path
resolutions (nvm-style), `lstat` + `realpath` + mtime per spawn, with the version/ABI probe
re-run only on drift. For **shim-shaped** paths (volta/asdf/fnm/mise shim dirs — the shim file
never changes while its target version does), the identity signature is structurally blind, so
the version/ABI probe runs per spawn — budgeted p95 < 250ms (stat path p95 < 50ms, both over a
100-entry manifest) against a full pi-session process launch, accepted. This is what actually satisfies the spec's "same real path and version" for
both manager styles. **Alternative considered**: verdict keyed on the tree
root's mtime — rejected, in-place rebuilds don't touch the root mtime, which would blind the
guard to the exact failure it exists to catch. No persistent cache file — a stale persisted
verdict is worse than a rescan.

### D8 — Publication write path

`runtime.resolved` is written through the existing server config read-modify-write helper (same
lifecycle as other `~/.pi/dashboard/config.json` writes) at the end of successful startup, as an
atomic temp-write + rename that preserves unknown keys. The write path SHALL round-trip
`runtime.override` untouched — the two keys are disjoint by construction (machine-owned vs
user-owned), which is what lets publication run every start without ever destroying or becoming
a pin. Concurrent dashboards agree on the block whenever steps 1–3 resolved it (shared machine
state); in the narrow all-miss state the arm-local step 4 may make publishes alternate —
accepted, because nothing consumes the block for execution (see the completeness matrix).
Bundled runtime is **always** published path-free — `classifyNodeSource` = `bundled-electron`
(stable installs included: /Applications, Program Files) → write
`{ source, abi, resolvedAt, ephemeral? }` with no bundle path; the `ephemeral: true` flag
additionally marks the relocating-mount classes (`/tmp/.mount_*`, `/AppTranslocation/`).

## Risks / Trade-offs

- [Login-shell vs interactive divergence (nvm in `.zshrc` only)] → Doctor visibility row (resolved
  vs terminal), config override as deterministic escape hatch; documented remedy line.
- [User's Node disappears mid-lifecycle] → spawn-time existence + gate re-validation; ladder
  re-resolves and Doctor explains the switch. Running sessions unaffected (already exec'd).
- [Tier-A binary parsing wrong on an exotic toolchain] → Tier B probe is authoritative; Tier A is
  an optimisation that must agree or defer.
- [Probe latency on spawn path] → probes only run on cache miss and only for V8-ABI candidates;
  the common case is zero probes (NAPI exclusion + cache).
- [Archive-order conflict with `add-node-runtime-family-selection`] → D5 contract written into
  both changes' artifacts (their proposal carries the coordination note); second-to-archive
  carries the MODIFIED block.
- [Concurrent Electron + npm dashboards both falling to step 4 diverge (bundled vs execPath)] →
  narrow state (steps 1–3 all missing on a dual-dashboard machine); Part 2 names the mismatch;
  managed-Node install or override restores agreement; publication alternation is benign
  (diagnostic-only block).
- [`engines.node` unreadable from resolved pi package] → canonical-floor fallback; failure is
  logged in the resolution trail, never fatal.
- [autoRebuild surprising in shared/CI environments] → default off; docker arm is single-runtime
  (mismatch structurally unlikely); flag documented as headless-only convenience.

## Migration Plan

1. Land behind no flag — the ladder is the new default; the config override (`runtime.override`)
   is the user-level pin. Called-out behavioural deltas at upgrade: a pre-existing manual `node`
   tool override starts governing pi spawns (D5, Doctor-visible), and an npm-arm machine with a
   managed Node switches spawns managed→user (proposal — Impact). To restore pre-change Electron behaviour without a code revert: install
   the managed Node (wizard/Doctor offer — it is a byte-copy of the bundled runtime at a stable
   path) and pin the override to it. Never pin a bundle-internal path — forbidden by the
   never-persist rule and self-invalidating on AppImage/translocated installs.
2. First start after upgrade on a dual-runtime machine: ladder resolves the user Node; Part-2 scan
   flags the (likely) mismatched tree; Doctor offers the one converging rebuild.
3. Rollback strategy: revert = restore `prependManagedNodeToPath` call site (single call-site
   replacement in `process-manager.ts`); user-level rollback = set the override. The publication
   block is additive and ignorable.

## Open Questions

- Doctor row copy/wording and exact row grouping (visibility + mismatch rows) — deferrable;
  acceptance criteria are the spec scenarios, wording is `observability-instrumentation`-skill
  territory during implementation.
