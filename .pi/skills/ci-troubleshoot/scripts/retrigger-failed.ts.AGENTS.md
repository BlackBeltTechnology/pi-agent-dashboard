# ci-troubleshoot/scripts/retrigger-failed.ts — index

Re-run failed jobs of a GitHub Actions run. `<run-id>` defaults to latest failed run (`findLatestFailedRun`). Mode `--failed` (default, `gh run rerun --failed`) or `--all` (full rerun). Prints `gh run watch` hint after.
