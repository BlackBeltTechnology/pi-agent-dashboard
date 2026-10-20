# DOX — packages/dashboard-plugin-runtime/src/test-support

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Test-support barrel for `dashboard-plugin-runtime/test-support`. Re-exports `withUiPrimitiveProvider` from `./withUiPrimitiveProvider.js` and the `__reset*ForTests` helpers (`FolderProjects`, `SessionDataStore`, `SessionEventsStore`, `SlotClaimsVersion`) moved off the root. Test-only; production builds should not import. See change: decouple-plugins-from-core. |
| `withUiPrimitiveProvider.tsx` | Test helper that wraps a render in a UiPrimitiveProvider populated with mock impls. |
