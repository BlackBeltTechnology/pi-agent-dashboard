# DOX — packages/memory-eval/src/__tests__

Files in this directory. One row per file. All L1, synthetic data only. See change: add-memory-eval-tier-r.

| File | Purpose |
|------|---------|
| `cases.test.ts` | Case builder: determinism, frozen sets, recurring/negative/user-flagged/explicit-ref rules, BVA on 399/400 chars, 15-event fix window, masking, error detection, event ordering, no-sessions (E1–E17, X12). |
| `cli.test.ts` | `--help` lists subcommands, unknown command, bin shim runs through tsx. |
| `helpers/ctx.ts` | `makeEnv()`: temp HOME + captured stdout/stderr `Ctx`. |
| `helpers/hermes-db.ts` | `createHermesDb(path, fixture, {wal})` with the hermes schema copied from 0.9.10; `HERMES_SCHEMA_SQL`. |
| `helpers/judge-env.ts` | `judgeEnv()`: case set + providers file + stub-`pi` + stub retriever module; `run()`/`judge()`/`calls()`. |
| `helpers/report-fixture.ts` | `writeRun(env, spec)`: writes retrieved/manifest/verdicts directly for report tests. |
| `helpers/run-fixture.ts` | `mkCase`, `writeCaseSet`, `hermesDbPath`. |
| `helpers/sessions.ts` | Synthetic pi session JSONL builder (`bash`, `user`, `writeSession`). |
| `helpers/stub-pi.mjs` | Scripted `pi -p` stand-in driven by `STUB_CONFIG` (exit code, delay, raw stdout, omitted ids, invocation log, pid file). |
| `hermes-replica.test.ts` | Golden pin of the newest-first replica (E23) + live drift check against installed hermes (E24, skipped when absent). |
| `judge.test.ts` | Cache hit/miss keys, scrub, exact argv, role resolution, consent matrix, dry run, provider failure, malformed answer, timeout kill, retry (E27–E36, X1–X4). |
| `manifest.test.ts` | Manifest completeness with `absent` sentinels; `status` listing (E45, E48). |
| `report.test.ts` | Wilson interval, denominators, union intersection, negatives, compare gates, McNemar, no-text-leak markers, sanity band, gold/blackhole, kb separation (E26, E37–E44, E46, E49). |
| `retrievers-perf.test.ts` | BM25 variant on 45k messages incl. the widening path, each < 500 ms (P1). |
| `retrievers.test.ts` | As-of, slot-taking, same-day memory, own-session, external module load/validation/timeout/schema (E18–E22, E25, X9–X11). |
| `snapshot.test.ts` | Racing writer, corrupt copy, absent source, live-WAL sources byte-identical (X5–X8). |
| `workdir.test.ts` | Work dir 0700 / files 0600, nothing written outside (E47). |
