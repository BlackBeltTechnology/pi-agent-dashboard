# check-pi-settings-paths.mjs — index

Guard, run by ci.yml: no machine-specific absolute path in a committed `.pi/settings.json` `packages[].source`. Exports `absoluteSourceViolations(file, raw)`, `CHECKED_FILES`, `CORRECTION`, `REPO_ROOT`. Flags POSIX `/x`, Windows `C:\x`/UNC, and `~/x`; leaves `npm:`/`git:`/`https://`/`ssh://` specifiers alone; unparseable JSON fails closed. Needed because `pi install <path>` and `pi config` WRITE the absolute form, so a one-time correction regresses. See issue #371.
