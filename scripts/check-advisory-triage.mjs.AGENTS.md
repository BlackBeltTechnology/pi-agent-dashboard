# check-advisory-triage.mjs — index

Cross-checks `pnpm audit --json` snapshot vs `advisory-triage.md` (every GHSA one row, class in reachable|build-only|accepted, reason, link, `reachable` names owner change; stale rows warn) + `--xlsx` CDN-pin lockfile integrity. Exports `checkTriage`, `checkXlsxPin`, `runCli`. `npm run check:advisory-triage`. See change: harden-cors-and-csp-reporting.
