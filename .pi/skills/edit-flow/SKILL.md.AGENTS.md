# edit-flow/SKILL.md — index

Skill: create/edit pi-flows flows + agents via `flow_agents` + `flow_write`. Active only when `flows.editFlow: true` in settings. Documents agent `.md` frontmatter fields, `model:` forms (`@role`/`provider/model`/bare id), flow YAML step types (agent, fork, conditional, agent-decision, agent-loop-decision, flow-ref), template vars (`${{task}}` `${{input.NAME}}` `${{result.STEP.field}}` `${{loop.STEP.*}}`), write locations, validation-error fixes.
