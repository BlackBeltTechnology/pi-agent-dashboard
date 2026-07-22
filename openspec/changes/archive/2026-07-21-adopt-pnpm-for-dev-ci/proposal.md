# Adopt pnpm for dev + CI (npm stays for runtime + publish)

## Discipline Skills

`doubt-driven-review` (package-manager migration is a high-stakes, wide-blast-radius
change — verify the plan before CI/Docker/publish are switched) and `review-code`
(the `bundle-server.mjs` cpSync change + CI/Docker edits before commit).

> **Status: EXPLORE / decision record.** Captured from an explore-mode session.
> No implementation authorized yet. This documents *why*, *scope*, and *risk*
> so a future change can execute (or decide against) it deliberately.

## Why

`npm` is used across the repo in **three distinct roles** with different constraints:

| Role | Where | Who owns the toolchain | Can move to pnpm? |
|---|---|---|---|
| **A. Dev / CI / build** | your machine, GH runners, Docker build | us | 🟡 yes, defensibly |
| **B. Publish** | `publish.yml` → npm registry | us | 🔴 keep npm |
| **C. Runtime (shipped)** | server/electron on the **end user's box** | **not us** | 🔴 keep npm (hard wall) |

The trigger is **Column A pain** — and it is TWO npm bugs, not one, that the
repo is currently wedged between via a hardcoded npm version pin:

1. **npm cli#4828** — installing against a cross-platform lockfile skips
   platform-matching **optional** deps (`@rollup/rollup-linux-x64-gnu`,
   `lightningcss-linux-x64-gnu`) → `Cannot find module` at build. Worked around
   by **deleting the lockfile before install** in the Docker web-client build
   and CI (`rm -f package-lock.json && npm install`), sacrificing reproducible
   installs in the layer that most needs them.
2. **EALLOWGIT** — newer npm **defaults to refusing git-protocol dependency
   fetches**. The electron toolchain pulls a transitive **git** dep
   `@electron/node-gyp` (`git+ssh://…github.com/electron/node-gyp.git#06b29aa…`,
   via `@electron/rebuild` ← `@electron-forge/core`), so newer npm breaks
   `npm ci` / the electron build with `EALLOWGIT`.

The repo threads BOTH by pinning **npm 11.12.1** — the ONLY version that has
OIDC trusted publishing + allows the git dep + installs optional native deps
(11.5.1 drops the optional deps = #4828 family; >11.12.1 refuses the git dep =
EALLOWGIT). **That pin lives only in `publish.yml`** — local electron builds and
non-publish CI use the machine's npm, so a dev on a newer npm hits EALLOWGIT in
the electron build directly.

pnpm resolves BOTH horns: it installs git deps **without any EALLOWGIT refusal**,
and resolves platform optionaldeps correctly per-platform (kills #4828 at the
class level). It thus collapses the entire fragile-npm-version tightrope in
Column A. This is a materially stronger driver than #4828 alone.

## What changes

- **Column A → pnpm.** `packageManager: "pnpm@<x>"` + `corepack enable`;
  `package-lock.json` → `pnpm-lock.yaml` + `pnpm-workspace.yaml`; convert
  `npm ci`/`npm install`/`npm run -w`/`npm link` in CI, Dockerfile, root
  scripts, and the `.pi/settings.json` `worktreeInit` hook.
- **Column B stays npm.** `publish.yml` keeps `npm publish --workspace=… --provenance`
  with **OIDC Trusted Publisher** (tokenless). pnpm publish exists but OIDC +
  provenance attestation is an npm-CLI feature — no upside to moving, real
  downside (lose tokenless publish / provenance).
- **Column C stays npm — intentionally, documented.**
  `packages/server/src/pi/pi-core-updater.ts`,
  `packages/server/src/pi/pi-core-checker.ts`,
  `packages/server/src/lifecycle/recovery-server.ts`,
  `packages/electron/src/lib/update-checker.ts` (`npm.installGlobal`/`npm.install`),
  and all user-facing `npm install -g …` hint strings target the **user's**
  machine. (`bundle-server.mjs` is NOT Column C — it is Column A/build-time; its
  internal `npm install` runs on the build machine, see the electron trace below.)
  `npm` ships inside Node.js (universally present); pnpm does not. Swapping these
  would break users who never ran `corepack enable`. This is the hard wall that
  makes "pnpm **everywhere**" impossible; "pnpm for dev/CI" is the real ceiling.

## Non-goals

- Removing npm from the mental model. The runtime *requires* npm; a two-PM repo
  is the accepted end state, not drift.
- Touching the publish OIDC/provenance flow.
- Making the shipped runtime package-manager-agnostic (separate, larger effort).

## Alternatives considered (the #4828 fix ladder)

1. **Keep the `rm -f package-lock.json` hack** (status quo). Cost ~0; no
   reproducible install in that layer. Fixes one instance, not the class.
2. **Pin platform optionaldeps via npm `overrides`.** Low cost; manual
   per-platform maintenance.
3. **`npm install` + regenerate lock per-platform in a CI matrix.** Low cost;
   still npm's flaky resolution — band-aid.
4. **pnpm for dev/CI (this proposal).** High cost; only option that fixes the
   *class* + gives faster/smaller installs. Chosen direction pending risk review.

If the appetite for the migration cost is low, **option 2** is the recommended
smaller fix and this change should be declined.

## EALLOWGIT / git-dep caveats

- pnpm does NOT refuse git-protocol deps — no EALLOWGIT concept. But pnpm v10+
  blocks dependency **lifecycle/build scripts** by default
  (`onlyBuiltDependencies` / `pnpm approve-builds`). Native rebuild
  (`@electron/rebuild`, `node-gyp`, `node-pty`) needs those scripts → must be
  allowlisted once in `package.json`. Trades an EALLOWGIT wall for a one-time
  build-script allowlist.
- The **publish job (Column B) keeps npm** for OIDC and thus keeps the 11.12.1
  pin. pnpm removes EALLOWGIT/#4828 from dev + local-electron + Docker +
  non-publish CI (Column A) only. Net: the npm pin shrinks from load-bearing to
  one harmless line in the publish job.

## Empirical spike findings (run 2026-07-20)

Env: Node 24.15.0, npm 10.9.3, pnpm 11.0.8, macOS arm64. All in throwaway temp
dirs; live repo untouched.

| Hypothesis | Result | Verdict |
|---|---|---|
| EALLOWGIT blocks `@electron/node-gyp` git dep | npm 10.9.3 installs it (ssh, exit 0); **pnpm installs via HTTPS codeload tarball** — no ssh key, no git-protocol refusal | pnpm FIXES it (CI-robuster than npm) |
| pnpm build-script gate breaks install | `ERR_PNPM_IGNORED_BUILDS` prints but **exit 0** (non-fatal) | cosmetic |
| node-pty native build fails under pnpm | ships prebuilds; **`require()`+`spawn()` succeed** under pnpm symlink layout despite ignored build | works |
| node-pty needs Electron-ABI rebuild | node-pty is a **server dep** (`packages/server`), runs as a **Node** process; electron pkg has **zero** native runtime deps (`electron-updater`+`shared` only) | Node ABI → prebuilds correct; @electron/rebuild concern ~N/A for the bundle |
| pnpm 11 `onlyBuiltDependencies` allowlist | silenced the gate via **neither** package.json **nor** pnpm-workspace.yaml on 11.0.8 | minor quirk; moot (node-pty works anyway); revisit on 11.15.1 |

**Two biggest fears deflated:** EALLOWGIT is solved by pnpm (not sidestepped),
and node-pty is not a native-compile wall (prebuilt, Node-ABI, loads under pnpm).

**Full-monorepo `pnpm install` spike (git worktree, live repo untouched) — the
decisive findings:**

| Blocker hit (in order) | Root cause | Fix that worked | Cost |
|---|---|---|---|
| `ERR_PNPM_NO_MATCHING_VERSION` (`pi-dashboard-web@^0.6.0` → registry, only 0.5.4 published) | pnpm defaults `linkWorkspacePackages=false`; repo uses plain `^x` (not `workspace:`) + local version (0.6.0) ahead of registry | `linkWorkspacePackages: true` + `preferWorkspacePackages: true` **in `pnpm-workspace.yaml`** | config, 2 lines |
| `ERR_PNPM_EXOTIC_SUBDEP` (`@electron/node-gyp` git dep) | **pnpm's EALLOWGIT-analog**: allows *direct* git deps but blocks *transitive* git subdeps by default | `blockExoticSubdeps: false` | config, 1 line |
| `ERR_PNPM_IGNORED_BUILDS` (node-pty/esbuild/sharp) | pnpm v10+ blocks dep build scripts | `onlyBuiltDependencies` list; **non-fatal anyway** (prebuilds) | config |
| **Client vite build FAILS**: Rollup can't resolve `@blackbelt-technology/dashboard-plugin-runtime` from `client-utils` | **PHANTOM DEPS** — npm's flat hoist masks undeclared imports; pnpm's strict symlink layout exposes them | add missing deps per-package, OR `shamefully-hoist: true` (escape hatch) | ~13 real edges |

**Config-location gotcha:** on pnpm 11.0.8, settings in `.npmrc` and
`package.json#pnpm` were **ignored** — pnpm 11 reads them from
`pnpm-workspace.yaml` (camelCase keys). Every knob above had to go there.

**Phantom-dep inventory — after grounding, collapses to 8 one-line declarations,
NO cycles, NO refactoring.** The initial `grep` count (~13, incl. `shared →
{client-utils, flows-plugin, server, dashboard-plugin-runtime}` "cycles") was
inflated by two false-positive classes: (a) `shared`'s edges are **string
literals inside `packages/shared/src/__tests__/*.test.ts`** (lint-style tests
that assert the *absence* of such imports — `no-server-imports-in-resolver.test.ts`
etc.); `shared` has zero blackbelt deps and imports nothing back. (b)
`client → demo-plugin` is test-only. Real phantom edges + exact fix:

| File | Section | Add (`^0.6.0`) | Reason |
|---|---|---|---|
| `packages/client-utils/package.json` | `dependencies` | `dashboard-plugin-runtime` | 2 src imports |
| `packages/demo-plugin/package.json` | `dependencies` | `dashboard-plugin-runtime` | 1 src import |
| `packages/flows-anthropic-bridge-plugin/package.json` | `dependencies` | `dashboard-plugin-runtime` | 3 src imports |
| `packages/dashboard-plugin-skill/package.json` | `devDependencies` | `dashboard-plugin-runtime` | type-only import |
| `packages/client/package.json` | `dependencies` | `pi-dashboard-automation-plugin`, `pi-dashboard-flows-anthropic-bridge-plugin`, `pi-dashboard-kb-plugin`, `pi-dashboard-roles-plugin` | plugin-catalog imports |
| `packages/client/package.json` | `devDependencies` | `demo-plugin` | test-only import |

6 runtime deps + 2 devDeps across 5 files. `packages/shared` needs nothing.
~30 min, mechanical. This is the LAST known install-layer blocker before
`electron-forge make` can be attempted.

**EALLOWGIT verdict, refined by the spike:** pnpm does NOT eliminate the git-dep
problem — it **converts it from an npm-version tightrope into a config knob**.
npm: only npm 11.12.1 works (11.5.1 drops optionaldeps, >11.12.1 = EALLOWGIT).
pnpm: any version works once `blockExoticSubdeps: false` is set. A one-line
durable config beats pinning an exact npm patch release. Still verified: pnpm
fetches the dep via **HTTPS codeload tarball** (no ssh key, CI-robust).

**Vestigial pnpm cruft (DONE — already removed):** the stale git-tracked
`pnpm-lock.yaml` (182 KB) + placeholder `pnpm-workspace.yaml`
(`allowBuilds: set this to true or false`), referenced by nothing, were deleted
in commit `75ea5dd61` (`chore: remove vestigial pnpm lockfile + placeholder
workspace config`) during the exploration session. `package-lock.json` remains
the live lockfile until §9 of this change swaps it. No further action here.

**Final electron spike — RESOLVED: NO-GO for a drop-in pnpm electron build.**
Applied the 8 workspace phantom fixes in a worktree, then drove the full path.
Results:

- ✅ Web client builds under pnpm (5263 modules, `dist/index.html`) — but only
  with `shamefullyHoist: true`, because phantom deps are a LONG TAIL, not 8.
- **Phantom deps are ~30-40, not 8.** The 8 workspace fixes were necessary but
  insufficient; strict mode then failed on undeclared THIRD-PARTY deps npm
  hoisting masked: `@mdi/js`, `@mdi/react`, `wouter`, `dagre-d3-es`, `react`,
  `yaml`, `jszip`, `@earendil-works/pi-coding-agent`,
  `@blackbelt-technology/pi-anthropic-messages`, plus a large test-only set
  (`vitest`, `@testing-library/react`) per package. Either declare them all
  (multi-hour audit) or ship `shamefullyHoist: true` (escape hatch, forfeits
  pnpm's strictness benefit).
- 🔴 **`pnpm run build` / `pnpm -r build` CRASH** with an internal pnpm error
  (`runDepsStatusCheck` → `execaCoreSync` → `getSyncResult`) on BOTH 11.0.8 and
  11.15.1 — so no workspace TS builds (`server/dist`, `shared/dist`, `kb/dist`
  never produced). Note `pnpm install`-triggered `prepare` scripts DO run; only
  explicit `pnpm run` invocations crash via the pre-run deps-status check.
  Likely fixable with `verifyDepsBeforeRun: false` (untested) — another knob.
- 🔴 **`bundle-server.mjs` GO/NO-GO FAILS under pnpm.** Its `npm install --omit=dev`
  into the synthetic `resources/server/` produced a `node-pty` with an EMPTY
  `prebuilds/` dir (missing all 4 required triples), even though the pnpm store
  has all 6. bundle-server assumes npm's hoisted `node_modules`; pnpm's
  symlinked store breaks its copy/install of node-pty prebuilds. Blocks the
  bundle before `electron-forge` even runs.
- `electron-forge package`/`make` itself was never reached — the two blockers
  above precede it. Native makers (`macos-alias`, `fs-xattr` for DMG) are also
  gated by `ERR_PNPM_IGNORED_BUILDS` (the `onlyBuiltDependencies` allow-list was
  IGNORED in every config location on both pnpm versions — a further quirk).

**Verdict (UPDATED — electron NO-GO → GO, fixes found & verified):** a second spike
drove the full chain to a working `.app`. `electron-forge package` succeeds under
pnpm (`FORGE_EXIT: 0`, `PI-Dashboard.app` 554M containing the server bundle with
all 6 node-pty prebuild triples). Each blocker had a concrete fix:

| Blocker | Fix | Verified |
|---|---|---|
| `pnpm run build` crash (runDepsStatusCheck) | `verifyDepsBeforeRun: false` | ✅ `pnpm -r build` exit 0 |
| bundle-server node-pty empty prebuilds | `cpSync` `filter: (src)=>!src.split(path.sep).includes('node_modules')` in bundle-server.mjs (pnpm copies broken store symlinks; npm-safe fix) | ✅ all 6 triples, bundle exit 0 |
| electron-forge refuses pnpm | `nodeLinker: hoisted` (forge's own check demands it; also resolves THIRD-PARTY phantom deps) | ✅ forge package exit 0 |
| workspace phantom deps (client build) | the 8 package.json declarations (NOT auto-hoisted even under hoisted linker) | ✅ client 5264 modules |
| git subdep / workspace linking | `blockExoticSubdeps:false`, `linkWorkspacePackages:true` | ✅ |

**Complete electron-capable pnpm-workspace.yaml:** `nodeLinker: hoisted`,
`verifyDepsBeforeRun: false`, `blockExoticSubdeps: false`,
`linkWorkspacePackages: true`, `preferWorkspacePackages: true`,
`confirmModulesPurge: false`, `onlyBuiltDependencies:[node-pty,esbuild,sharp,electron]`.
Plus the bundle-server.mjs cpSync filter + the 8 workspace phantom-dep declarations.

**Still owed (smaller):** (a) `electron-forge make` (DMG/deb/appimage installers)
needs native makers `macos-alias`+`fs-xattr` built, which the pnpm build-script
gate blocks (`onlyBuiltDependencies` proved unreliable on pnpm 11.0.8 AND
11.15.1) — use `pnpm rebuild macos-alias fs-xattr` or `pnpm approve-builds`.
`package` (tested) works; only the installer `make` layer is unverified.
(b) `patch-package` → `pnpm patch` — note patch-package DID apply cleanly in the
spike's postinstall, so may not be needed. (c) With `nodeLinker: hoisted` pnpm's
strictness benefit is forfeited (flat like npm) — you keep pnpm's speed/dedup/
content-store + the EALLOWGIT config-knob win, but lose phantom-dep enforcement.

**Recommendation (revised):** the electron path is viable under pnpm with the
recipe above — no longer a reason to keep electron on npm. But note `nodeLinker:
hoisted` means the whole repo runs npm-flat semantics, so the payoff narrows to:
EALLOWGIT/#4828 as durable config (vs npm-version pin) + install speed/dedup.
Weigh that against the migration surface (Docker, CI, ~7 skills, the 8 phantom
decls, bundle-server patch, native-maker rebuild step).

## Risks / open questions

- **Native modules under pnpm's strict symlink layout** — `node-pty`,
  `macos-alias`, `appdmg`, and **electron-forge** are the fragile kind. Likely
  needs `node-linker=hoisted` or `shamefully-hoist=true`, which claws back some
  of pnpm's disk/speed benefit. **This is the primary risk; spike it first.**
- **patch-package migration** — postinstall runs `patch-package`
  (`patches/@pengx17+electron-forge-maker-appimage+1.2.1.patch`). pnpm's
  idiomatic path is `pnpm patch` + `patchedDependencies`; needs conversion +
  re-verify the appimage maker patch still applies.
- **`.npmrc` semantics** — `engine-strict=true` is read by pnpm but
  `node-linker`/hoisting semantics differ; audit needed.
- **Skill/doc surface** — `ci-troubleshoot`, `ship-change`, `ship-it`,
  `release-pipeline`, and the `worktreeInit` hook all hard-code
  `npm ci` / `npm install --package-lock-only`. All need updating in lockstep or
  the lockfile-heal instructions become wrong.
- **Electron `bundle-server.mjs` — RESOLVED: Column A (build-time, movable).**
  Called only by `package.json:electron:bundle-server`, `forge.config.ts`, and
  `_electron-build.yml` — all on the build machine / CI runner. Its
  `npm install --omit=dev` materializes `resources/server/node_modules/` INTO
  the `.app`; the shipped app has a pre-installed runtime and does **no**
  user-machine install (change `eliminate-electron-runtime-install` deleted the
  old `/api/pi-core/update` in-place upgrader in favor of electron-updater
  whole-`.app` replacement). **Caveat: this is the single highest-risk file for
  the migration** — it is the native-module cross-compile path (`node-pty`
  prebuilds via `npm_config_target_arch`, `--omit=dev`, across 6 platform/arch
  tuples) and is designed to fail the build on missing prebuilds
  (`eliminate-electron-runtime-install` task 1.1.k). The pnpm spike MUST pass
  here. Note `_electron-build.yml` uses `--source-only` to skip this install on
  cross-platform CI jobs, so it truly runs only on native-arch builds.
- **Electron runtime install IS elsewhere (Column C, stays npm):**
  `packages/electron/src/lib/update-checker.ts:95-100` → `npm.installGlobal` /
  `npm.install` runs on the **user's** machine to update pi-coding-agent for
  npm-global layouts. The electron path splits cleanly: build = A
  (bundle-server), runtime = C (update-checker).

## Recommendation

Split is coherent and the pain (#4828 + install speed/disk) is **real but
modest**. Because Column C permanently keeps npm, the "one tool to rule them all"
simplification never materializes — so this is justified *only if* CI
install-time/disk or the #4828 hack is a felt, recurring cost. Gate on a
**native-modules-under-pnpm spike** before committing.
