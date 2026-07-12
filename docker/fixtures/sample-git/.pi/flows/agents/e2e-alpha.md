---
name: e2e-alpha
description: Synthetic e2e flow agent A (faux-driven, first step).
model: "@coding"
tools: read
outputs:
  - name: note
    description: Per-agent completion marker echoed by the faux provider.
---

# Synthetic e2e agent — alpha

[[flow-agent:alpha]]

You are the first agent in the synthetic e2e flow. Task: ${{task}}

Call `finish` with a short `note`. The faux provider drives this deterministically
(scenario `flow-agent-branch`), so the real model is never contacted.
