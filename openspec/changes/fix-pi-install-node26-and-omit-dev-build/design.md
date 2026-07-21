## Context

Issue #357: `pi install git:github.com/BlackBeltTechnology/pi-agent-dashboard` fails at two
independent points on a fresh machine, both still present in released `0.6.1`.

- pi installs extensions via `npm install --omit=dev` with engine-strict.
- Root `package.json#engines.node` caps `>=22.19.0 <26`; the single-source predicate
  `packages/shared/src/node-version.ts::isOutOfEnginesRange` mirrors it (`major >= 26`). The server
  startup guard (`node-guard.ts`), the Electron doctor (`dependency-detector.ts`), and their tests
  all track that predicate via a documented lockstep contract.
- The published npm tarball ships prebuilt `packages/dist/client` and does NOT run any workspace
  `prepare` on consumer install, so the npm path is unaffected by the build blocker. The git-clone
  path clones source (dist is gitignored), runs every workspace `prepare`, and the
  `@blackbelt-technology/pi-dashboard-web` `prepare` runs a Vite build.

Current build-time resolution of the client:
- `packages/client/scripts/vite-build.mjs` `import { register } from "tsx/esm/api"` then
  `require.resolve("vite/package.json")`.
- `packages/client/vite.config.ts` imports `@vitejs/plugin-react` and `@tailwindcss/vite`;
  `src/index.css` does `@import "tailwindcss"`.
- `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss` are client `devDependencies`.
- `tsx` is NOT a client dep; it currently resolves only because `packages/server` declares `tsx` as a
  runtime `dependency` and npm hoists it to the root `node_modules`.

## Goals / Non-Goals

**Goals:**
- `pi install git:...` succeeds on Node 26 without `--engine-strict=false`.
- `npm install --omit=dev` on a fresh checkout completes the client `prepare` Vite build with no
  manual dev-dependency install.
- Node 26 is CI-validated, not merely asserted.
- The Node-version single-source + lockstep contract is preserved (only `node-version.ts` +
  `package.json#engines` encode the cap).

**Non-Goals:**
- Node 27+ support (left refused until separately validated).
- Shipping prebuilt client assets into git, a server-side lazy build, or removing the client
  `prepare` build.
- Changing the `packages/server` or root `tsx` dependency roles.

## Decisions

### D1 — Raise the engines cap one major (`<26` → `<27`), not remove the upper bound

Bumping to `<27` keeps the "cap = highest CI-validated major + refuse beyond" invariant the codebase
already relies on. Removing the bound entirely would silently admit every future major untested,
defeating the server startup guard's purpose. The cap changes in exactly two places
(`package.json#engines.node` and `node-version.ts::isOutOfEnginesRange` `major >= 26 → >= 27`); every
consumer + test tracks it through the existing single-source contract.

_Alternative considered:_ open-ended `>=22.19.0`. Rejected — turns the refuse-to-start guard into a
no-op for future majors and contradicts the spec's cap-history rationale.

### D2 — Validate Node 26 in CI before the cap lands

Add a Node 26 leg to the `_smoke.yml` linux install matrix (and the `ci.yml` lockstep major list the
`server-startup-node-version-guard` spec enforces). The cap raise is contingent on that leg passing —
if Node 26 surfaces a real incompatibility (Fastify, native deps), the change is blocked rather than
shipping a broken cap. `isAffectedNode` needs no change (Node 26 is outside the Fastify-affected
range).

### D3 — Declare the client's direct build deps as runtime `dependencies`

Move `vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss` from client `devDependencies`
→ `dependencies`, and add `tsx` to client `dependencies`. Rationale: `--omit=dev` omits
`devDependencies`; the direct build-time requirements must therefore be runtime deps of the package
that runs the build. `tsx` is declared explicitly on the client (the package whose
`vite-build.mjs` imports it) instead of relying on the fragile hoist of the `packages/server` `tsx`
dep — hoisting can break on a version conflict and is an undeclared cross-workspace coupling.

_Alternative considered:_ (a) ship prebuilt assets in git — rejected (build artifacts in VCS). (b)
server-side lazy build — rejected (larger surface, needs build deps at runtime anyway). (c) guard
`prepare` to no-op + document a manual full install — rejected (leaves the reported command broken;
the issue asks for it to "just work").

### D4 — Lockstep guard so the deps don't silently regress

Add `scripts/verify-release-deps.mjs` rules asserting the 5 client build deps live in
`dependencies` (mirrors the existing `tsx`/`openspec` rules). A future refactor moving any back to
`devDependencies` would silently re-break git-install; the guard fails the release instead.

## Risks / Trade-offs

- **[Consumer install bloat]** → `@blackbelt-technology/pi-dashboard-web` now pulls `vite` +
  tailwind + tsx as runtime deps. Mitigation: the published root-package global install ships
  prebuilt `dist/` and never runs `prepare`, so the end-user CLI install is unchanged in behavior;
  the extra weight lands only when the web workspace itself is installed (the git path, which needs
  them anyway). Accepted per planning decision.
- **[Node 26 real incompatibility]** → surfaced by the CI smoke leg (D2); blocks the cap raise rather
  than shipping broken. Rollback = revert the two cap lines.
- **[Hoist behavior masking the fix]** → because `tsx` already hoists from server today, an
  `--omit=dev` build might appear to pass without the client `tsx` dep. Mitigation: the L2 test runs a
  clean `npm install --omit=dev` from a pristine checkout and asserts `packages/client/dist/index.html`
  exists; the `verify-release-deps` rule (D4) independently asserts the explicit declaration.

## Migration Plan

1. Land the client `package.json` deps move + `tsx` add; refresh `package-lock.json`.
2. Add the Node 26 CI smoke leg; confirm green.
3. Raise the cap (`package.json#engines.node` + `node-version.ts`), update node-version tests.
4. Add the `verify-release-deps` rules.

Rollback: revert the two cap lines (Node 26 support) and/or restore the client deps to
`devDependencies` (git-install build) — independent, either can roll back alone.

## Open Questions

None — direction confirmed with the maintainer (both blockers in one change; cap → `<27` after CI
validation; move build deps to `dependencies`).
