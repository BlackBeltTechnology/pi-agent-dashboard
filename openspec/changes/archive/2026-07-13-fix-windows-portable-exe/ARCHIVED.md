# ARCHIVED — 2026-07-13

Reason: **subsumed / delivered.** The chosen resolution shipped via a different change.

Evidence (drift audit 2026-07-13):
- This change's own `tasks.md` §4 ("Drop path") is self-marked **"SUBSUMED by `restore-windows-nsis-installer`"**.
- Archived `2026-06-22-restore-windows-nsis-installer` dropped `portable.exe` and restored the NSIS `Setup.exe`, retaining the ZIP.
- No build pipeline produces a portable artifact: `.github/workflows/_electron-build.yml` and `publish.yml` have zero `portable` references; `build-installer.sh` / `build-windows-zip.sh` / `docker-make.sh` have no portable step.
- `qa/Makefile` has NSIS smoke targets, not portable.

The Windows-executable problem this change diagnosed was resolved by returning to the NSIS installer rather than fixing the portable build. Original artifacts preserved below for history.
