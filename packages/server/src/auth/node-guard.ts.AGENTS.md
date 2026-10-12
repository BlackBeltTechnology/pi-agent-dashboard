# node-guard.ts — index

Re-exports `isAffectedNode`/`isOutOfEnginesRange` from shared `node-version.ts` (public API unchanged). Owns `buildEnginesRangeMessage`, `buildNodeUpgradeMessage`, `assertNodeVersionSupported` (preflight refuse-to-start, exit 1). See change: unify-node-version-gate.

`foreignTsLoaderWarning(execArgv)` names a jiti/tsx `--import` (other `--import` values ignored) + recommends `pi-dashboard stop && pi-dashboard start`; `warnTsLoaderState(env, execArgv, warn)` logs it plus the legacy `PI_DASHBOARD_TS_LOADER` warning (via shared `legacyTsLoaderEnvWarning`); called once from `cli.ts` `runForeground`. See change: strip-only-native-ts-loader.
