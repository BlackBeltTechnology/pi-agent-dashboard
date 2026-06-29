---
name: edit-flow
description: Create and edit pi-flows flows and agents from the main session. Use when the user wants to create a new flow, add or change an agent, or edit an existing flow/agent. Covers agent frontmatter, flow YAML, step types, model references, the flow_agents and flow_write tools, write locations, and how to fix validation errors.
disable-model-invocation: false
---

# Edit Flow

You are creating and editing **pi-flows** flows and agents directly in this session. Two tools do the writing (both validate before writing and return diagnostics on failure):

- `flow_agents` — `op: "list"` returns the agent catalog; `op: "write"` validates and writes an agent `.md` to `.pi/flows/agents/<name>.md` (filename derived from the agent's frontmatter `name`).
- `flow_write` — `namespace` (default `custom`), `name`, `content`. Validates and writes a flow to `.pi/flows/flows/<namespace>/<name>.yaml`, which auto-registers as the `/<namespace>:<name>` command.

These tools derive their write locations from the discovery convention — there is **no raw `path`**. Writing to a name that already exists overwrites it (that is how you edit).

> The edit-flow tools are **off by default**. They are active only when `flows.editFlow: true` is set in `.pi/settings.json` (project, when trusted) or `~/.pi/agent/settings.json` (global). If `flow_agents`/`flow_write` are not available, tell the user to enable that setting and restart the session.

## Workflow

1. Clarify what the user wants the flow to do. Ask if it is unclear.
2. Call `flow_agents` with `op: "list"` to see existing agents and their `inputs`, `outputs`, and `source_type`. Reuse `built-in`/`local` agents where they fit.
3. For each role not already covered, author a purpose-built agent with `flow_agents` `op: "write"`. Do not repurpose infrastructure agents (`flow-decision`, `project-context-reader`) for unrelated tasks.
4. Author the flow with `flow_write`. Wire every declared input. Fix any validation diagnostics and retry.
5. Tell the user the resulting command name (`/<namespace>:<name>`).

**Editing** an existing flow/agent = `read` the current file, change it, then write it back with the same tool and the same name/namespace.

## Agent files (`.md`)

YAML frontmatter + Markdown body (the system prompt).

```markdown
---
name: code-reviewer
description: Reviews source code for quality and correctness
model: @coding
thinking: medium
tools: read, grep, find
inputs:
  - research_context
outputs:
  - name: findings
    description: Categorized issues found
  - name: verdict
    description: "pass" or "fail"
access:
  read:
    - "src/**"
  write:
    - "src/**"
  bash:
    deny:
      - "rm -rf *"
card:
  label: "Reviewer"
  metric: "default"
architect:
  use_when: "User wants code reviewed for quality"
  produces: "A findings report and a pass/fail verdict"
  depends_on: "An implementer must have produced code"
  domain: "review"
---

# System Prompt

You are a code reviewer. Task: ${{task}}
Context: ${{input.research_context}}
```

| Field | Required | Notes |
|-------|----------|-------|
| `name` | Yes | Unique. Filename = `<name>.md`. Referenced as `agent: <name>` in steps. |
| `description` | Yes | One line. Shown in catalog. |
| `model` | Yes | See **Model references**. |
| `tools` | Yes | Comma-separated. Guard blocks anything not listed. Standard: `read, write, edit, grep, find, ls, bash, ask_user, skill_read`. |
| `thinking` | No | `off`/`minimal`/`low`/`medium`/`high`/`xhigh`. Overrides any `:level` suffix in `model`. |
| `skills` | No | Comma-separated skill names injected into the prompt. |
| `inputs` | No | Names → `${{input.NAME}}` in the prompt. Flow step must wire each one. |
| `outputs` | No | Names (or `{name, description}` objects). Become `finish` parameters and `${{result.STEP.NAME}}` downstream. |
| `interactive` | No | `true` allows mid-task UI prompts. Default `false`. |
| `output` | No | Output file hint (display only). |
| `access` | No | `read`/`write` glob allowlists; `bash.deny` command patterns. `*` = segment, `**` = any depth. |
| `card` | No | `label`, `metric` (`default`/`files`/`tests`/custom), `role`. |
| `architect` | No | `use_when`/`produces`/`depends_on`/`domain` metadata surfaced in `flow_agents` `op: list`. |

## Model references

The `model:` field accepts three forms. **Prefer `@role`.** Use the other two when a specific model is required regardless of role config, or when the user explicitly asks for a non-role model.

| Form | Example | When |
|------|---------|------|
| `@role` (preferred) | `model: @coding` | Default. Resolves via the active role→model map (`/roles`). Built-in roles: `@planning`, `@coding`, `@fast`, `@architect`. |
| `provider/model[:thinking]` | `model: anthropic/claude-haiku-4-5:high` | A specific provider+model is required; optional `:thinking` suffix sets the thinking level. |
| bare `model-id` | `model: claude-haiku-4-5` | A specific model id with no provider qualifier; thinking comes from the `thinking:` field or none. |

A `thinking:` field always overrides any `:thinking` suffix in `model`.

## Flow files (`.yaml`)

```yaml
name: my-flow              # REQUIRED
description: What it does   # REQUIRED
max_concurrent: 3          # optional (default 4)
task_required: true        # optional — prompt for task if invoked with no args
task_prompt: "Task:"       # optional

steps:
  - id: research
    agent: code-reviewer
    task: Review ${{task}}
```

`name` is the frontmatter name; the command name comes from the on-disk location (`namespace`/`name` you pass to `flow_write`). Every step needs a unique `id`. Step `type` is usually inferred from which fields are present; set `type:` explicitly when ambiguous.

### Step types

1. **agent** — dispatch an agent.
   ```yaml
   - id: impl
     agent: implementer
     task: Implement ${{task}}
     blockedBy: [research]
     inputs:
       ctx: ${{result.research.summary}}
     on_complete: verify     # optional cross-segment jump
     on_error: handler        # optional
   ```
2. **fork** — user (or `agent:` in autonomous mode) picks a branch.
   ```yaml
   - id: choose
     type: fork
     question: Which strategy?
     options: [Fast, Full]
     branches: { Fast: fast-impl, Full: full-impl }
     agent: flow-decision     # autonomous-mode decider
     allowCustom: false
     multiSelect: false
   ```
   Branch keys must match `options` exactly.
3. **conditional** — presence/absence of a result field.
   ```yaml
   - id: has-gaps
     type: conditional
     check: research.artifacts   # stepId.field
     present: gap-filler
     absent: finalize
   ```
4. **agent-decision** — agent calls `finish({ branch })` to choose.
   ```yaml
   - id: complexity
     type: agent-decision
     agent: analyzer
     task: Simple or complex?
     branches: { simple: quick, complex: thorough }
   ```
5. **agent-loop-decision** — loop back or exit.
   ```yaml
   - id: should-fix
     type: agent-loop-decision
     agent: flow-decision
     task: Iteration ${{loop.should-fix.iteration}}/${{loop.should-fix.max}}. ${{result.verify.summary}}
     loop_target: fixer       # jump back
     exit_target: done        # continue forward
     max_iterations: 3
   ```
6. **flow-ref** — delegate to another flow file.
   ```yaml
   - id: sub
     type: flow-ref
     path: "project/changes/*/exec.yaml"   # glob ok
     on_complete: verify
   ```

### Template variables

Expanded in `task`, `inputs` values, and `question`. Not validated — a typo silently becomes empty string.

- `${{task}}` — the user task.
- `${{input.NAME}}` — input wired into this step.
- `${{result.STEP_ID.status|summary|artifacts|files|fullOutput|OUTPUTNAME}}` — `STEP_ID` is the step `id`, not the agent name.
- `${{loop.STEP_ID.iteration|max}}` — loop counters.

Wire data between steps via `inputs:` (agent declares names in frontmatter, step supplies values). Prefix an input value with `file://` to inject file content verbatim; that file's producer step must be in `blockedBy`.

## Write locations (discovery)

| Content | Tool | Lands at |
|---------|------|----------|
| Agent | `flow_agents` `op: write` | `.pi/flows/agents/<name>.md` |
| Flow | `flow_write` | `.pi/flows/flows/<namespace>/<name>.yaml` → `/<namespace>:<name>` |

Project-local definitions (`.pi/flows/`) override package and built-in ones.

## Fixing validation errors

Both tools validate before writing. On failure they return `{ written: false, diagnostics: [...] }` and write nothing. Read each diagnostic's `message` and `suggestion`, fix the content, and call the tool again. Common cases:

- **Missing required field** (`name`, `description`, `model`, `tools` for agents; `name`, `description` for flows) → add it.
- **"Agent not in catalog"** → the flow references an agent that does not exist. Create it with `flow_agents` `op: write`, then retry `flow_write`.
- **Unwired declared input** → add the missing key to the step's `inputs:` block.
- **Unknown tool in `tools:`** → use a valid tool name (see the standard list above) or an extension-registered tool name.
- **Invalid YAML** → fix indentation/quoting; re-validate.
