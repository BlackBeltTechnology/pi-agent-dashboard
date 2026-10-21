# runtime-plugin-perf.spec.ts — index

Opt-in (`PW_PERF=1`) budgets. P2 zero plugins: ≤2 runtime-added requests + ≤10 kB gzip `/host`+`/plugin-assets` per cold load (8.145); P3 trusted canary claim-visible p95 ≤ first-party settings body p95 + 300 ms over 5 cold loads (8.146). Cold = fresh context per run. See change: decouple-plugins-from-core.
