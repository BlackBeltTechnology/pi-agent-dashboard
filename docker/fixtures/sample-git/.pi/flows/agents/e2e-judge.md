---
name: e2e-judge
description: Synthetic e2e multi-decision agent (faux-driven, no typed outputs).
model: "@coding"
tools: read
---

# Synthetic e2e decision agent

[[flow-agent:judge]]

Choose the lanes for the e2e fan-out flow. Task: ${{task}}

The faux provider drives this deterministically (scenario `flow-multi-decision`).
