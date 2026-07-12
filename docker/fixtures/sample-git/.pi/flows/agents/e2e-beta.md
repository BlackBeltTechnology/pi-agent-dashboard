---
name: e2e-beta
description: Synthetic e2e flow agent B (faux-driven, terminal step).
model: "@coding"
tools: read
inputs:
  - upstream
outputs:
  - name: note
    description: Per-agent completion marker echoed by the faux provider.
---

# Synthetic e2e agent — beta

[[flow-agent:beta]]

You are the second agent in the synthetic e2e flow. Task: ${{task}}
Upstream note from alpha: ${{input.upstream}}

Call `finish` with a short `note`. The faux provider drives this deterministically
(scenario `flow-agent-branch`), so the real model is never contacted.
