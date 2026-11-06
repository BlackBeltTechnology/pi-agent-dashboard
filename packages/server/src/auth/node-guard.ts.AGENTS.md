# node-guard.ts — index

Re-exports `isOutOfEnginesRange` from shared `node-version.ts`. Owns `buildEnginesRangeMessage` (`Required: >=26.0.0 <27`, `nvm install 26`, `brew install node`; managed PATH hint only when `<managedDir>/node/.version` marker meets range — marker read, no spawn) + `assertNodeVersionSupported` (sole startup Node check, exit 1). `isAffectedNode` re-export + `buildNodeUpgradeMessage` (#58515 startup check) removed — affected ranges below Node 26 floor. See change: unify-node-version-gate, raise-node-floor-to-26.

`foreignTsLoaderWarning(execArgv)` names a jiti/tsx `--import` (other `--import` values ignored) + recommends `pi-dashboard stop && pi-dashboard start`; `warnTsLoaderState(env, execArgv, warn)` logs it plus the legacy `PI_DASHBOARD_TS_LOADER` warning (via shared `legacyTsLoaderEnvWarning`); called once from `cli.ts` `runForeground`. See change: strip-only-native-ts-loader.
