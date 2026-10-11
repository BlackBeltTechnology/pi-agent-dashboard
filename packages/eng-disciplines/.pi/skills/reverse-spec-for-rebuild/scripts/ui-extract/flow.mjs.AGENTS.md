# .pi/skills/reverse-spec-for-rebuild/scripts/ui-extract/flow.mjs — index

`flow.mjs <pkg> <flows-job.json> <UC> <outDir>`: UI actions → semantic BPMN package (guards → gateway + Blocked end, validate → businessRuleTask + Valid? loop, effects → service/script tasks, `kind: form` binding, `ui: <screen>#<action>` + refs + cite per node). Layout: bpmn-package-explorer `generate-cli.mjs`. See change: promote-ui-extraction.
