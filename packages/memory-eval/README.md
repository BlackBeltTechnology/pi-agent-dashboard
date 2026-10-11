# memory-eval

Tier R retrieval evaluation for the context manager. Mines cases from a project's pi session logs, replays the old-stack retrievers **as of each decision time**, judges helpfulness with a role-resolved model, and reports with confidence intervals.

All mined data stays under `~/.pi/dashboard/memory-eval/<project-key>/` (mode `0700`, files `0600`) and is never committed. The only thing that leaves the machine is scrubbed case text sent to the judge provider, after consent.

```bash
node packages/memory-eval/bin/memory-eval.mjs --help
PD=/path/to/project            # the checkout whose sessions are mined (default: cwd)

memory-eval cases build --project-dir $PD            # frozen set `baseline`; --force to overwrite
memory-eval run   --project-dir $PD                  # snapshots hermes + kb, runs the adapters
memory-eval judge --project-dir $PD --judge @review  # consent prompt; --yes / --dry-run
memory-eval report --project-dir $PD                 # aggregate only, no case text
memory-eval report --compare <runA> <runB>           # paired McNemar; same case set + judge only
memory-eval status
```

- Adapters: `hermes.session_search.recent`, `hermes.session_search.bm25`, `hermes.memory_search` (as-of, strict) and `kb.docs` (no as-of; reported separately). More via `run --retriever-module ./x.mjs` (default export `Retriever[]`, trusted local code).
- The judge runs `pi -p --no-session --no-extensions --no-skills --no-context-files --no-tools --model <ref>`; `@role` resolves from `~/.pi/agent/providers.json`. `review` is not a default role: configure it or pass `--judge provider/id`.
- Tests: `npm test -w packages/memory-eval` (synthetic fixtures only). Golden for the hermes replica: `scripts/regen-hermes-golden.ts`.

Design: `openspec/changes/archive/2026-10-11-add-memory-eval-tier-r/`. Baseline numbers: `measurements.md` there, and `docs/research/unified-context-manager-exploration.md` §19.
