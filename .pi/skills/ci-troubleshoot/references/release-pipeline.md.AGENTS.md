# ci-troubleshoot/references/release-pipeline.md — index

`publish.yml` deep dive. Gated 7-job graph: resolve → parallel CI checks and standalone smoke → optional tag-and-push → ordered npm publish → Electron matrix → GitHub Release. Pins `electron.needs: [resolve, publish]` and tag-push skip handling.
