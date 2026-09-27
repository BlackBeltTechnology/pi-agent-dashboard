## Context

The root package is a meta-package. Its `bin` (`packages/server/bin/pi-dashboard.mjs`) runs the root tarball's **own copy** of `packages/server/src/cli.ts`. That copy is not the copy inside the installed `@blackbelt-technology/pi-dashboard-server`. Bare imports in the copied sources therefore resolve from the root's `node_modules`. They resolve today because npm hoists the dependencies of the root's workspace dependencies (checked on a global 0.8.0 install: `pi-dashboard-server/node_modules` is empty and everything is hoisted).

The measured baseline was taken on `develop`, with an unbuilt tree and an empty allowlist. The full rules applied to the root give 2023 findings: 1424 in 934 shipped test files, and 599 production imports declared by their own workspace (487 `dev-only-import` because the root lists `pi-dashboard-shared` as a devDependency, plus 99 `undeclared-import`). A second measurement gave 1987, 1398 and 589 on a later tree; the structure is the same. To reproduce it, run `analyzeWorkspace(rootPackage(), packEntryFiles(npm pack --dry-run --json, name), { allowlist: [] })` at the repository root.

## Decisions

1. **Reachable-workspace credit, not root-manifest mirroring and not delegation.**
   - For a root-shipped file at `packages/<dir>/…`, `declared` is the union of two sets:
     - the root's runtime dependencies;
     - the runtime dependencies of `packages/<dir>/package.json`, but only when that workspace's `name` is in the reachable set.
   - `devOnly` is the union of the root's and the owning workspace's `devDependencies`, minus `declared`. A dependency that is dev-only everywhere is still reported as `dev-only-import`, and a credited dependency is never misreported as dev-only.
   - The reachable set is the closure over `RUNTIME_FIELDS` of workspace-name dependencies, starting from the root's runtime dependencies. It follows only names that resolve to a `packages/*` workspace in this repo, and the traversal is cycle-safe.
   - Rejected alternatives:
     - Mirroring every workspace dependency into the root manifest adds drift and a sync script.
     - Making the bin delegate to the installed server package is structurally better, but it is a larger change to the install and Electron paths. It is left for a possible future change.
2. **The credit is explicit.** A code comment names the hoisting reliance. The checker summary line reports how many root imports were satisfied by reachable-workspace credit.
3. **Exclusions are scoped to `packages/**` and placed after the includes.**
   - The root `files` list gains, **after all includes**, the following negations:
     - `!packages/**/__tests__`, `!packages/**/__fixtures__`, `!packages/**/__mocks__`;
     - `!packages/**/*.test.*`, `!packages/**/*.spec.*`;
     - `!packages/**/AGENTS.md`, `!packages/**/*.AGENTS.md`.
   - The root's set is intentionally stricter than the workspaces' (`__fixtures__`, `__mocks__` and `*.spec.*` are also excluded). The root is a copy for running, not a source distribution.
   - `files` negation is order-sensitive in npm-packlist. A negation listed before an include does not exclude. A comment-free JSON array cannot carry that warning, so the ci-level packed-set scenario is the guard. It runs on CI's npm, which is the npm that publishes.
   - A bare `!**/AGENTS.md` would also drop the explicitly listed root `AGENTS.md`, which ships on purpose.
   - If an exclusion removes a file that production code imports, the dangling-relative rule catches it.
4. **Remove `tsconfigOnly`.** `rootPackage` returns a normal workspace record, and `analyzeRepository` runs `analyzeWorkspace` and `verifyDeclaredRanges` on it like on any other workspace.
5. **`packages/dist/` in the root gets no credit and no skip.**
   - The root ships `packages/dist/` as bundle output. The electron and server layout copies the client there as `dist/client`; it is not the web package's own Vite output. Nothing proves it is byte-identical to `pi-dashboard-web` `dist/`.
   - It has no workspace manifest, so the credit cannot apply, and any bare import in a bundle is a real consumer break.
   - CI's existing check runs on an unbuilt tree (`ci.yml:74`, before the build at `:145`). `ci.yml` gains a second `node scripts/verify-published-imports.mjs` step after the build, so the bundle is checked on every PR. This costs about 20 s against the job budget. Whatever the first built-tree run surfaces is triaged during apply.
   - A skip was considered and rejected. It would ship unchecked bytes by construction.
6. **Allowlist keying for the root.** Root entries use `workspace: "."` (the root `rel`) or the root package name. An entry keyed `packages/server` does not apply to the root's copy of the same file. This is the existing semantics, stated here so nobody is surprised.

## Risks

- **Runtime reads of excluded files from an installed root.** Mitigations:
  - the dangling-relative rule after exclusion;
  - the existing standalone install smoke (`scripts/test-standalone-npm-install.sh`, run in the `publish.yml` gate). It installs the packed root tarball with all workspace tarballs, boots `pi-dashboard`, and polls `/api/health`, which exercises both the static graph of `cli.ts` and the dynamically imported server graph. It gains an assertion that no excluded path is installed.
  - `--version` is not used, because it short-circuits before jiti; `status` is not used, because it exits 1 with no server and consults the global PID file and mDNS. The smoke is a release gate, not a per-PR check; the per-PR guard is the ci-level packed-set scenario.
- **The reachable credit masks a real gap.** It is computed from the local workspace manifests. At install time npm hoists the dependencies of the published server version that `^<version>` resolves to, and it may nest one on a version conflict. Releases are lockstep (sync-versions), so same-version manifests match. A newer patch of a workspace that adds a dependency is covered by that patch's own publish. This is accepted as a known limit and named in the checker comment. The structural fix is delegating to the installed server package.
- **`verifyDeclaredRanges` on the root** may emit `unverifiable-range` warnings for the uninstalled peers (`@mariozechner/*`) and the uninstalled optional dependency (`appdmg`). These are warnings only, by existing design, and do not gate.
- **Extractor blind spot (existing, out of scope; follow-up).** `require.resolve()` specifiers are not extracted. Root-shipped `scripts/fix-pty-permissions.cjs` resolves `node-pty`, and `scripts/maybe-patch-package.cjs` resolves `patch-package`. Both are runtime-guarded no-ops, and "0 findings" holds only modulo this.
- **Runtime budget.** The root analysis adds a TypeScript parse of about 550 root production files, which the tsconfig-only path skipped. This is measured against P1 (120 s) during apply, not assumed.
