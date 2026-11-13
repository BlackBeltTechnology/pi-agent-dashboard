# collapse-streaming-replay-snapshots

Reduce unfinished-response replay by retaining the latest adjacent assistant text snapshot without changing replay state.

| File | Purpose |
|------|---------|
| [proposal.md](proposal.md) | Motivation, scope and expected benefit. |
| [design.md](design.md) | Mechanism, preserved contracts and verification baseline. |
| [specs/replay-stream-compaction/spec.md](specs/replay-stream-compaction/spec.md) | Normative replay-compaction delta. |
| [test-plan.md](test-plan.md) | Scenario catalog and automated test routing. |
| [tasks.md](tasks.md) | Implementation checklist folded from the scenario catalog. |
| .openspec.yaml | OpenSpec schema and artifact metadata. |
