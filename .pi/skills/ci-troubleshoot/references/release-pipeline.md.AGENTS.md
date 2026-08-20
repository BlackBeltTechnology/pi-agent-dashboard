# ci-troubleshoot/references/release-pipeline.md — index

`publish.yml` deep dive. Gated 7-job graph: resolve → parallel checks/smoke → tag → publish → Electron → GitHub Release. Records `_electron-build.yml` inputs, literal failure-to-fix rows, post-release site checks, rerun/cancel recovery, and the no-manual-publish boundary.
