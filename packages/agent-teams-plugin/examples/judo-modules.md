---
name: judo-modules
description: One teammate per Maven module, in rank order
mode: session
maxTeammates: 4
autoDispatch: false
spawn: lead
hooks:
  TaskCompleted: [{ command: "bash scripts/team-verify-stamp.sh", timeoutMs: 8000 }]
members:
  - { name: core,   prompt: "Module judo-core.   Run scripts/verify-module.sh judo-core before completing." }
  - { name: engine, prompt: "Module judo-engine. Needs core." }
  - { name: ui,     prompt: "Module judo-ui. Needs engine." }
---
You lead modules of {{goal}} in {{cwd}}. For each module in rank order create one task titled `<module>`
(blockedBy the tasks of lower rank), assign it to the matching member (`TaskUpdate owner`), and spawn the members
with TeammateSpawn (they run in {{cwd}}). You commit; teammates do not.
