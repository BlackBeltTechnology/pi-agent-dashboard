# DOX — packages/dashboard-plugin-runtime/src/test-support

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Test-support barrel for `dashboard-plugin-runtime/test-support`. Re-exports `withUiPrimitiveProvider` from `./withUiPrimitiveProvider.js`. Test-only; production builds should not import. |
| `withUiPrimitiveProvider.tsx` | Test helper that wraps a render in a UiPrimitiveProvider populated with mock impls. |
