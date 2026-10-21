# DOX — .github/codeql/extensions

Files in this directory. One row per file. Non-source area.

| File | Purpose |
|------|---------|
| `cwd-guard.model.yml` | CodeQL data extension: shared cwd guards (`isAllowedCwd`, `admissionAllows`, `tokenAllows`) are path-injection barrier guards; `admitCwd` is a barrier on its own argument. Dotted type strings MUST be single-quoted (`"'pkg/m.js'"`): CodeQL `parseTypeString` ends the package at the first dot, so unquoted rows never matched. Local ratchet loads this dir as wrapper pack `pi-dashboard/local-models` (JS only). Dir holds `*.model.yml` + `AGENTS.md` only (contract test). See change: harden-plugin-cwd-admission, add-local-codeql-ratchet, codeql-model-pack-and-mirror. |
