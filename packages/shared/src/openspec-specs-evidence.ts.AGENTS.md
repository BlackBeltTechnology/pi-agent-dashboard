# openspec-specs-evidence.ts — index

Local-evidence override for OpenSpec `specs` artifact. `evaluateLocalSpecsSatisfaction(changeDir, probe)` = single rule: any `*.md` under `specs/`. `createFsSpecsEvidenceProbe()` iterative DFS walker, defensive try/catch, short-circuits on first `*.md`. Promote-only; specs-only.
