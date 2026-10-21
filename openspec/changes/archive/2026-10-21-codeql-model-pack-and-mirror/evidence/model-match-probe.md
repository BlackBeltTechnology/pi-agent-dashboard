# Model-match probe (2026-10-21) — planning paused here

CodeQL CLI 2.27.2, `codeql/javascript-queries@2.4.7` `javascript-code-scanning.qls`, `--threat-model=remote`, fresh DB per run (`database create --overwrite`), model loaded via wrapper pack (`--additional-packs=<mp> --model-packs=probe/models`, manifest: `library: true`, `extensionTargets: codeql/javascript-all: "*"`, `dataExtensions: ["*.model.yml"]`), standalone `src/` (no node_modules).

| Import specifier | Guard call | Rows tried | `js/path-injection` on guarded sink |
|---|---|---|---|
| `@blackbelt-technology/pi-dashboard-shared/cwd-guard.js` | named `isAllowedCwd(c,…)` | shipped rows (`…/cwd-guard.js` + `…/cwd-guard`) | **reported** |
| same `.js` | namespace `G.isAllowedCwd(c,…)` | + `["@blackbelt-technology/pi-dashboard-shared", "Member[cwd-guard.js].Member[isAllowedCwd]…"]`, `["@…/pi-dashboard-shared", "Member[isAllowedCwd]…"]` | **reported** |
| `@blackbelt-technology/pi-dashboard-shared/cwd-guard` (bare) | named | shipped rows | suppressed |
| `pkg`, `pkg/x` (control) | named | matching rows | suppressed |
| unguarded twin | — | — | reported (correct) |

`codeql resolve extensions` lists `cwd-guard.model.yml` (barrierGuardModel rowCount 8, barrierModel rowCount 2) — the pack loads; only the match fails.

Production imports use the `.js` form everywhere (e.g. `packages/server/src/routes/addons-routes.ts:19`, `folder-project-routes.ts:18`, `mcp-client-plugin/src/core/config-writer.ts:20`). `packages/shared/package.json` exports: `"./*.js": "./src/*.ts"`, `"./*": "./src/*"` (bare → extensionless file, not loadable at runtime). ⇒ the shipped model never applied to any production call site (consistent with archived evidence row g "no observable effect").

Pitfall: re-running `database analyze` on the SAME database with a different model pack reused cached query results (model had no effect) — always recreate the DB per model variant.

Probe sources: `probe-ns-and-named.ts.txt`, `alt.model.yml.txt`.

## Root cause (resolved 2026-10-21)

`codeql/javascript-all@2.10.3` `semmle/javascript/frameworks/data/internal/ApiGraphModelsSpecific.qll:45-50` `parseTypeString`: regexp `('[^']+'|[^.]+)(.*)` — the package name ends at the **first dot** unless the type string is single-quoted. `@blackbelt-technology/pi-dashboard-shared/cwd-guard.js` therefore parses as package `@blackbelt-technology/pi-dashboard-shared/cwd-guard` + type `js` → never matches. Fix: quote the type column: `"'@blackbelt-technology/pi-dashboard-shared/cwd-guard.js'"`. Same defect on `project-name.js` rows.

| Layout | Model | guarded (`.js` import) | unguarded |
|---|---|---|---|
| standalone `src/` | quoted | suppressed (named + namespace) | — (m3 control showed both reported unquoted) |
| mini-monorepo: real `packages/shared/package.json` + `src/cwd-guard.ts` (+ `git.ts`), root `package.json` + `pnpm-workspace.yaml`, probe in `packages/server/src/probe.ts` | shipped (unquoted) | **reported** | reported |
| same | quoted | **suppressed** | reported |

Workspace resolution of the package does not prevent package models from applying. Probe: `probe-monorepo.ts.txt`.

## Open investigation — closed
1. Real-repo resolution → answered above (models apply in the workspace layout).
2. Custom QL → not needed.
3. Bare-subpath exports → not needed.

## Unresolved doubt-review cycle-3 findings (fold in when planning resumes)
- Mirror: require multiset equality of alert start lines vs recorded results for the key (two alerts on one line must not cover two results); bind alert `most_recent_instance.commit_sha` to the recorded run's commit (verify field via fixture).
- Copy model files from HEAD/index (not worktree bytes); run `git ls-files` in the real repo, not `<run>/src`.
- `resolve extensions` output is per-(predicate,file) JSON with `rowCount` — check rowCount per copied file, not "rows listed".
- Probe branch = groups 1–2 + 3.1 only; prune commits strictly after the gate; commit B conditional (likely empty).
- Real-CLI nested `packages/x/spike/` fixture BEFORE the `spike/**` config edit; gate 3.1 on it.
- Record both sides' SARIF pack SHAs in spike evidence; require equality.
- Task 6.1 is not manual-only → track as a follow-up issue, not a tasks.md checkbox (ship-it manifest-aware defer).
- `--json versions.models` needs a MODIFIED "Machine-readable output" delta or drop it.
- Rollback must list all commits (code, prune A, prune B, docs); `GH_BIN` trust model; remote URL forms; legacy run without hash; drop the threat-model rationale in D3.
- Add the test group (argv, wrapper contents, validator accept/reject + baseline sweep, extensions-dir contract test, mirror fixtures/refusals).
