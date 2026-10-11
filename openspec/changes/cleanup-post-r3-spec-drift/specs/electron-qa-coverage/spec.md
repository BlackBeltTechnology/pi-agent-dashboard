## REMOVED Requirements

### Requirement: QA simulates degraded managed-dir recovery

**Reason**: The degraded-recovery stage it pins ("Stage 9": wipe `$MANAGED_DIR/node_modules/@mariozechner`, re-run the `installStandalone` mirror, guard `extractedSourceIsHealthy`) no longer exists in `packages/electron/scripts/test-electron-install-inner.sh`, and neither do the production paths it guarded. The packaged app no longer extracts or installs into a managed dir; it runs from the read-only bundled server tree.
**Migration**: Stage 1 of `test-electron-install-inner.sh` asserts that the bundled jiti loader (`resources/server/node_modules/jiti/lib/jiti-register.mjs`) is present. A missing bundled server is covered by `BundledServerMissingError` (`electron-launch-source`).
