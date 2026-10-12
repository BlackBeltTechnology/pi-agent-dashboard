# check-kb-dist-fresh.mjs — index

CI gate (ci.yml, ship-it 4.4-adjacent): recomputes kb srcHash+tsconfigHash vs the committed `packages/kb/engine-fingerprint.json`; mismatch → non-zero + "the `kb` bin and the extension would run different engines — rebuild and commit the fingerprint". `--pkg <dir>` sandbox override for the fault-injection tests. dist/ is gitignored so a CI build can never observe lag — the committed fingerprint can. See change: fix-kb-eval-measurement-integrity.
