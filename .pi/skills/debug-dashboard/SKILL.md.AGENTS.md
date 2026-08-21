# debug-dashboard/SKILL.md — index

System-level dashboard debugging. First moves use `pnpm exec` repository scripts to discover the active base from env/config, verify dashboard status + `/api/health`, read the latest log block, and list non-ended sessions without Bash/curl/jq. Then triage bridge or UI failures. Symptom table covers restart loops, blank page, Electron boot, and unsupported Node versions. See change: fix-reliable-live-control-events.
