# Test Plan — unify-pi-runtime-identity

Stage: design   Generated: 2026-08-30

Clarifications resolved via hard gate (answers folded into spec/design): pre-spawn budget
p95 < 50ms stat-path / < 250ms shim-probe-path over a 100-entry manifest; discovery-walk depth
cap = 8 levels below the tree root.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | ladder version gate (managed-node-runtime) | BVA sweep | L1 | automated | candidate versions 22.18.9 / 22.19.0 / 23.5.0 / 24.0.1 / 24.1.0 / 24.2.9 / 24.3.0 / 26.9.9 / 27.0.0 | gate evaluates each | rejected / accepted / accepted / accepted / rejected / rejected / accepted / accepted / accepted-with-cap-note, matching the documented accept-set |
| E2 | pi floor read (design D2) | EP + fault variants | L1 | automated | engines strings `>=22.19.0`, `>=22.19.0 <27`, `^22`, `~22.19`, `weird||range`, missing package.json; fixture tree with global pi carrying a different floor | `readPiEnginesFloor()` on the spawned pi copy | parsed floors for the four valid shapes; `MIN_SUPPORTED_NODE` fallback for the rest; global pi's floor never consulted |
| E3 | resolution ladder cells (managed-node-runtime) | decision table | L1 | automated | injected machine states: override valid/invalid/absent × user Node pass/fail/absent × managed present/absent/stale × arm electron/npm | `resolveSpawnRuntime()` | each completeness-matrix cell yields its specified runtime; invalid override and 24.1 user Node fall through with recorded reasons; stale managed skipped to own runtime |
| E4 | arm-dependent step-2 order (managed-node-runtime) | decision table | L1 | automated | GUI arm: service-PATH node 24.9 + login-shell nvm node 25.1; terminal arm: PATH `nvm use` node 25.1 + profile default 24.9 | step-2 candidate evaluation | GUI arm resolves the login-shell node; terminal arm resolves the PATH node — each source first-hit-only |
| E5 | version-manager default probe (managed-node-runtime) | state | L1 | automated | no PATH/login-shell node; `~/.nvm/alias/default` → installed 25.1; variant with no default alias | step-2 fs probe | 25.1 resolved with no shell invocation; no-alias variant falls through to step 3 |
| E6 | publication shapes (managed-node-runtime) | decision table | L1 | automated | resolved = user path / managed / bundled-stable / bundled under `/tmp/.mount_x` / bundled under `/AppTranslocation/x`; config containing `runtime.override` + unknown keys | startup publication write | outside-bundle shapes name binary+ABI+source; every bundled shape is path-free with `resolvedAt` (+ `ephemeral: true` for the two mounts); `runtime.override` and unknown keys byte-identical |
| E7 | stale block does not steer (managed-node-runtime) | state-transition | L1 | automated | `runtime.resolved` naming a deleted binary | next server start | fresh ladder result spawned and republished; stale path never used |
| E8 | legacy-dir orphan test (doctor-diagnostic) | decision table | L1 | automated | `~/.pi-dashboard` fixtures: all-absent / logs-only / wizard-only / `node/`-only / node_modules-only / dir absent | Doctor + startup advisory | all-absent → one warning row with size detail + delete suggestion; every live combo → no delete suggestion anywhere, consumers named; dir absent → no row (see packages/shared/src/__tests__/doctor-core-legacy-advisory.test.ts) |
| E9 | engines message hint (server-startup-node-version-guard) | decision table | L1 | automated | managed Node present / absent | `buildEnginesRangeMessage("v27.0.0")` | present → nvm + PATH-prepend + brew hints; absent → nvm + brew only, no `.pi-dashboard` substring |
| E10 | discovery-walk depth cap (doctor-diagnostic) | BVA | L1 | automated | fixture tree with `.node` files at depth 8 and depth 9 below root (nested `prebuilds/**` layout) | discovery walk | depth-8 file in manifest with `builtAbi`; depth-9 file absent |
| E11 | N-API classification by inspection (doctor-diagnostic) | decision table | L1 | automated | V8-bound module in prebuilds layout with ABI ≠ resolved; N-API module | scanner classification | V8 module → mismatch row (prebuild layout does not exempt); N-API module → skipped, no row |
| E12 | in-place rebuild invalidation (doctor-diagnostic) | state-transition | L1 | automated | manifest-listed `.node` rewritten in place, tree shape unchanged | next pre-spawn check | stat drift detected, module re-evaluated against resolved ABI |
| E13 | spawn env + application points (managed-node-runtime) | decision table | L1 | automated | resolved user runtime; managed dir also present; Windows argv assembly; extension-install command build with bundled family | pi-session spawn env construction / updater spawn / install command build | resolved bin dir first on child PATH and managed not ahead; `process.env` unmutated; pi-core-updater keeps managed prepend; Windows argv carries resolved `node.exe`; install command uses per-member `npmEntry` (bundled `npm-cli.js` case) (see packages/shared/src/__tests__/binary-lookup-spawn-env.test.ts) |
| E14 | spawn-time identity re-validation (managed-node-runtime) | state-transition | L1 | automated | nvm symlink retargeted after resolution; volta/asdf shim path with unchanged stat | pre-spawn re-validation | retargeted symlink → re-resolve before spawn; shim path → per-spawn probe fires despite identical stat signature |
| E15 | resolved-runtime visibility content (doctor-diagnostic) | decision table | L1 | automated | resolved runtime + divergent PATH install; override shadowing a selection; resolved major ≥ cap | Doctor report build | runtime row names binary/version/ABI/source; divergence row with `node -v` remedy + override pointer; shadowed selection named; above-cap note informational, not error |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | pre-spawn stat path (doctor-diagnostic) | tail-latency | L1 | automated | 100-entry manifest, repeated pre-spawn checks | p95 < 50ms | 100 iterations |
| P2 | shim-probe path (doctor-diagnostic) | tail-latency | L1 | automated | shim-shaped resolution forcing per-spawn probe, 100-entry manifest | p95 < 250ms | 20 iterations |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | visibility row rendered (doctor-diagnostic) | state-convergence | L3 | automated | docker harness (single in-image Node, coherent tree) | open Settings → Diagnostics | spawn-runtime row visible with version + source label; zero ABI-mismatch rows (see tests/e2e/blackhole-settings.spec.ts for the settings-surface harness glue; port from `.pi-test-harness.json`) |
| F2 | Doctor row copy/wording (design open question) | visual/subjective | — | manual-only | rendered Doctor rows from this change | human reads | [judgment: wording clear, rows grouped sensibly — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | detector fault isolation (doctor-diagnostic) | fault-injection (abort) | L1 | automated | legacy-dir detector throws | Doctor run | report still produced, no `Legacy install directory` row (see packages/shared/src/__tests__/doctor-fault-tolerance.test.ts) |
| X2 | candidate probe failure (managed-node-runtime) | fault-injection (abort + garbage) | L1 | automated | candidate probe exits non-zero / emits garbage / times out | step-2 evaluation | candidate rejected with recorded reason; ladder continues to next source; no throw |
| X3 | Tier-B probe containment (doctor-diagnostic) | fault-injection (abort) | L1 | automated | probe child crashes on `dlopen`; child emits the `NODE_MODULE_VERSION X … requires Y` message | scanner evaluation | server unaffected; crash → module verdict recorded from message when parseable, unknown otherwise |
| X4 | publication write safety (managed-node-runtime) | fault-injection | L1 | automated | config file with unknown keys + `runtime.override`; interrupted-write simulation (temp file left behind) | publication write | atomic temp+rename; unknown keys and override intact; no truncated config observable |
| X5 | resolved runtime vanishes (managed-node-runtime) | fault-injection (abort) | L1 | automated | resolved user Node directory deleted after startup | next pi-session spawn | re-resolution lands on managed/bundled per ladder; reason recorded; spawn succeeds |
| X6 | autoRebuild consent + abstention (doctor-diagnostic) | decision table | L1 | automated | mismatch detected × autoRebuild off/on × divergence absent/present | reconciliation decision | off → offered only; on+clean → unattended scoped rebuild logged; on+divergence → abstains, offers interactively |
| X7 | live publication end-to-end (managed-node-runtime) | integration smoke | L2 | automated | freshly started server on a single-Node machine | read `~/.pi/dashboard/config.json` + `GET /api/doctor` after start | `runtime.resolved` present, source/ABI match the running Node; doctor reports zero ABI-mismatch rows (extend qa/tests/02-server-start.sh) |

---

## Coverage summary

- Requirements covered: 11/11 delta requirements (3 spec files) + 2 design invariants (D7 budget, D8 write safety)
- Scenarios by class: edge 15 · perf 2 · frontend 2 · error 7
- Scenarios by level: L1 22 · L2 1 · L3 1 · — 1
- Scenarios by disposition: automated 25 · manual-only 1

## New infra needed

- none (L1 vitest, L2 qa smoke, L3 Playwright harness all exist; fixture trees are per-test temp dirs)
