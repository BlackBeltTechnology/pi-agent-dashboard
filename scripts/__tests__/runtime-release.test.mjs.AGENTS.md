# runtime-release.test.mjs — index

Unit tests for the runtime release producer scripts: bundledPlugins id→name (+ `repository.directory` agreement), asset name = consumer `githubAssetName`, publish.yml `runtime-asset` matrix = `RUNTIME_ASSET_TARGETS`; `finalizeRuntimeLock` (server self-ref rewrite, lockstep, no `file:`, required set); `checkPublished` + CLI via `fixtures/npm-view-stub.mjs` (test-plan #X17); `pruneBinLinks`/`sha512Line`; `checkRuntimeRelease` (#X16). See change: electron-runtime-release-pipeline.
