# openspec-design-evidence.ts — index

Local-evidence override for OpenSpec `design` artifact. `evaluateLocalDesignSatisfaction(changeDir, probe)` runs R1 design*.md → R2 `design/`+*.md → R3 `tasks.md` checkbox, short-circuit. `createFsDesignEvidenceProbe()` returns fs-backed `DesignEvidenceProbe`. Promote-only; design-only.
