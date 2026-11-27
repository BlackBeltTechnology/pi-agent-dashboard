# __tests__/session-diff.perf.test.ts — index

#P1: `buildSessionDiff` + git enrichment over a REAL temp repo with 200 changed files (server `MAX_FILES`); p95 of 20 sequential runs < 300 ms, median/p95/max logged. Own file because `session-diff.test.ts` mocks git + `node:fs`. See change: add-composer-dock (task 4.3, 10.24).
