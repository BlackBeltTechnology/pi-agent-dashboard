/**
 * Single source of truth for the real-process vitest phase.
 *
 * `vitest.real-process.config.ts` INCLUDES this list; `vitest.config.ts`
 * EXCLUDES it. Every path is relative to `packages/server/` so both configs
 * (and the repo-lint in `packages/shared/src/__tests__/
 * real-process-project-guard.test.ts`) read the same strings.
 *
 * Membership rule: the test spawns a REAL operating-system process under test
 * — a keeper, a mock-pi, a bin wrapper, a signal-forwarding CLI, or a full
 * server — and observes its outcome through the process table, a socket, or a
 * log file. Those tests need CPU the saturated parallel run does not have, so
 * they run alone afterwards at `maxWorkers: 2`.
 *
 * Tests that only `execSync`/`execFileSync` a short git or render CLI are NOT
 * members: nothing is observed through the process table, and they do not
 * starve.
 *
 * See change: isolate-real-process-tests.
 */
export const REAL_PROCESS_TESTS: readonly string[] = [
  // signal — SIGTERMs a real wrapper → jiti-loaded server, reads boot-state.
  "src/__tests__/cli-signal-forwarding.test.ts",
  // wrapper — spawns the real `bin/pi-dashboard.mjs` in isolated tmp trees.
  "src/__tests__/cli-version.test.ts",
  // full-server — real `pi` subprocess + bridge extension + live /ws gateway.
  "src/__tests__/faux-session.integration.test.ts",
  // full-server — spawns a server child on process.execPath, observes the socket bind.
  "src/__tests__/gateway-socket-bind.test.ts",
  // signal — spawns a real detached child and kills it through the registry ladder.
  "src/__tests__/headless-shutdown-fallback.test.ts",
  // wrapper — spawns the published CLI bin entry to exercise jiti resolution.
  "src/__tests__/pi-dashboard-bin-wrapper.test.ts",
  // keeper + mock-pi — real keeper.cjs driving a hung mock-pi child.
  "src/__tests__/session-kill-e2e.test.ts",
  // signal — real detached children exercising the SIGTERM → SIGKILL ladder.
  "src/__tests__/shutdown-terminates-any-strategy.test.ts",
  // keeper — real keeper + SIGTERM-trapping mock-pi, observed via the process table.
  "src/rpc-keeper/__tests__/keeper-shutdown-kills-pi.test.ts",
  // keeper — real keeper + mock-pi; E5 polls the rotated child log file.
  "src/rpc-keeper/__tests__/keeper.test.ts",
];
