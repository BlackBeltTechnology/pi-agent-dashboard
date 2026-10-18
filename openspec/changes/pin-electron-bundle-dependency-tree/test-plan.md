# Test Plan — pin-electron-bundle-dependency-tree

Stage: design   Generated: 2026-10-18

No clarifications needed: every Triple below resolves from the delta specs and design.md (D1–D6).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Release bundles install the published runtime lock (first-party from sources) | EP | L1 | automated | lock with registry entry `node_modules/@blackbelt-technology/pi-dashboard-server` and nested `…/pi-dashboard-server/node_modules/foo`; server manifest with deps + peers | rebase | top entry becomes `{ resolved: "packages/server", link: true }`; `packages/server` entry carries the manifest's version, dependencies and peerDependencies; nested entry re-keyed to `packages/server/node_modules/foo`, otherwise byte-identical |
| E2 | Release bundles install the published runtime lock (rule precedence) | decision-table | L1 | automated | `@blackbelt-technology/pi-dashboard-mcp-client-plugin` present in both the workspace set and the bundled-plugin set | rebase | entry is linked (rule 1), not removed (rule 3) |
| E3 | Release bundles install the published runtime lock | EP (missing entry) | L1 | automated | a bundled workspace with no entry in the published lock | rebase | output still contains its link entry and `packages/<dir>` entry |
| E4 | Release bundles install the published runtime lock | EP | L1 | automated | lock with `node_modules/@blackbelt-technology/pi-dashboard-web` and nested entries | rebase | web entry and its nested entries are absent from the output |
| E5 | Release bundles install the published runtime lock | EP | L1 | automated | lock with a bundled plugin that is not a workspace (`pi-dashboard-roles-plugin`) and nested entries | rebase | plugin entry and its nested entries are absent; root third-party union entries remain |
| E6 | First-party packages never come from the registry (unmapped entry) | EP (invalid class) | L1 | automated | lock containing `node_modules/@blackbelt-technology/pi-dashboard-unknown` | rebase | throws, and the message names `@blackbelt-technology/pi-dashboard-unknown` |
| E7 | Lock entry without integrity is rejected; Lock defects stop the release | decision-table | L1 | automated | third-party entries (a) `https` with integrity, (b) `https` without integrity, (c) `git+https:` source, (d) `file:` source, (e) `http:` source | rebase | (a) kept byte-identical; (b)–(e) each throw naming the entry |
| E8 | Release bundles install the published runtime lock (root union) | EP | L1 | automated | lock root third-party deps equal to the plugin union, and a fixture where they differ by one dependency | rebase | equal case: root has the synthetic name, version X, the bundle workspaces and the union; differing case throws naming the dependency |
| E9 | Release bundles install the published runtime lock (name mapping) | EP | L1 | automated | `BUNDLED_WORKSPACE_PKGS` directory `bus-client` whose manifest name is `@blackbelt-technology/pi-dashboard-bus-client` | rebase classification | the package is treated as a bundled workspace (rule 1), not unmapped (rule 4) |
| E10 | Release installer pins third-party versions to the lock (audit subset) | decision-table | L1 | automated | installed tree fixtures: (a) every installed third-party package is in the lock, with pruned, dev-flagged and other-platform entries absent; (b) one installed `foo@2.0.0` while the lock pins `foo@1.0.0` | post-install audit | (a) passes and logs mode, source and counts; (b) fails naming `foo@2.0.0` |
| E11 | First-party packages never come from the registry (audit) | decision-table | L1 | automated | installed tree fixtures: (a) `@blackbelt-technology/*` entries are symlinks to `packages/<dir>`; (b) one is a real directory; (c) a `packages/server/node_modules` exists | post-install audit | (a) passes; (b) fails naming the package; (c) fails naming the nested directory |
| E12 | Lock defects stop the release (union parity at PR time) | EP | L1 | automated | repo state and a fixture adding a third-party dep to `packages/kb/package.json` only | union-parity test computes the bundle union (`bundle-server.mjs` set) and the lock root union (`runtime-release.mjs`) | equal for the repo; the fixture fails naming the dependency |
| E13 | Release builds prove they used the lock (manifest fields) | EP | L1 | automated | manifests with `installMode` `release-lock` + `lockVersion`, `floating`, and an invalid `installMode: "other"` | shared manifest parse/write round-trip | the first two round-trip with their fields intact; the invalid value is rejected |
| E14 | Misused release-lock input fails instead of floating | decision-table | L1 | automated | argv `--release-lock=` (empty), bare `--release-lock`, `--release-lock 0.10.0`, `--release-lock=0.10.0 --source-only`, `--release-lock=0.10.0` with server workspace at `0.9.9` | argv/precondition check | each exits non-zero before any npm spawn, and the message names the misuse |
| E15 | bundle assembly stays npm; Builds without a release-lock version keep the floating install | EP | L1 | automated | floating mode and release-lock mode | install-argv contract test | floating spawns `npm install --omit=dev --no-audit --no-fund --no-package-lock`; release-lock spawns `npm ci --omit=dev --no-audit --no-fund --allow-remote=all`; neither uses pnpm |
| E16 | Reusable Electron build workflow; Publish workflow on version tags | EP | L1 | automated | `publish.yml`, `_electron-build.yml`, `ci-electron.yml`, `ci-e2e-electron.yml` text, plus fixtures with the publish input removed and with the assertion gated on the version string instead of `release_lock` | workflow-contract test | repo passes: publish sets `release_lock: true`, the lock lint precedes the server publish, every leg forwards `--release-lock=${{ inputs.version }}` conditionally, the assertion is gated on `release_lock`, and on-demand/e2e callers do not set it; both fixtures fail |
| E17 | The nightly SHALL resolve bundled scoped dependencies from the working tree | state-transition (order) | L1 | automated | the nightly workspace set | `orderPublishSet` / publish plan | every non-server, non-root package comes before lock generation; the server is published after the lock and its lint; the root metapackage is last; topological order holds |
| E18 | Missing release lock fails the build; Lock for another version is rejected | fault-injection (abort) | L1 | automated | injected `npm pack` that (a) fails 3 times, (b) succeeds but the tarball lacks `runtime-lock.json`, (c) yields a lock whose root version is `0.9.0` for X `0.10.0` | release-lock fetch | (a) bounded retries, then exit naming X and `server@X`; (b) exit naming `runtime-lock.json`; (c) exit naming `0.9.0` and `0.10.0`; no floating install in any case |
| E19 | Release bundles install the published runtime lock (safe extraction) | EP (invalid class) | L1 | automated | server tarball fixtures with an absolute member, a `..` member, and a symlink member | release-lock extraction | each is refused before writing outside the temp dir |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|

(none: no requirement states a latency or size budget for the bundle step)

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|

(none: no rendered-UI behaviour changes)

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Release builds prove they used the lock | fault-injection (abort) | L1 | automated | `runtime-manifest.json` fixtures: missing file, `installMode: "floating"`, `lockVersion` ≠ X, matching values | post-bundle assertion script with `release_lock` true and version X | exits non-zero for the first three, naming the field; exits 0 for the match |
| X2 | Lock defects stop the release before the server is published | fault-injection (abort) | L1 | automated | freshly generated lock fixture with an unmapped first-party entry | pre-publish lock-lint script | exits non-zero naming the entry (ordering before the server publish is pinned by E16) |
| X3 | Release bundles install the published runtime lock (full matrix) | fault-injection (registry) | electron | automated | nightly run: per-leg Verdaccio, lock generated against it | `_electron-build.yml` with `release_lock: true` on all six legs | each leg's bundle log shows release-lock mode with audited counts, the post-bundle assertion passes, and every existing gate and launch smoke is green |
| X4 | Builds without a release-lock version keep the floating install | EP | electron | automated | `ci-electron.yml` dispatch | bundle step | bundle log shows floating mode, no `npm pack` of the server occurs, and `runtime-manifest.json` records `installMode: "floating"` |
| X5 | bundle assembly stays npm (no lockfile remains) | fault-injection (abort) | electron | automated | release-lock bundle run, including one forced audit failure on a scratch leg | bundle step exits (success or failure) | no `package-lock.json` exists under `packages/electron/resources/server` afterwards |
| X6 | Release installer pins third-party versions to the lock (first real release) | real-release | — | manual-only | the first `v*` release after merge | release workflow | [judgment: needs the real registry-published lock; confirm the release log shows release-lock mode with `lockVersion` = X and the installer's server `node_modules` versions are a subset of X's `runtime-lock.json`] |

---

## Coverage summary

- Requirements covered: 5/5 delta requirements (`Release bundles install the published runtime lock`, `Reusable Electron build workflow`, `Publish workflow on version tags`, `The nightly SHALL resolve bundled scoped dependencies…`, `Package-manager role split`), across all 10 scenarios of the ADDED requirement
- Scenarios by class: edge 19 · perf 0 · frontend 0 · error 6
- Scenarios by level: L1 21 · electron 3 · L2 0 · L3 0 · manual 1
- Scenarios by disposition: automated 24 · manual-only 1

## New infra needed

- none: L1 rows extend `scripts/__tests__/` and `packages/shared/src/__tests__/` vitest suites with lock/tree fixtures; electron rows run in the existing `nightly.yml` and `ci-electron.yml` callers of `_electron-build.yml`.
