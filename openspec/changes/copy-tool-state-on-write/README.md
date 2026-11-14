# copy-tool-state-on-write

Avoid eager toolCalls map copying on core reducer paths that do not write tool-call state.

| File | Purpose |
|------|---------|
| [proposal.md](proposal.md) | Motivation, scope and expected benefit. |
| [design.md](design.md) | Mechanism, preserved contracts and verification baseline. |
| [test-plan.md](test-plan.md) | Scenario catalog and automated test routing. |
| [tasks.md](tasks.md) | Implementation checklist folded from the scenario catalog. |
| .openspec.yaml | OpenSpec schema and artifact metadata. |
