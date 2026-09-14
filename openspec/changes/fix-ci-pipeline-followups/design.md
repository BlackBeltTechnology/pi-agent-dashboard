## Context

See `proposal.md` — Why. Four independent, small edits; the only one with a design choice is the floor canary.

- `packages/electron/scripts/verify-macos-floor.mjs` maps `not-extractable` / `non-numeric` → `::warning::` + `exit 0`; `macos-floor.mjs` exports `extractMinosValues(otoolOutput)` and already names the prebuilt path in a diagnostic string.
- `.github/workflows/_electron-build.yml` runs the check post-DMG-mount on macOS legs only.
- `sync-release-version.yml` triggers: `release: [published, edited]` + `workflow_dispatch { correlation }`. `publish.yml` `site-redeploy` dispatches it with `--ref develop` and waits on the correlated run. `site-deploy-workflow-contract.test.ts` already asserts `deploy-site.yml` has no `release:` trigger (E10) and reads `sync-release-version.yml` (E11).
- Spec staleness is text-only; archive sync replaces the requirement blocks.

## Goals / Non-Goals

**Goals:** the tripwire cannot pass while blind; every corrected statement is pinned by a test or the archive sync; no behaviour change outside the canary.

**Non-Goals:** hard-failing `not-extractable` on the produced binary (option 2 — loses the documented robustness to novel shapes); #579.

## Decisions

### D1 — Canary in `verify-macos-floor.mjs`, before the produced-binary check

Run `otool -l` on `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` (path resolved from the electron package dir, not hard-coded relative to cwd), feed it to `extractMinosValues`; `[]` → `::error::` naming `extractMinosValues` and the sample path, `exit 1`. Only then inspect the produced binary with today's mapping. The canary runs where the prebuilt exists (the build job installs it); if the prebuilt is absent the canary reports `::error::` too — a floor check without its reference binary is misconfigured, not tolerable.

*Why the prebuilt and not the produced binary:* the produced binary IS the renamed prebuilt, so the two should agree; but the produced one may legitimately be re-signed/stripped in future, whereas the prebuilt is the shape we claim to understand. *Alternative rejected:* option 2 (hard-fail on the produced binary) — indistinguishable from a novel format we want to tolerate.

Test: `macos-floor.test.mjs` (or the existing electron build-contract project) feeds a fixture with no `LC_BUILD_VERSION`/`LC_VERSION_MIN_MACOSX` to the canary path and asserts the error verdict; a fixture with one slice asserts pass-through to the produced-binary check.

### D2 — Trigger removal pinned by the existing contract test

Extend `site-deploy-workflow-contract.test.ts` E10 to `sync-release-version.yml`: no `^\s*release:\s*$` under `on:`; `workflow_dispatch` with `correlation` still present. Docstring: replace the "Triggers" block with `workflow_dispatch` only, and state the human-published-draft rule ("dispatch manually").

### D3 — Spec corrections ride the archive sync

Both stale requirements are re-stated as full MODIFIED blocks (see `specs/`). No `## Purpose` edits needed; a post-sync grep for `npm ci` in `ci-cd-pipeline` and `Astro` in `marketing-site` requirement blocks must be empty (the `## Purpose` preamble of `marketing-site` mentions the Astro era historically at line ~408 — historical note, left).

### D4 — Docstring fix is comment-only

`spa404Fallback` comment says: Pages serves the repo-root `site/404.html` for any unmatched path, including under `/app/`; the copied `404.html` in the shell's dist is reached only if the shell is ever deployed at a root; hash routing keeps deep links off the server.

## Risks / Trade-offs

- [Canary makes the macOS leg fail on a runner where `node_modules/electron` is trimmed before the check] → the check step runs in the same job right after packaging; task 1.3 verifies the path exists at that step in `_electron-build.yml`.
- [Removing `release:` loses the human-draft path] → documented as manual dispatch; `publish.yml` is the only producer of releases in practice (verified by the issue: the trigger has never fired).
