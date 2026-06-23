# Test Failure Triage

How to diagnose vitest failures in pi-agent-dashboard without burning re-runs.

## Golden rule — tee→grep, never rerun

`npm test` can take a minute or more. Re-running just to see an error message wastes that time. **Capture once, grep forever:**

```bash
npm test 2>&1 | tee /tmp/pi-test.log
```

Then all subsequent inspection is `grep` on a file. From `AGENTS.md` "Running Tests" — codified.

## Standard greps

```bash
# Find failure markers
grep -nE 'FAIL|Error|✗|✘|expected|received' /tmp/pi-test.log

# Failure with surrounding context (the test name + assertion)
grep -n -B 5 -A 30 'FAIL ' /tmp/pi-test.log

# Just the file:line of each failure
grep -nE '^[[:space:]]+❯' /tmp/pi-test.log

# Stack traces
grep -n -A 10 'AssertionError\|TypeError\|ReferenceError' /tmp/pi-test.log

# Slow tests (sometimes the failure is a timeout)
grep -nE 'timed out|exceeded' /tmp/pi-test.log
```

## Per-package vitest configs

Multiple packages have their own vitest config. Running `npm test` at the root runs all of them via workspaces. To restrict:

| Package | Run only this |
|---------|---------------|
| `packages/server` | `npm test -w packages/server` |
| `packages/extension` | `npm test -w packages/extension` |
| `packages/dashboard-plugin-skill` | `npm test -w packages/dashboard-plugin-skill` |
| `packages/roles-plugin` | `npm test -w packages/roles-plugin` |

To run a single test file:
```bash
npx vitest run path/to/file.test.ts
```

To run a single test by name:
```bash
npx vitest run -t 'my test name'
```

## Watch mode (interactive debugging)

```bash
npm run test:watch        # all packages
npx vitest -w packages/server   # one package
```

Press `f` to filter on failed only, `o` for only-failed, `q` to quit. Re-saves auto-rerun affected tests.

## When the test passes locally but fails in CI

Most common causes:

| Symptom | Cause | Fix |
|---------|-------|-----|
| Snapshot mismatch | OS-specific line endings or paths | Use `path.join` not literal `/`; normalize newlines in fixtures |
| Timezone difference | Tests use `new Date()` | Mock with `vi.setSystemTime(...)`; use UTC |
| Flaky timing | Race condition with `setTimeout` | Use `vi.useFakeTimers()` + `vi.runAllTimers()` |
| Missing native binary | node-pty / better-sqlite3 not prebuilt for runner OS | See `ci-troubleshoot` skill → common failures |
| Different Node version | Local is 22.18+, runner pinned older | Check `.github/workflows/*.yml` for `node-version:` |

## Repo-lint tests (the strict ones)

Some tests are not behaviour tests — they're repo-wide lints. They fail if the codebase drifts from a convention.

| Lint test | Forbids |
|-----------|---------|
| `no-raw-node-import.test.ts` | Raw `--import` / `--loader` argv outside `node-spawn.ts` |
| `no-direct-process-kill.test.ts` | `process.kill(` outside `platform/` |
| `no-hardcoded-node-modules-paths.test.ts` | Hardcoded `node_modules/electron` / `node_modules/node-pty` paths |
| `no-bare-external-anchor.test.ts` | Bare `<a href="http(s)://">` without `target="_blank"` |
| `no-bash-on-windows.test.ts` | `shell: bash` on steps reachable on Windows runners |
| `publish-workflow-contract.test.ts` | Removing electron job's `needs:` array or `fail-fast: false` |

If one of these fails, the message will tell you which file violated the rule. **Fix the file, don't loosen the lint.** These exist because a previous regression caused real pain (every lint has an associated change in `docs/file-index*.md`).

## Test-isolation guard aborts the run

Running `npx vitest run` (or a workspace test) directly ABORTS with:
`Unhandled Error: [test-isolation] process.env.HOME (/Users/...) equals the real user home`.

The guard stops tests reading/mutating `~/.pi/`. Fix: set an ephemeral HOME before running.

```bash
HOME=$(mktemp -d) npx vitest run packages/automation-plugin
```

The run then prints `[test-isolation] HOME=/var/folders/.../tmp.XXXX (real=/Users/...)` and proceeds. The `run-tests-triage.ts` script already isolates HOME; this matters only when invoking vitest by hand.

## When you can't find the failure

```bash
# Maybe vitest crashed before reporting
tail -200 /tmp/pi-test.log

# Maybe it's an unhandled rejection
grep -n -A 5 'UnhandledPromise\|unhandled rejection' /tmp/pi-test.log

# Maybe the test never ran (filtered out)
grep -nE 'no test files|0 passed|0 tests' /tmp/pi-test.log
```

If a file has `.skip` or `.only` accidentally committed:
```bash
grep -rn 'describe\.only\|it\.only\|test\.only\|describe\.skip\|it\.skip' src/ packages/
```
