# site-drift-decision.mjs — index

Decision script of `.github/workflows/site-drift-check.yml`: live `deploy-sha.txt` vs last site-relevant commit on `--ref` (push filter's path set); stale/unknown/missing marker → `::warning::` + `gh workflow run deploy-site.yml --ref develop`; skips (`::notice::`) while a deploy is queued/in progress or `gh run list` fails; exit 1 when the dispatch is rejected. See change: add-missing-ci-legs (#579).
