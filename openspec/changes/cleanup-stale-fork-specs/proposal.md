## Why

> Draft. Follow-up drift recorded by `drop-mariozechner-pi-fork` (task 7.7).

`drop-mariozechner-pi-fork` removed the legacy `@mariozechner/pi-coding-agent` fork from code and from every live capability spec. It intentionally left some requirements that still name the fork. Those requirements describe code that `eliminate-electron-runtime-install` already deleted:
- `bootstrapInstall`, `installStandalone`, `dependency-installer.ts`;
- power-user install, the offline cache, `offline-packages.json`;
- `resolveJitiFromPi`.

Re-asserting obsolete contracts under a renamed package would be wrong. These requirements must be removed instead.

## What Changes

- Remove (or retire, when every requirement is dead) the stale requirements:
  - `bootstrap-install`;
  - `dependency-installer`;
  - `dashboard-server` "Bootstrap install lists exclude tsx";
  - `electron-shell`: tsx launch, power-user install, and the `shouldUrlWrapEntry` contract (its 0.70.x pin and `offline-packages.json` test are superseded; the function itself is live and keeps a requirement);
  - `electron-build-pipeline` "excludes pi-coding-agent" (superseded now that pi is bundled).
- Each REMOVED block carries a Migration note pointing at `eliminate-electron-runtime-install`. A fully-dead capability uses `retire_capabilities: true` in `.openspec.yaml`.

## Capabilities

### Modified Capabilities
`bootstrap-install`, `dependency-installer`, `dashboard-server`, `electron-shell`, `electron-build-pipeline` (to be confirmed per requirement during planning).

## Impact

- **Specs only.** No code change is expected. Planning must confirm each listed requirement has no live implementation.
- **Depends on** `drop-mariozechner-pi-fork`.

## Discipline Skills

None apply: a spec-only cleanup with no code, auth, latency or irreversible runtime step. `doubt-driven-review` runs as part of `plan-proposal` when this draft is planned.
