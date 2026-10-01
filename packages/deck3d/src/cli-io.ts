/**
 * The CLI's I/O seam, in its own module so other modules can depend on the
 * TYPES without depending on `cli.ts` itself.
 *
 * This exists to break a real import cycle, not to satisfy a linter: `cli.ts`
 * loads `serve/index.ts` to run the `serve` command, and `serve` used to import
 * `run` straight back from `cli.ts`. When `cli.ts` was the process ENTRY its
 * top-level `await run(...)` was still pending, so the cycle's dynamic import
 * could never resolve and the process exited 13 ("unsettled top-level await").
 * See `serve/__tests__/serve.test.ts` #S10, which pins that behaviour.
 *
 * Dependencies point one way now: `cli.ts` → `serve/index.ts` → `cli-io.ts`.
 * `serve` receives the runner it needs through `ServeOptions.run`.
 */

/** Where a command writes its output. Tests substitute collectors for both. */
export interface CliIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** The CLI entry point's shape: argv (without node/script) → exit code. */
export type CliRun = (argv: string[], io: CliIO) => Promise<number>;
