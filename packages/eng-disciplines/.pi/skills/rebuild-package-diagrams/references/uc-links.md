# Use-case UI links

Connect each BPMN step of a use case to the UI action(s) that realise it. Code:
`scripts/links.mjs`. The linking is a gated subagent step; candidates, merge and views are
deterministic. `use-cases.json` is never rewritten.

## Steps

1. `diagrams.mjs uc-link-draft PKG <UC-id> <out.json>` — `steps`: flow nodes of the main and
   alternate flows that a UI action can realise (tasks, events, sub-processes, call activities;
   gateways excluded), with names; `refs`: the use case's `refs` + `requirements` + BR/QUIRK/GAP ids
   in its BPMN; `candidates`: actions whose guard / refs / effect refs intersect, most shared first.
2. Linker (`reverse-spec-for-rebuild` `prompts/uc-linker.md`, agent `rsfr-uc-linker`) writes
   `PKG/diagrams/uc-links/<UC-id>.json`:
   `{useCase, links: [{action: "<SCR>#<ACT>", step, evidence: {refs: [..]} | {cite: "file:line"}}], noUi}`.
3. Gate `check-uc-links PKG [--complete]`:
   - use case exists; action exists in the UI model; `step` is one of the draft's steps;
   - evidence `refs`: every ref is a ref of both the use case and the action; `cite`: lies inside
     one of the action's handler or effect cite ranges; neither → refused;
   - no duplicate `action @ step`; empty `links` needs `noUi`, `noUi` forbids links;
   - `--complete`: a record for every use case. `build-site` and `render.sh` run the gate.

## Merge

`build-site` extends each use case: `screens ∪ link screens`, `uiActions ∪ link actions` (BPMN
`ui:` lines still count), `uiLinks` (with step names), `noUi`. CRUD use-case columns, IFML use-case
scope and the screen page's use-case list follow the merged sets.

## Catalog

Use-case page: "Steps realised by UI actions" (step → action → evidence) or "No UI: <reason>".
