# 10-bundled-git.ps1 — index

Verifies bundled dugite-native git + sh on Windows. Forces `windowsGitSource=bundled` via `/api/config`, asserts `/api/health.gitSource.source == "bundled"`, `gitPath` under `resources/git`, bundled `git status` + `sh --version` run. Restores original setting in finally. See change: embed-git-bash-on-windows.
