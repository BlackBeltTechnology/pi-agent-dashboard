# recommended-local-name-match.spec.ts — index

L3 spec (test-plan #F3, change: match-local-installs-by-package-name). Decoration-mismatched local install renders Active/Remove, not Install. Harness seeds `/fixtures/local-pkg/image-fit-extension` (`package.json#name` = `@blackbelt-technology/pi-image-fit-extension`, dir basename decorated differently) into settings.json `packages[]` under `PI_E2E_SEED` (docker/test-entrypoint.sh), so only the fs-aware name fallback on `activeSources` can match. Asserts `rec-remove-<id>` visible, `rec-install-<id>`/`rec-activate-<id>` absent.
