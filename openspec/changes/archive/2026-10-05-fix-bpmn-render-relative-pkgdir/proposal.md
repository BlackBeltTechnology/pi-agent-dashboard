## Why

`bpmn-package-explorer`'s `generate-cli.mjs <packageDir>` with a relative package dir (e.g. `.`) assembles a render root whose artifact symlinks point at themselves (`main.bpmn -> main.bpmn`): `assembleRenderRoot` passes `join(pkgDir, rel)` — a relative path — as the symlink target, and a relative target resolves against the link's own directory. The viewer then fails with "Failed to load package: HTTP 404 for <entry>.bpmn". Found while building the pilot app use-case flows (`add-rebuild-package-diagrams`); the workaround was passing `"$PWD"`.

## What Changes

- `render.mjs` `assembleRenderRoot` resolves the package dir to an absolute path before linking artifacts.
- New self-test `8.3` (selftest-workflow) builds a render root from a relative package dir and reads the entry `.bpmn` and `package.yaml` through the links.

## Capabilities

### New Capabilities
- `bpmn-package-render-root`: render-root assembly links real package artifacts for absolute and relative package dirs.

### Modified Capabilities
- None.

## Impact

- `packages/pi-forms-bpmn/.pi/skills/bpmn-package-explorer/scripts/render.mjs`, `selftest-workflow.mjs`.
- No API change; absolute-path callers unaffected. Rollback = revert the commit.

## Discipline Skills

- `systematic-debugging` — root cause confirmed (relative symlink target) and reproduced by a failing test before the fix.
- `review-code` — inline review of the two-file diff.
