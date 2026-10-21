# host-api-gate.ts — index

Pure `evaluateHostApi({source, range, hasClientBundle})` → `{status, refuse, warn, reason}`. Required range for `pi-package` and `clientBundle` plugins (missing = incompatible); refuse only for `installed`/`pi-package`. See change: decouple-plugins-from-core.
