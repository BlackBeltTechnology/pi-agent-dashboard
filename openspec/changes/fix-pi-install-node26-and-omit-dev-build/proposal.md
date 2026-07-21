## Why

`pi install git:github.com/BlackBeltTechnology/pi-agent-dashboard` (issue #357) fails at two
independent points, and neither is fixed as of the released `0.6.1`:

1. **Node 26 `EBADENGINE`.** Root `package.json#engines.node` is capped `>=22.19.0 <26`. pi installs
   with engine-strict, so on Node 26 the install aborts before anything runs. This blocks *every*
   pi-install path (npm and git), not just git.
2. **Client `prepare` build fails under `--omit=dev`.** pi runs `npm install --omit=dev`. The
   `@blackbelt-technology/pi-dashboard-web` workspace's `prepare` script runs a Vite build whose
   direct build-time requirements (`tsx`, `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`,
   `tailwindcss`) are declared in `devDependencies` and are therefore omitted — the build dies with
   `Cannot find module 'vite/package.json'`. This blocks the git-clone install path (the published
   npm tarball ships prebuilt `packages/dist/client` and does not run `prepare`, so it is unaffected).

## What Changes

- **Raise the Node engines cap one major: `>=22.19.0 <26` → `>=22.19.0 <27`.** Node 26 becomes a
  first-class, CI-validated target; Node 27+ stays refused (untested). The cap lives once in root
  `package.json#engines.node`, mirrored by the single-source predicate
  `packages/shared/src/node-version.ts::isOutOfEnginesRange` (`major >= 26` → `major >= 27`). The
  server startup guard, Electron doctor, and their tests track it automatically via the existing
  lockstep contract.
- **Add Node 26 to the CI smoke matrices** (`_smoke.yml` linux + the ci.yml lockstep list) so the cap
  raise is validated, not asserted. Matrix `[22, 24, 25]` → `[22, 24, 25, 26]`.
- **Move the client's direct build-time deps to `dependencies`** so `npm install --omit=dev` keeps
  them and the `prepare` Vite build completes: relocate `vite`, `@vitejs/plugin-react`,
  `@tailwindcss/vite`, `tailwindcss` from `devDependencies` → `dependencies` within
  `packages/client/package.json`, and add `tsx` to `packages/client/dependencies` (it is imported by
  `scripts/vite-build.mjs` but only present today via hoisting of the `packages/server` runtime
  `tsx` dep — an implicit, fragile resolution; declaring it explicitly on the package that imports it
  removes the hoist dependency). The root `tsx` devDependency (used by `npx tsx` dev scripts) and the
  `packages/server` runtime `tsx` dependency are left untouched. `package-lock.json` refreshed.

Non-goals: shipping prebuilt client assets in git, a server-side lazy build, or removing the client
`prepare` build. Node 27+ is deliberately left unsupported until separately validated.

## Capabilities

### New Capabilities
- `git-install-omit-dev-build`: The git-clone install path (`npm install --omit=dev` on a fresh
  checkout) SHALL complete the client `prepare` Vite build without a manual dev-dependency install.
  The client's direct build-time requirements SHALL be resolvable under `--omit=dev` (i.e. declared
  as runtime `dependencies`, not `devDependencies`).

### Modified Capabilities
- `server-startup-node-version-guard`: the engines cap moves `<26` → `<27` — Node 26 flips from
  refused to allowed, Node 27 becomes the new refusal boundary, and the CI lockstep matrix gains a
  Node 26 leg.

## Impact

- **Code:** root `package.json` (engines cap only), `packages/client/package.json` (4 build deps
  devDeps→deps + add `tsx`), `packages/shared/src/node-version.ts` (cap arithmetic + doc),
  `package-lock.json`. Optional lockstep guard: `scripts/verify-release-deps.mjs` rules asserting the
  5 client build deps stay in `dependencies`.
- **CI:** `.github/workflows/_smoke.yml` (+`ci.yml` lockstep list) Node matrix gains `26`.
- **Tests:** `packages/shared/src/__tests__/node-version.test.ts` (26 now usable, 27 the new
  boundary); repo-lint that asserts the CI matrix covers every engines-range major.
- **Consumers:** relocating build tooling to `dependencies` adds it to consumer installs of
  `@blackbelt-technology/pi-dashboard-web` (bloat); the published root-package global install still
  ships prebuilt `dist/` and does not run `prepare`. Accepted tradeoff.
