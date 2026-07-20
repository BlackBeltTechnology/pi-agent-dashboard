# Design — adopt pnpm for dev + CI

Spike-verified (2026-07-20). Full evidence lives in `proposal.md`; this file
captures the load-bearing decisions and the one non-obvious tension.

## D1 — Single lockfile is `pnpm-lock.yaml`; `npm` survives only as two commands

The three npm roles (proposal Column A/B/C) do NOT each need their own lockfile.
The repo keeps ONE lockfile (`pnpm-lock.yaml`) and deletes `package-lock.json`.
npm survives only as:

- **Column B (publish):** `pnpm install && pnpm run build && npm publish …`. The
  OIDC Trusted-Publisher + `--provenance` attestation lives on the `npm publish`
  command, which does NOT require an npm-installed tree — pnpm does the install,
  npm only packs+publishes. So OIDC is preserved without a second lockfile.
- **Column C (runtime):** unaffected by the repo lockfile — `pi-core-updater.ts`,
  `recovery-server.ts`, `update-checker.ts` run `npm install` on END-USER
  machines against the public registry. Stays npm (npm ships in Node).

This resolves the apparent "two package managers need two lockfiles" tension:
they don't. One `pnpm-lock.yaml`; `npm publish` + user-machine installs are the
only npm survivors.

## D2 — `nodeLinker: hoisted` is mandatory (electron-forge), and it reshapes the tradeoff

electron-forge's own preflight HARD-FAILS unless `node-linker` is `hoisted`
(spike: `✖ When using pnpm, node-linker must be set to "hoisted"`). Adopting it:

- makes `node_modules` flat (npm-like), so **third-party** phantom deps
  (`@mdi/js`, `wouter`, `dagre-d3-es`, `react`, `yaml`, `jszip`, `vitest`,
  `@testing-library/react`, …) resolve automatically — no per-package audit.
- does NOT auto-resolve **workspace** phantom deps → the 8 explicit
  `package.json` declarations are still required (see D3).
- FORFEITS pnpm's strict-isolation benefit. Net remaining payoff:
  EALLOWGIT/#4828 become a durable config knob (vs the fragile npm@11.12.1 pin)
  + pnpm's content-addressed store speed/dedup. Phantom-dep *enforcement* is
  NOT a benefit under hoisted linker.

Decision: accept `nodeLinker: hoisted`. The alternative (default isolated
linker) is a non-starter — electron-forge refuses it.

## D3 — The two phantom-dep classes

| Class | Count | Fix | Auto-resolved by hoisted linker? |
|---|---|---|---|
| Workspace (`@blackbelt-technology/*`) | 8 edges | explicit `package.json` deps | ❌ no — must declare |
| Third-party | ~20-30 | none needed | ✅ yes |

Exact 8 workspace declarations enumerated in `tasks.md` §3. `packages/shared`
needs none (its apparent edges are test-fixture string literals).

## D4 — `bundle-server.mjs` cpSync filter (code change, npm-safe)

`bundle-server.mjs` copies each workspace/plugin package with `cpSync(..., {recursive,
dereference:false})` and no filter (verified: THREE such loops — workspace ~L89,
plugins ~L134, web-pkg ~L515; the dist-only client copies ~L154/~L519 need no
filter). Under pnpm, `packages/*/node_modules` are symlinks into the `.pnpm`
store; copied verbatim they become broken links that make the bundle's own
`npm install` skip node-pty → empty `prebuilds/` → the GO/NO-GO guard fails.
Fix: a `node_modules`-excluding filter using a **Windows-safe** split
(`src.split(/[\\/]/).includes("node_modules")` — NOT `path.sep`, which is `\` on
win32 exactly where node-pty prebuilds are load-bearing). Correction to the first
spike's note: this is NOT a no-op under npm — `packages/server/node_modules`≈288K,
`packages/extension/node_modules`≈808K hold non-hoisted deps, so the filter forces
a clean re-resolve. That is the INTENDED behavior (a clean bundle install), but
the npm-path bundle must be re-verified after the change, not assumed unchanged.

## D5 — Native-maker builds need `pnpm rebuild`, not the allow-list

`onlyBuiltDependencies` proved UNRELIABLE on pnpm 11.0.8 AND 11.15.1 (build
scripts stay ignored). node-pty is unaffected (prebuilt). But `electron-forge
make` (DMG/deb/appimage) needs `macos-alias` + `fs-xattr` compiled → run
`pnpm rebuild macos-alias fs-xattr` explicitly in the electron build step.
`electron-forge package` (the `.app`) needs no makers and is fully spike-proven;
`make` is verified-pending.

## D6 — Rollout order (reversible checkpoints)

Config + phantom decls + cpSync filter first (local `pnpm install` +
`electron-forge package` green), THEN CI, THEN Docker, THEN — **gated on
`electron-forge make` (T5) being green, not just `package`** — delete
`package-lock.json` + flip publish. Each phase independently revertible until the
lockfile swap; the swap is the point of no easy return, so it MUST NOT precede a
proven installer build. `pnpm` pinned via `packageManager` field + `corepack`.

Coverage note (doubt-review): the npm→pnpm surface is wider than the four skills
first listed — it also includes the `release-cut` skill (primary release trigger),
`scripts/verify-lockfile-versions.mjs` (JSON→YAML rewrite), `scripts/sync-versions.js`
(dev message), every workflow's `actions/setup-node` `cache: npm`, and the
lockfile-regen in `_electron-build.yml` (not just `publish.yml`). See tasks §6/§10.

## Out of scope

- Moving Column C (user-machine installs) off npm.
- `nodeLinker: isolated` / restoring strict phantom-dep enforcement.
- Verifying `electron-forge make` installers (tracked as a follow-up task, D5).
