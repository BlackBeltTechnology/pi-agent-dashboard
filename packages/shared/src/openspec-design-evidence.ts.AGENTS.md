# openspec-design-evidence.ts — index

Local-evidence override for OpenSpec `design` artifact. `evaluateLocalDesignSatisfaction(changeDir, probe)` runs R1 design*.md → R2 `design/`+*.md → R3 `tasks.md` checkbox, short-circuit. `createFsDesignEvidenceProbe()` returns fs-backed `DesignEvidenceProbe`. Promote-only; design-only.

`evaluateLocalDesignSatisfaction(changeDir, probe, schemaName?)`: `schemaName === PI_SPEC_DRIVEN_SCHEMA` (`"pi-spec-driven"`) returns false with NO probe call (design authored, never inferred). `DesignEvidenceProbe.localSchemaName?(changeDir)` + fs impl reads `schema:` from `<change>/.openspec.yaml` (fallback `list` path carries no `schemaName`). See change: add-pi-spec-driven-schema.
