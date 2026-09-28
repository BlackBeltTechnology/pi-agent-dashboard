## Why

`fix-ship-tsconfig-base` (PR #726) brought the root meta-package `@blackbelt-technology/pi-agent-dashboard` into the publish check, but for tsconfig `extends` only. Running the full import rules on it produces 2023 findings. The breakdown was measured on `develop`:

- **1424 come from shipped test files.** The root `files` list ships 934 `__tests__` / `*.test.*` files, which is 7.6 MB of the 14.3 MB unpacked tarball (53%). The server, shared and extension workspaces exclude these files with `!**/__tests__`, `!**/*.test.ts` and `!**/*.test.tsx`; the root does not. The shipped tests are also the source of every dangling relative import (into `client/`, `qa/` and `scripts/`, none of which are shipped).
- **599 are production imports declared only by their own workspace.** Most of them are `dev-only-import`, because the root lists `@blackbelt-technology/pi-dashboard-shared` in `devDependencies` only; server and extension declare it at runtime, which is why it resolves today. The rest are `undeclared-import`: for example, the root's copy of `packages/server/src` imports `fastify`, which `@blackbelt-technology/pi-dashboard-server` declares but the root does not. A reviewer's re-measurement on a later tree split production findings as 487 dev-only, 99 undeclared and 3 tsconfig, out of 589. The root's `pi-dashboard` bin runs its own copy of the source, so these imports resolve only because npm hoists the workspace dependencies next to the root. The check currently cannot tell this reliance apart from a real undeclared import.
- **0 are undeclared anywhere, and 0 are dangling in production code.**

## What Changes

- **The root tarball stops shipping tests, fixtures and DOX sidecars.** The root `files` list gets exclusions scoped to `packages/**` and placed after every include: `__tests__`, `__fixtures__`, `__mocks__`, `*.test.*`, `*.spec.*`, `AGENTS.md` and `*.AGENTS.md`. The root `AGENTS.md` still ships. This cuts about 1238 files and 7.8 MB unpacked.
- **The checker models the meta-package explicitly.** A root-shipped file under `packages/<dir>/` also counts as declared anything in the runtime dependencies of that directory's workspace. This applies only when that workspace is **reachable** from the root's runtime dependencies through workspace-to-workspace runtime dependencies. `pi-dashboard-shared` is reached through server and extension; it is not a direct root dependency. A workspace that is shipped but unreachable gets no such credit, and its imports are reported. The rule is named in the checker as reliance on hoisting, so it is an explicit and visible exception rather than a silent pass.
- **The `tsconfigOnly` special case is removed.** The root package gets the full rule set: undeclared, dev-only and dangling-relative imports, tsconfig `extends`, and declared-range verification. The core "declared in its own manifest" requirement gains the explicit meta-package exception.
- **Root-shipped `packages/dist/` is analyzed with no workspace credit.** It is bundle output with no workspace manifest, so any bare import there is a real consumer break. CI's existing check runs before the build (`ci.yml:74` vs `:145`), so `ci.yml` gains a second `verify-published-imports` run after the build. That makes the check cover the bundle on every PR.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `publish-correctness-verification`: the full rule set applies to the root package. It gains the reachable-workspace credit for meta-package-shipped sources. The "root tsconfig-only" requirement is replaced.
- `packaging`: the root tarball excludes test files, fixtures and per-file DOX sidecars under `packages/`.

## Discipline Skills

- `doubt-driven-review`: changing the root `files` list affects what every npm install receives, and a published tarball is irreversible. The exclusion set was reviewed during planning, with a same-model and a cross-model reviewer.
- `review-code`: before commit, per project doctrine.
- None of `security-hardening`, `performance-optimization` or `observability-instrumentation` applies. There is no auth or untrusted input, no latency budget, and no new endpoint or job. The tarball-size reduction is a side effect, not a performance target.

## Dependencies

- Requires `fix-ship-tsconfig-base` (PR #726) to be merged. It introduces `rootPackage`, `tsconfigOnly`, `packEntryFiles(parsed, name)` and `tsconfigExtendsFindings`, all of which this change builds on.

## Impact

- `package.json` (`files`), `.github/workflows/ci.yml` (post-build check run), `scripts/verify-published-imports.mjs` (including the stale "~250 findings" `rootPackage` docstring from #726), `scripts/__tests__/verify-published-imports.test.mjs`, `CHANGELOG.md`, and the `scripts/` DOX sidecars.
- Published root tarball: about 1238 fewer files (934 tests plus about 300 DOX sidecars) and about 7.8 MB less unpacked. There is no runtime code change.
- CI: the publish check packs the root package once, as it already does since #726. It now also parses about 550 root production files. The effect on the P1 budget (120 s) is measured during apply.
- Compatibility: nothing at runtime should read test files or sidecars from an installed root package. This is verified by the existing standalone install smoke (`scripts/test-standalone-npm-install.sh`, the `publish.yml` gate). It installs the packed tarballs, starts the server, and polls `/api/health`, which covers both the static and the dynamically imported server graph. It gains an assertion that no excluded path is installed. `--version` short-circuits before jiti, and `status` depends on the global PID file and mDNS, so neither would prove it.
- Rollback: revert the commit. For a release already published with a broken exclusion, cut a patch release restoring the `files` entries.
