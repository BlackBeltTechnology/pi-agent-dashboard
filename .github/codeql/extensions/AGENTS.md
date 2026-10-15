# DOX — .github/codeql/extensions

Files in this directory. One row per file. Non-source area.

| File | Purpose |
|------|---------|
| `cwd-guard.model.yml` | CodeQL data extension: shared cwd guards (`isAllowedCwd`, `admissionAllows`, `tokenAllows`) are path-injection barrier guards; `admitCwd` is a barrier on its own argument. Local ratchet does not load it (analysis with an explicit model pack gave identical results). See change: harden-plugin-cwd-admission, add-local-codeql-ratchet. |
