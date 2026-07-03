# debug-dashboard/references/test-failure-triage.md — index

Vitest failure triage. Golden rule tee→grep (`npm test 2>&1 | tee /tmp/pi-test.log`), standard greps, per-package vitest configs (`-w packages/<pkg>`), watch mode, CI-vs-local mismatch table (snapshots, timezone, fake timers, native binaries, Node version). Repo-lint test list. Test-isolation guard (`HOME=$(mktemp -d)`).
