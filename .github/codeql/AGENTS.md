# DOX — .github/codeql

Files in this directory. One row per file. Non-source area.

| File | Purpose |
|------|---------|
| `codeql-config.yml` | Shared CodeQL config. Read by `.github/workflows/codeql.yml` (`config-file`) and `scripts/codeql-local.mjs` (`paths-ignore` → `LGTM_INDEX_FILTERS`). Ignores test/e2e/QA/mockup paths + root `spike/**` (root-anchored extractor filter; nested `*/spike/` stays analyzed); non-test scripts stay analyzed. `extensions/` holds data-extension models → see `extensions/AGENTS.md`. See change: add-local-codeql-ratchet. |
