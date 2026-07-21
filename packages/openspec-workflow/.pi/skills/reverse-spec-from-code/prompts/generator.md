# Generator prompt (v3 — shipped)

Fill the {PLACEHOLDERS} and pass as the subagent task. Model: @research, @coding,
or a fast/cheap model (@fast / @compact). The FORMAT rule below is a hard gate
that keeps cheaper models valid — a model-loss test showed a cheap generator
drops from 3/6 to 6/6 `openspec validate` passes once this directive is present.

---

You are reverse-engineering an OpenSpec capability specification from existing
source code, for a knowledge base that must accurately describe CURRENT behavior.

CAPABILITY: {CAPABILITY}
SCOPE: {PURPOSE_HINT}
START FROM: {SOURCE_FILES}
You MAY and SHOULD read beyond these files. Use grep/Read to follow the
capability across boundaries.

STEP 1 — Map the capability's FULL surface (most important step):
- Read the start files.
- A capability's contract usually spans multiple files. Whenever the code
  EMITS a message/event, WRITES to a registry/store, SETS a DOM attribute,
  CALLS another module, READS config or package.json, or SPAWNS/KILLS a
  process — that is an observable contract with ANOTHER component. grep the
  repo for the other side and read it. Capture that behavior as a requirement
  even though it lives in a different file.
- Include error paths, edge cases, cleanup/teardown, and default behavior.

STEP 2 — Write spec.md in EXACTLY this OpenSpec full-form format:

# {CAPABILITY} Specification

## Purpose
<1-3 sentences: what this capability does and why it exists>

## Requirements
### Requirement: <short imperative name>
The <subject> SHALL <behavioral obligation>. <optional clarifying sentences>

#### Scenario: <short name>
- **WHEN** <trigger / precondition>
- **THEN** <required observable outcome>
- **AND** <additional outcome, optional>

RULES:
- SHALL statements describe externally-observable behavior (inputs, outputs,
  side effects, messages, errors), never implementation detail (no variable
  names, no line numbers).
- GROUP related obligations under ONE Requirement with multiple Scenarios. Aim
  for the FEWEST requirements that still separate genuinely distinct
  obligations — typically 3-8. Do not split one behavior into many tiny reqs.
- Every Requirement has at least one concrete Scenario using real values
  (intervals, ports, signals, message names, error codes, headers) from code.
- Derive requirements ONLY from behavior present in the code. Describe what the
  code ACTUALLY does now — do not invent, and do not soften to match older
  assumptions.
- Do NOT describe visual, layout, or detail specifics (colors, pixel sizes,
  exact segment stacking) that you did not directly confirm in the code. When
  unsure, describe behavior at the level the code supports.
- FORMAT IS A HARD GATE. Use EXACTLY these markers: `### Requirement: <name>`
  (a heading, with NO leading number like "Requirement 1:") and `#### Scenario:
  <name>` (a heading — NOT bold `**Scenario:**`, NOT a markdown table). Every
  scenario body is `- **WHEN**` / `- **THEN**` / `- **AND**` bullet lines. A
  spec that uses tables, bold scenario labels, or numbered requirements FAILS
  `openspec validate` and is rejected. This is the #1 failure mode on
  smaller/faster generator models — do not deviate.
- Cover the cross-component contracts you found in STEP 1.
- Output ONLY the spec.md content. Write it to {OUTPUT_PATH} with the Write
  tool ({OUTPUT_PATH} is under the gitignored `.reverse-spec-scratch/`, NOT
  under `openspec/`). Reply only "done".
