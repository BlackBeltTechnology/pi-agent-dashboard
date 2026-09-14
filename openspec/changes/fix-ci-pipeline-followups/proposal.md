## Why

Four small follow-ups from shipped changes were deliberately left out of the change that found them and have sat as issues since August. Three are truth corrections (a docstring, two source-of-truth specs the doctor skill and future changes consult, a workflow trigger that can never fire) and one is a fail-open guard: the macOS upstream-floor tripwire passes with a `::warning::` when `minos` cannot be extracted at all, which is exactly the silent-disable shape `upgrade-electron-runtime` removed elsewhere (#533, flagged independently by the local review and CodeRabbit).

## What Changes

- **macOS floor canary (#533).** `verify-macos-floor.mjs` keeps the tolerant `::warning::` path for a genuinely novel Mach-O shape, but the build SHALL first assert that the extractor returns at least one `minos` value for the installed Electron prebuilt (`node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`). If the extractor is blind on the binary we KNOW carries `LC_BUILD_VERSION`, the job fails with a message naming the extractor and the sample; the tripwire can no longer die silently. Spec sentence updated to match (option 1 of the issue).
- **`spa404Fallback` docstring (#577).** `packages/shell/vite.config.ts` says Pages serves the shell for any unknown path; on the `/app/` subpath Pages serves the repository-root `404.html` from `site/`. Comment corrected; behaviour is inert under hash routing.
- **Spec corrections (#578).** `ci-cd-pipeline` "CI workflow on push and PR" asserts `npm ci` → `npm run lint` → `npm test` → `npm run build`; the workflow has been `pnpm install --frozen-lockfile` → `pnpm run lint` → `pnpm test` → `pnpm run build` since the 2026-07-21 pnpm adoption. `marketing-site` "Public marketing site source" says Astro + Tailwind + MDX; the site is a hand-written static page built by `node site/build.mjs` with zero dependencies since `c52745af0`. Both requirements re-stated to match the tree; no behaviour change.
- **Dead `release:` trigger (#580).** `sync-release-version.yml` declares `release: [published, edited]` and calls it "the normal path". Releases are created by `publish.yml` with the default Actions token, whose events never start a workflow; the working path is the explicit `workflow_dispatch` from `publish.yml`'s `site-redeploy` job (spec'd in `marketing-site`). The trigger and its docstring are removed; `workflow_dispatch` stays. The one live edge — a human flipping a draft to published — is covered by the same manual `workflow_dispatch` the docstring already names, and the site-deploy contract test gains the assertion that the trigger does not return.

Out of scope: #579 (path-filter investigation — no evidence to act on).

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `electron-build-pipeline`: "macOS deployment target is pinned" — the unextractable-`minos` clause becomes canary-guarded.
- `ci-cd-pipeline`: "CI workflow on push and PR" — pnpm commands.
- `marketing-site`: "Public marketing site source" — static build, no framework; `sync-release-version` has no `release:` trigger.

## Impact

- `packages/electron/scripts/verify-macos-floor.mjs`, `packages/electron/scripts/macos-floor.mjs` (+ test), `.github/workflows/_electron-build.yml` comment.
- `packages/shell/vite.config.ts` (comment only).
- `openspec/specs/ci-cd-pipeline/spec.md`, `openspec/specs/marketing-site/spec.md` (via archive sync).
- `.github/workflows/sync-release-version.yml`, `packages/shared/src/__tests__/site-deploy-workflow-contract.test.ts`, `.github/workflows/AGENTS.md`.

## Discipline Skills

- `doubt-driven-review` — removing a workflow trigger is irreversible from the pipeline's point of view; the "human publishes a draft" edge is written down before the trigger goes.
- `review-code` — before commit. No untrusted input, endpoint, or latency budget.
