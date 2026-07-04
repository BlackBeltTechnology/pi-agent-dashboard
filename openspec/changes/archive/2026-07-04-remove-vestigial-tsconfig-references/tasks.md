# Tasks

## 1. Remove vestigial references

- [x] 1.1 Ensure deps are installed (`npm install` — a bare OpenSpec worktree has no `node_modules`, which makes `tsc` resolve wrong transitive versions and emit spurious errors). Then capture the baseline: run `npx tsc --noEmit` from repo root and record the exact error set (currently 0 errors in the installed main repo; whatever it is, that is the baseline).
- [x] 1.2 Delete the `references` array from `packages/client/tsconfig.json`.
- [x] 1.3 Delete the `references` array from `packages/server/tsconfig.json`.
- [x] 1.4 Delete the `references` array from `packages/extension/tsconfig.json`.
- [x] 1.5 Delete the `references` array from `packages/dashboard-plugin-runtime/tsconfig.json`.
- [x] 1.6 Delete the `references` array from `packages/dashboard-plugin-skill/tsconfig.json`.

## 2. Verify

- [x] 2.1 Run `npx tsc --noEmit` from repo root; confirm the error set is identical to the 1.1 baseline (no new errors introduced). The canonical flat check already ignores per-package `references`, so removal must be a no-op for it.
- [x] 2.2 Run `npx tsc --noEmit -p packages/<name>` for all five edited packages (`client`, `server`, `extension`, `dashboard-plugin-runtime`, `dashboard-plugin-skill`); confirm **TS6306 no longer appears** in any output (the spec contract). Note: `client`/`server`/`extension` still exit non-zero on **pre-existing, unrelated** isolated-compile errors (TS6059 rootDir from test files importing cross-package/`qa/` fixtures, TS6142 missing jsx, TS18046 `any` typing) that TS6306 previously masked by aborting the compile early. Making those packages independently compilable is out of scope — the root flat program remains the canonical green check (2.1).
- [x] 2.3 Sanity-grep that no `references` arrays remain in `packages/*/tsconfig.json`: `grep -l '"references"' packages/*/tsconfig.json` → no output.
- [x] 2.4 Confirm no `composite` / `tsc -b` was introduced (scope guard): `grep -rn 'composite\|tsc -b\|--build' packages/*/tsconfig.json tsconfig*.json package.json` → clean (0 hits; this scope is empty today, so any hit is new).
