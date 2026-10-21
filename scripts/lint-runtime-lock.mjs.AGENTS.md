# lint-runtime-lock.mjs — index

`--version X [--lock F]`: runs the bundle's `rebaseRuntimeLock` over the generated lock as a check; non-zero on defect. Wired in `publish.yml` before server publish + nightly publish. See change: pin-electron-bundle-dependency-tree.
