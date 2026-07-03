# debug-dashboard/scripts/run-tests-triage.ts — index

Runs `npm test` (or scoped variant), tees output to `${tmpdir}/pi-test.log`, prints FAIL-marker summary. Flags: none = `npm test`; `-t '<name>` = `npx vitest run -t`; `packages/*` = `npm test -w <pkg>`; other arg = `npx vitest run <arg>`. Exports `pickCommand`, `resolveBinary`; FAIL_RX = `/FAIL|✗|✘/`. Cross-platform (npm.cmd on Windows). Implements AGENTS.md "Running Tests" tee→grep pattern.
