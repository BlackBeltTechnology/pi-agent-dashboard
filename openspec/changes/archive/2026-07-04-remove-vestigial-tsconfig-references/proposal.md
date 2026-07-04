# Remove vestigial TypeScript project `references` from package tsconfigs

## Why

Five package tsconfigs declare TypeScript project references to `../shared`:

- `packages/client/tsconfig.json`
- `packages/server/tsconfig.json`
- `packages/extension/tsconfig.json`
- `packages/dashboard-plugin-runtime/tsconfig.json`
- `packages/dashboard-plugin-skill/tsconfig.json`

All five were added in a single commit — `8ce152ca feat: restructure into npm workspaces monorepo` — as conventional monorepo scaffolding, but the machinery was never wired up. Project references require every referenced project to set `"composite": true` and to be built with `tsc -b` (build mode). **No tsconfig in the repo sets `composite`, and nothing runs `tsc -b`.** So the references have never been functional.

They are not merely inert — they are an active footgun. Pointing `tsc` at any of these configs in single-project mode triggers a hard error:

```
$ npx tsc --noEmit -p packages/extension
packages/extension/tsconfig.json(8,5): error TS6306:
  Referenced project '.../packages/shared' must have setting "composite": true.
```

This is what a contributor hits the moment they try to type-check one package in isolation.

### Confirmed: the references are load-bearing for nothing

| Concern | Do the refs matter? | Evidence |
|---|---|---|
| Canonical type-check (`npm run lint` = `tsc --noEmit`, root) | No | Root `tsconfig.json` has no `references`; it `include`s `packages/*/src` as one flat program. |
| Build (`tsc -b` / build mode) | No | `grep -rn 'tsc -b\|--build'` across `package.json`, package scripts, `scripts/`, `.github/` → zero hits. |
| Module resolution (`shared` imports) | No | `shared`'s `package.json` has no `main`/`types` and no build; its `exports` map points `./*.js → ./src/*.ts`. Consumers (`moduleResolution: "bundler"`) resolve straight to TS source. Project references resolve to a built `dist`/`.d.ts` that does not exist. |
| Runtime | No | Server/extension run via jiti, client via Vite; neither reads tsconfig `references`. |
| **Triggering TS6306 on `tsc -p <pkg>`** | **Yes** | This is the references' only observable effect. |

The root flat compile is the source of truth. With dependencies installed it is green (`npx tsc --noEmit` → exit 0 in the main repo). Verification compares the error set before and after removal for **no new errors** rather than asserting a bare exit 0 — a fresh OpenSpec worktree without `npm install` resolves wrong transitive dependency versions and emits unrelated errors (e.g. `image-fit-extension`/jimp), so `npm install` is a precondition and the gate is no-new-errors-vs-baseline.

## What Changes

- Remove the `references` array from each of the five package tsconfigs listed above.
- No `composite` is added, no `tsc -b` is introduced — the flat root-program type-check stays the single source of truth, exactly as today.
- No source code, build script, runtime path, or module-resolution behaviour changes.

## Capabilities

### Modified Capabilities

- `monorepo-workspace-structure`: adds a Requirement stating package tsconfigs declare no project `references` unless composite build mode is adopted, and that the root flat program is the canonical type-check.

## Impact

- **Type-check behaviour**: unchanged. `npm run lint` / `tsc --noEmit` (root) already ignores per-package `references`; removing them is a no-op for the canonical check.
- **Isolated per-package checks**: `tsc --noEmit -p packages/<name>` stops throwing TS6306. (It still won't cross-resolve `shared` via project references — it never did — but it no longer hard-errors, and the root flat check remains the recommended path.)
- **Risk**: minimal. The refs are proven inert for build, resolution, and runtime. Verification: `npx tsc --noEmit` (root) emits no new errors vs. the pre-change baseline, and `tsc --noEmit -p packages/<name>` no longer raises TS6306 for any of the five edited packages. (Some packages still exit non-zero on pre-existing, unrelated isolated-compile errors — rootDir violations from test imports, missing jsx — that TS6306 previously masked; making packages independently compilable is out of scope. The root flat program stays the canonical green check.)
- **Out of scope**: making project references *real* (adding `composite: true` everywhere + switching to `tsc -b` incremental builds). That is a larger, separately-justified architectural change — explicitly not pursued here.
