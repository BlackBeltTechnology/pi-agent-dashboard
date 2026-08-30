# Tasks — unify-pi-runtime-identity

## 1. Version-gate groundwork (shared)

- [x] 1.1 Hoist the canonical floor into `packages/shared/src/node-version.ts`: add the
      `MIN_SUPPORTED_NODE` constant and `meetsFloor(version, floor)` comparator, refactor the
      inline arithmetic to stay lockstep-asserted (unit test asserting constant ⇄ predicate
      agreement), and fix the accept-set doc comment to include 23.x. Verify: new unit tests pass
      and the `node-cap-message-matches-engines` lint stays green.
- [x] 1.2 Implement `readPiEnginesFloor()`: walk up from the resolved pi entry to the nearest
      matching `package.json`, parse `engines.node` shapes (`>=X.Y.Z` ± cap, `^X`, `~X.Y`),
      fallback to `MIN_SUPPORTED_NODE` on anything else. Verify: unit tests cover each shape and
      the fallback.

## 2. Spawn-runtime resolver

- [x] 2.1 Export the login-shell resolver from `packages/shared/src/platform/binary-lookup.ts`
      (currently private `whichViaLoginShell`) without behaviour change. Verify: existing
      binary-lookup tests still pass plus a new export test.
- [x] 2.2 Provide `classifyNodeSource` per design D4: import from `manage-node-runtime-updates`'
      implementation if landed, else vendor under the identical signature with a convergence
      comment. Verify: unit tests for managed / system / bundled-electron classification.
- [x] 2.3 Implement `resolveSpawnRuntime()` in `packages/shared/src/platform/spawn-runtime.ts`:
      step-1 override read (`runtime.override`, then the `tool-overrides.json` `node` key),
      arm-dependent step-2 candidate order (login-shell first on GUI/service launches, `PATH`
      first on terminal-launched arms and Windows, then version-manager-default fs probe),
      gated step 3 (managed), step-4 terminal rung (bundled / `execPath`), fixed-argv
      version+ABI candidate probe, and a recorded-reason resolution trail. Verify: unit tests
      enumerate the completeness-matrix cells with injected probes.
- [x] 2.4 Implement spawn-time re-validation: identity signature (lstat + realpath + mtime) with
      probe-on-drift for concrete/symlink paths, per-spawn probe for shim-shaped paths
      (volta/asdf/fnm/mise dirs). Verify: unit tests cover retargeted symlink and shim cases.

## 3. Application points

- [x] 3.1 Replace `prependManagedNodeToPath` at the pi-session spawn path
      (`packages/server/src/spawn-process/process-manager.ts:240`) with env construction from the
      resolved runtime (resolved bin dir first on `PATH`, no global `process.env` mutation),
      leaving `pi-core-updater`'s managed-tree prepend in place. Verify: unit tests for env
      construction; pi-core-updater tests unchanged.
- [x] 3.2 Point explicit node-binary argv spawns (Windows headless pairing) at the resolved
      binary. Verify: argv-assembly unit test receives the resolved path.
- [x] 3.3 Route dashboard-performed shared-tree mutations (recommended-extension installs, Part-2
      rebuilds) through the resolved family using per-member entries (`nodeEntry`/`npmEntry`,
      bundled npm via `bundled-node.ts`). Verify: unit tests assert the constructed install/rebuild
      command uses the resolved family's entries.

## 4. Publication

- [x] 4.1 Publish `runtime.resolved` on successful startup via atomic temp-write + rename that
      preserves unknown keys and round-trips `runtime.override` byte-identical; bundled runtime
      publishes path-free (`{source, abi, resolvedAt, ephemeral?}`) with `/tmp/.mount_*` and
      `/AppTranslocation/` marked ephemeral. Verify: unit tests for each publication shape and the
      override round-trip.
- [x] 4.2 Add the `pi-dashboard runtime` CLI print of the published block plus live resolution.
      Verify: CLI test asserts output includes binary, version, ABI, and source.

## 5. ABI guard rail

- [x] 5.1 Implement `readNativeModuleAbi` two-tier: best-effort file inspection, authoritative
      out-of-process load probe (child `process.dlopen`, parse the `NODE_MODULE_VERSION X …
      requires Y` shape), plus the N-API classifier (symbol inspection, never distribution
      layout). Verify: unit tests with fake probe outputs; classifier test distinguishes a
      V8-bound prebuild layout from an N-API module.
- [x] 5.2 Implement the discovery walk + manifest: depth-capped walk finding nested `.node` files
      (`build/Release/**`, `prebuilds/**`), entries carrying stat signature + `builtAbi`/N-API
      marker. Verify: unit test against a fixture tree with nested modules.
- [x] 5.3 Implement the pre-spawn manifest re-stat check with in-place-rebuild invalidation.
      Verify: unit test rewrites a fixture `.node` (same tree shape) and observes re-evaluation.
- [x] 5.4 Add Doctor ABI-mismatch rows (module, built ABI, resolved runtime + ABI, scoped rebuild
      command), the offered reconciliation flow, and `runtime.autoRebuild` with
      divergence-abstention. Verify: doctor-core unit tests cover mismatch row content, consent
      default, autoRebuild run, and abstention.

## 6. Doctor visibility + home-directory contract

- [x] 6.1 Add the resolved-runtime visibility row: resolved binary/version/ABI/source beside
      every probe-discovered installation, shadowed-selection naming, `node -v` compare remedy,
      above-cap informational note. Verify: doctor-core unit tests.
- [x] 6.2 Rework `detectLegacyManagedDir()` to the orphan test (no `node/`, no wizard state, no
      non-empty `node_modules/`, no `doctor.log`/`server.log`) and make the Doctor row and
      `cli.ts` startup advisory follow it; live content names its consumers, never suggests
      deletion. Verify: unit tests enumerate the live-content combinations.
- [x] 6.3 Make `buildEnginesRangeMessage` include the managed-Node PATH hint only when
      `<managedDir>/node/` exists; update its test and the `no-managed-dir-reference` allowlist
      rationale. Verify: guard unit tests for both machine states.
- [x] 6.4 Docs drift pass (DocScribe for `docs/` prose): README.md:120,126 floor text,
      `docs/architecture.md` retired range + stale `node-version-check.ts`/`isKnownBadNode`
      reference, `known-issues.md:26-29` pre-widening values, ownership split
      (`~/.pi/dashboard/` vs `~/.pi-dashboard/`). Verify: `kb dox lint` clean and greps for the
      stale strings return nothing.

## 7. Upstream escape hatches (report, don't own)

- [x] 7.1 File the `pi-hermes-memory` issue: prefer builtin `node:sqlite` with better-sqlite3
      fallback. Verify: issue link recorded in this change's notes. (Draft + target recorded in
      notes.md; user declined autonomous filing on the third-party repo, 2026-08-30.)
- [x] 7.2 File the pi issue: shared extension tree has no owning runtime; per-ABI segregation of
      `.node` artifacts. Verify: issue link recorded in this change's notes. (Draft + target
      recorded in notes.md; user declined autonomous filing on the third-party repo, 2026-08-30.)

## 8. Coordination

- [x] 8.1 Confirm the `add-node-runtime-family-selection` coordination note still matches the
      landed ladder behaviour (selection = gated step-1 candidate; supersession contract), and
      update the archive-order note if that change has progressed. Verify: both proposals'
      coordination text agree.

## 9. Tests (folded from test-plan.md)

- [x] 9.1 Author the version-gate BVA sweep test — input: candidate versions 22.18.9/22.19.0/23.5.0/24.0.1/24.1.0/24.2.9/24.3.0/26.9.9/27.0.0; trigger: gate evaluates each; observable: reject/accept pattern matches the documented accept-set with cap-note on 27 (test-plan E1; see packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts)
- [x] 9.2 Author the pi-floor read test — input: engines shapes `>=X.Y.Z`, `>=X <27`, `^22`, `~22.19`, garbage, missing file, plus a global pi with a different floor; trigger: readPiEnginesFloor on the spawned copy; observable: valid shapes parse, rest fall back to MIN_SUPPORTED_NODE, global pi never consulted (test-plan E2; see packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts)
- [x] 9.3 Author the ladder decision-table test — input: injected override/user/managed/arm states; trigger: resolveSpawnRuntime; observable: every completeness-matrix cell yields its specified runtime with recorded skip reasons (test-plan E3; see packages/shared/src/__tests__/binary-lookup.test.ts)
- [x] 9.4 Author the arm-dependent step-2 order test — input: GUI arm with service-PATH node + login-shell nvm node, terminal arm with `nvm use` PATH node + profile default; trigger: step-2 evaluation; observable: GUI resolves login-shell hit, terminal resolves PATH hit, first-hit-only per source (test-plan E4; see packages/shared/src/__tests__/binary-lookup.test.ts)
- [x] 9.5 Author the version-manager default probe test — input: no PATH/login-shell node, nvm alias/default present vs absent; trigger: step-2 fs probe; observable: default resolved with no shell invocation, no-alias falls through (test-plan E5; see packages/shared/src/__tests__/binary-lookup.test.ts)
- [x] 9.6 Author the publication-shapes test — input: resolved user/managed/bundled-stable/AppImage-mount/translocated runtimes with runtime.override + unknown keys in config; trigger: startup publication; observable: outside-bundle shapes carry binary+ABI+source, all bundled shapes path-free with resolvedAt and ephemeral flags on mounts, override + unknown keys byte-identical (test-plan E6; see packages/shared/src/__tests__/binary-lookup.test.ts for tmp-dir glue)
- [x] 9.7 Author the stale-block test — input: runtime.resolved naming a deleted binary; trigger: next server start; observable: fresh ladder result spawned and republished, stale path unused (test-plan E7; see packages/shared/src/__tests__/binary-lookup.test.ts)
- [x] 9.8 Author the legacy-dir orphan decision-table test — input: ~/.pi-dashboard fixtures all-absent/logs-only/wizard-only/node-only/node_modules-only/absent; trigger: Doctor + startup advisory; observable: only all-absent warns with delete suggestion + size detail, live combos name consumers with no delete suggestion, absent dir emits no row (test-plan E8; see packages/shared/src/__tests__/doctor-core-legacy-advisory.test.ts)
- [x] 9.9 Author the engines-message hint test — input: managed Node present vs absent; trigger: buildEnginesRangeMessage("v27.0.0"); observable: three hints when present, two hints and no `.pi-dashboard` substring when absent (test-plan E9; see packages/server/src/__tests__/node-guard.test.ts)
- [x] 9.10 Author the discovery-depth boundary test — input: fixture tree with .node files at depth 8 and 9; trigger: discovery walk; observable: depth-8 in manifest with builtAbi, depth-9 absent (test-plan E10; see packages/shared/src/__tests__/binary-lookup.test.ts for fixture-tree glue)
- [x] 9.11 Author the N-API classification test — input: V8-bound module in prebuilds layout with mismatched ABI, plus an N-API module; trigger: scanner classification; observable: V8 module rows despite prebuild layout, N-API module skipped (test-plan E11; see packages/shared/src/__tests__/doctor-core.test.ts)
- [x] 9.12 Author the in-place-rebuild invalidation test — input: manifest-listed .node rewritten in place, tree shape unchanged; trigger: next pre-spawn check; observable: stat drift detected, module re-evaluated (test-plan E12; see packages/shared/src/__tests__/doctor-core.test.ts)
- [x] 9.13 Author the spawn-env application test — input: resolved user runtime with managed dir present, Windows argv assembly, bundled-family install command; trigger: env/argv/command construction; observable: resolved bin dir first with managed not ahead and process.env unmutated, updater keeps managed prepend, argv carries resolved node.exe, install uses per-member npmEntry (test-plan E13; see packages/shared/src/__tests__/binary-lookup-spawn-env.test.ts)
- [x] 9.14 Author the identity re-validation test — input: retargeted nvm symlink and an unchanged volta/asdf shim path; trigger: pre-spawn re-validation; observable: symlink drift re-resolves, shim path probes per spawn despite identical stat (test-plan E14; see packages/shared/src/__tests__/binary-lookup.test.ts)
- [x] 9.15 Author the visibility-row content test — input: resolved runtime with divergent PATH install, override shadowing a selection, above-cap resolved major; trigger: Doctor report build; observable: runtime row with binary/version/ABI/source, divergence row with node -v remedy and override pointer, shadowed selection named, cap note informational (test-plan E15; see packages/shared/src/__tests__/doctor-core.test.ts)
- [x] 9.16 Author the pre-spawn stat-path latency test — workload: 100-entry manifest, 100 iterations; observable: p95 < 50ms (test-plan P1; see packages/shared/src/__tests__/doctor-core.test.ts for timing glue)
- [x] 9.17 Author the shim-probe latency test — workload: shim-shaped resolution forcing per-spawn probe, 20 iterations over a 100-entry manifest; observable: p95 < 250ms (test-plan P2; see packages/shared/src/__tests__/doctor-core.test.ts)
- [x] 9.18 Author the Diagnostics visibility e2e spec — input: docker harness with its single in-image Node; trigger: open Settings → Diagnostics; observable: spawn-runtime row visible with version + source label and zero ABI-mismatch rows, port read from .pi-test-harness.json (test-plan F1; see tests/e2e/blackhole-settings.spec.ts)
- [x] 9.19 Author the detector fault-isolation test — fault: legacy-dir detector throws; trigger: Doctor run; observable: report produced, no Legacy install directory row (test-plan X1; see packages/shared/src/__tests__/doctor-fault-tolerance.test.ts)
- [x] 9.20 Author the candidate-probe failure test — fault: probe exits non-zero / garbage output / timeout; trigger: step-2 evaluation; observable: candidate rejected with recorded reason, ladder continues without throw (test-plan X2; see packages/shared/src/__tests__/binary-lookup.test.ts)
- [x] 9.21 Author the Tier-B probe containment test — fault: probe child crashes on dlopen or emits the NODE_MODULE_VERSION mismatch message; trigger: scanner evaluation; observable: server unaffected, verdict from parseable message else unknown (test-plan X3; see packages/shared/src/__tests__/doctor-core.test.ts)
- [x] 9.22 Author the publication write-safety test — fault: config with unknown keys + override, leftover temp file from interrupted write; trigger: publication write; observable: atomic temp+rename, unknown keys and override intact, no truncated config (test-plan X4; see packages/shared/src/__tests__/binary-lookup.test.ts for tmp-dir glue)
- [x] 9.23 Author the vanished-runtime test — fault: resolved user Node directory deleted after startup; trigger: next pi-session spawn; observable: re-resolution lands per ladder with recorded reason, spawn succeeds (test-plan X5; see packages/shared/src/__tests__/binary-lookup.test.ts)
- [x] 9.24 Author the autoRebuild consent/abstention test — input: mismatch × autoRebuild off/on × divergence absent/present; trigger: reconciliation decision; observable: off offers only, on+clean rebuilds unattended and logs, on+divergence abstains and offers (test-plan X6; see packages/shared/src/__tests__/doctor-core.test.ts)
- [x] 9.25 Extend the qa server-start smoke with live publication assertions — input: freshly started server on a single-Node machine; trigger: read ~/.pi/dashboard/config.json and GET /api/doctor; observable: runtime.resolved present with source/ABI matching the running Node and zero ABI-mismatch rows (test-plan X7; extend qa/tests/02-server-start.sh)

## 10. Manual verification

- [ ] 10.1 Review the rendered Doctor row copy and grouping for the new runtime/ABI rows — human judgment on wording clarity, deferred post-merge (test-plan: manual-only)
