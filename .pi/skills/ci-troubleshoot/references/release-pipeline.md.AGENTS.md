# ci-troubleshoot/references/release-pipeline.md — index

`publish.yml` deep dive. 4-job flow (prepare→publish→electron→github-release) with per-job steps, outputs, and failure tables. Documents `needs: [prepare, publish]` electron-ordering lock, npm publish order (sub-packages first), `_electron-build.yml` delegation inputs, `sync-release-version.yml` + `deploy-site.yml` after-release flow.
