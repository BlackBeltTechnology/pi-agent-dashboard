# qa-agent-teams-inproc-scripts.test.mjs — index

Static contract guards for the unexecuted in-process agent-teams L2 scripts (need hermetic install + real pi; this runs everywhere).
- `bash -n` on `qa/tests/60-agent-teams-inproc-persistence.sh`, `61-agent-teams-inproc-perf.sh`, `agent-teams-inproc-lib.sh`; `node --check` on `qa/tests/lib/agent-teams-inproc-*.cjs`.
- `run-all.sh` registers 60 in TESTS; 61 only as announced OPT-IN comment.
- Each script names its test-plan ids; no rendered-browser drive (`shellBrowserViolations`).
- Helpers called exist in `dist-only-lib.sh` / `agent-teams-inproc-lib.sh`.
- SKIP first (exit 0): 61 without `PI_QA_INPROC_PERF=1`; both without `pi` on PATH.
- `ati_upstream_reason`: unset, wrong name, < 0.9.0, no `subagents:capabilities` handler rejected; >= 0.9.0 (0.10.x too) accepted.
- Drivers only reference real faux scenarios, `FAKE_SUBAGENTS_*` vars the fixture reads, sentinels the fake parses.

See change: add-agent-teams-in-process (tasks 2.7, 13.1-13.8).
