# assert-runtime-release.mjs — index

Post-release shape assertion (test-plan #X16), modelled on assert-runnable-bundle.mjs: `checkRuntimeRelease` → every `RUNTIME_ASSET_TARGETS` asset + `.sha512` on the GitHub Release (drafts too), server `beta` (prerelease) / `latest` = X, linux-x64 asset `runtime-manifest.json` version = X. CLI: `gh release view/download`, `npm view dist-tags`. See change: electron-runtime-release-pipeline.
