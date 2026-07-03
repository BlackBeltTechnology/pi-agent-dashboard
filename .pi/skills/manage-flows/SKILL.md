---
name: manage-flows
description: Create and edit pi-flows flows and agents from the main session. Use when the user wants to create a new flow, add or change an agent, or edit an existing flow/agent. Covers agent frontmatter, flow YAML, step types (agent, fork, agent-decision, code, code-decision, flow-ref), model references, the flow_agents/flow_write tools, code-handler generation, write locations, editing an existing flow vs creating one, and fixing validation errors.
disable-model-invocation: true
---

# Manage Flows

You are creating and editing **pi-flows** flows and agents directly in this session. Tools that do the writing (each validates before writing and returns diagnostics on failure):

- `flow_agents` — `op: "list"` returns the agent catalog; `op: "write"` validates and writes an agent `.md` to `.pi/flows/agents/<name>.md` (filename derived from the agent's frontmatter `name`).
- `flow_write` — `namespace` (default `custom`), `name`, `content`. Validates and writes a flow to `.pi/flows/flows/<namespace>/<name>/flow.yaml` (the flow's own directory), which auto-registers as the `/<namespace>:<name>` command.
- `skill_read` — read a skill's detail files when you need framework reference while authoring.

These tools derive their write locations from the discovery convention — there is **no raw `path`**. Writing to a name that already exists overwrites it (that is how you edit).

> The manage-flows tools are **off by default**. They are active only when `flows.editFlow: true` is set in `.pi/settings.json` (project, when trusted) or `~/.pi/agent/settings.json` (global), toggled live with `/flows:edit-mode <on|off>`. If `flow_agents`/`flow_write` are not available, tell the user to enable edit mode and (if needed) restart the session.

## How it works (execution model)

Understand the runtime before authoring — the YAML you write is a **DAG of steps**, not a script.

- **Segments & parallelism.** The engine splits steps into segments. A contiguous run of plain `agent` steps executes as a **parallel DAG**: on each wave it dispatches every step whose `blockedBy` is satisfied, up to `max_concurrent` (default 4). Every non-agent node (`fork`, `agent-decision`, `code`, `code-decision`, `flow-ref`) runs as a **sequential** step between those DAG segments. So independent agents run concurrently; decisions and code nodes are serialization points.
- **Agent isolation.** Each agent runs in its own session with only its declared `tools` + `finish`, its `access` globs, and its own resolved model. It cannot see other agents' state. It **must** call `finish(...)` to return a structured result; the engine retries a couple of times if it forgets, then records a soft failure.
- **Forward-only data flow.** There is no shared mutable state. A step reads upstream results through wired `inputs:` and `${{result.STEP.field}}` templates. A producer must run *before* a consumer (via `blockedBy` or routing) — the validator enforces this ordering.
- **Routing on outcome.** Every node resolves to `success` → `on_complete`, `soft` → `on_error`, or `hard` → halt the whole flow. Decision nodes additionally pick a `branch`. A branch target that points at an **earlier** step is a loop (bounded by `max_iterations`).
- **Determinism boundary.** `agent` nodes are non-deterministic (an LLM decides); `code`/`code-decision` nodes are deterministic TypeScript. Put judgment in agents, mechanics in code.

## Editing an existing flow vs creating a new one

**If a specific flow is named with this invocation — a command like `/custom:my-flow`, a flow file path, or a flow `name` — you are EDITING that flow.** Locate it, `read` it, change it, and write it back with `flow_write` under the **same namespace and name**. Do **not** create a new flow or a new command, and do not rename it unless the user asks.

Only create a new flow when no existing flow is named. The same rule applies to agents: an existing agent name = edit that agent in place via `flow_agents` `op: "write"`.

## Workflow

1. Determine the target. If a flow/agent is named (see above), it is an **edit** — read the current file first. Otherwise clarify what the new flow should do; ask if unclear.
2. Call `flow_agents` with `op: "list"` to see existing agents and their `inputs`, `outputs`, `source_type`. Reuse `built-in`/`local` agents where they fit.
3. For each role not already covered, author a purpose-built agent with `flow_agents` `op: "write"`. Do not repurpose infrastructure agents (`flow-decision`, `project-context-reader`) for unrelated tasks.
4. Author the flow with `flow_write`. Wire every declared input. Fix any validation diagnostics and retry.
5. For any `code`/`code-decision` node, implement its handler (see **Code handlers**).
6. Tell the user the resulting command name (`/<namespace>:<name>`).

## Principles

Apply these when authoring — they are the difference between a flow that limps and one that is robust.

1. **Always wire `on_error` on fallible nodes.** A `soft` failure with **no** `on_error` escalates to a **hard** halt that kills the entire flow. If a step can recoverably fail, route `on_error:` to a handler, retry, or fallback step. Only let a node hard-halt when continuing is genuinely pointless.
2. **Validate work with loops — never trust a single pass.** After any step that produces code, edits, or artifacts, add a *verify* step followed by a decision node that loops back to a *fixer* until it passes or hits `max_iterations`. This is the core pattern (see **Verify/fix loop** below). Prefer a deterministic `code-decision` verifier (runs tests/lint, returns a branch) over an agent verifier when the check is mechanical.
3. **Prefer `code`/`code-decision` for anything mechanical.** Schema/JSON validation, presence checks, parsing, running a linter or test command, computing a verdict — these are cheaper, faster, and reproducible as TypeScript handlers. Reserve agents for tasks needing judgment or generation.
4. **Make contracts explicit and machine-readable.** Declare `outputs` with `type`/`pattern` (e.g. a `verdict` constrained to `^(pass|fail)$`) so a downstream decision node can branch on a guaranteed shape instead of parsing free text.
5. **Least privilege.** Give each agent only the `tools` it needs and the narrowest `access.read`/`access.write` globs; add `bash.deny` for destructive commands. The guard blocks everything you do not grant.
6. **One agent, one role.** Author a purpose-built agent per role; do not overload a single agent or repurpose infrastructure agents (`flow-decision`, `project-context-reader`) for unrelated work.
7. **Wire and reference every input.** An unwired declared input is a validation **error**; a wired input never referenced as `${{input.NAME}}` is a **warning** (the value is silently lost). Keep the agent body and the step `inputs:` in lockstep.
8. **Parallelize independent work.** Omit `blockedBy` between steps that have no real data/order dependency so they run concurrently (up to `max_concurrent`). Only chain steps when one genuinely consumes another's output.
9. **Write cooperative code handlers.** Respect `ctx.signal` (abort/timeout), set a `timeout:` on long handlers, call `ctx.setSummary()`/`ctx.logger()` for card visibility, and return **exactly** the declared outputs as strings/primitives. Reserve `throw new FlowHardError(msg)` for truly unrecoverable conditions; a plain `throw` is a recoverable soft failure.
10. **Author iteratively against the validator.** The tools validate *before* writing and return diagnostics on failure — they never write partial output. Write → read each diagnostic's `message`/`suggestion` → fix → re-write. Never assume the first write succeeded.

### Verify/fix loop (the canonical robustness pattern)

```yaml
steps:
  - id: implement
    agent: implementer
    task: Implement ${{task}}
    on_error: report          # recoverable failure routes out, not halt

  - id: verify
    type: code                # deterministic: run tests/lint, emit a verdict
    inputs:
      touched: ${{result.implement.files}}
    outputs:
      - name: verdict         # "pass" | "fail"
      - name: report
    blockedBy: [implement]

  - id: gate
    type: code-decision       # or agent-decision for a judgment call
    inputs:
      verdict: ${{result.verify.verdict}}
    branches:
      fix: implement          # backward target → loops to the fixer
      done: report            # forward target → exits
    max_iterations: 3         # REQUIRED for the backward edge; engine forces exit at the cap

  - id: report
    agent: reporter
    task: Summarize outcome. Verifier said: ${{result.verify.report}}
```

The loop body references `${{loop.gate.iteration}}` / `${{loop.gate.max}}` to tell the agent how many tries remain.

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
    type: string
    pattern: "^(pass|fail)$"
access:
  read:
    - "src/**"
  write:
    - "src/**"
  bash:
    deny:
      - "rm -rf *"
fork_session: false
context_files:
  - "AGENTS.md"
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
| `outputs` | No | Names (or `{name, description, type?, pattern?}`). Become `finish` parameters and `${{result.STEP.NAME}}` downstream. `type: string\|number\|boolean` and `pattern: <regex>` validate the string content (`pattern` wins over `type`). |
| `fork_session` | No | `true` forks the operator's main-session conversation into the agent (falls back to a fresh in-memory session when the main session is not persisted). Default `false`. |
| `context_files` | No | Paths read at spawn and injected as `## Context: <path>` preamble sections. Missing/unreadable files are skipped. `AGENTS.md` is just one possible path. |
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

`name` is the frontmatter name; the command name comes from the on-disk location (`namespace`/`name` you pass to `flow_write`). Every step needs a unique `id`. Step `type` is usually inferred from which fields are present; set `type:` explicitly when ambiguous. Steps run as a DAG: order is driven by `blockedBy` plus decision/`on_complete`/`on_error` routing.

### Step types

There are six: **agent · fork · agent-decision · code · code-decision · flow-ref**. (There is no `conditional` or `agent-loop-decision` — presence checks and loops are expressed with the decision nodes below.)

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
3. **agent-decision** — agent calls `finish({ branch })` to choose. Declare ≥2 branches (`label → stepId`).
   ```yaml
   - id: should-fix
     type: agent-decision
     agent: flow-decision
     task: "Iter ${{loop.should-fix.iteration}}/${{loop.should-fix.max}}. ${{result.verify.summary}}"
     branches:
       fix: fixer            # backward target (an earlier step) → loops
       done: finalize         # forward target → exits
     max_iterations: 3        # REQUIRED when any branch points backward
   ```
   A branch whose target is an **earlier** step re-enters that step (a loop) and MUST declare `max_iterations`; the engine forces exit at the cap.
4. **code** — run a deterministic TypeScript handler as a node (wired exactly like an agent).
   ```yaml
   - id: validate
     type: code
     inputs:
       invoice: ${{result.extract.canonical}}
     outputs:                # handler must return EXACTLY these keys
       - name: valid
       - name: nav_record
     timeout: 30000          # optional soft deadline (ms)
     blockedBy: [extract]
     on_complete: report
     on_error: handler
     # target: path/to/handler.ts   # optional; default path is convention-based
   ```
   See **Code handlers**.
5. **code-decision** — a `code` node that also routes on a reserved `branch` output. Declare ≥2 branches.
   ```yaml
   - id: route
     type: code-decision
     inputs:
       valid: ${{result.validate.valid}}
     branches:               # label → stepId (≥2)
       approve: finalize
       reject: notify
     outputs: []             # optional extra DATA outputs; "branch" is reserved
   ```
   The handler returns `{ branch: "<label>", ...declaredOutputs }`. A missing `branch` is a **soft** failure; an off-map `branch` is a **hard** failure (halts the flow). Use this for presence/absence checks (inspect a field, return a branch) and for backward-edge loops (same `max_iterations` rule as `agent-decision`).
6. **flow-ref** — delegate to another flow file.
   ```yaml
   - id: sub
     type: flow-ref
     path: "project/changes/*/exec.yaml"   # glob ok
     on_complete: verify
   ```

### Failure model (all nodes)

Every node resolves to `success`, `soft`, or `hard`. `success` routes `on_complete`; `soft` routes `on_error`; `hard` aborts in-flight steps, skips pending ones, and ends the flow with status `error`. For agents this is classified structurally: `finish(complete)` → success, `finish(error|blocked)` → soft, no-finish with a terminal API error → hard. For code: a plain `throw` (or contract/coercion/missing-handler/timeout failure) is **soft**; `throw new FlowHardError(msg)` is **hard**.

### Template variables

Expanded in `task`, `inputs` values, and `question`. Not validated — a typo silently becomes empty string.

- `${{task}}` — the user task.
- `${{input.NAME}}` — input wired into this step.
- `${{result.STEP_ID.status|summary|artifacts|files|fullOutput|OUTPUTNAME}}` — `STEP_ID` is the step `id`, not the agent name.
- `${{loop.STEP_ID.iteration|max}}` — loop counters (1-based iteration; `max` = the node's `max_iterations`).

Wire data between steps via `inputs:` (producer declares `outputs`; the consuming step supplies values). Prefix an input value with `file://` to inject file content verbatim; that file's producer step must be in `blockedBy`.

## Code handlers

A `code`/`code-decision` node runs the **default export** of a `.ts` module, invoked `(input, ctx)`:

- `input` — the step's declared `inputs`, template-expanded to strings.
- return — an object containing **exactly** the declared `outputs` (primitive values coerced via `String()`; objects/arrays/null are rejected). A `code-decision` also returns `branch: "<label>"`.
- `ctx: CodeNodeContext` — `signal` (cooperative abort; respect it, and a `timeout:` aborts it), `cwd`, `logger(msg)` (program-log output, surfaced on the node's card), `setSummary(text)`, `flowName`, `stepId`, `task`.
- failure: a plain `throw` (or a contract/coercion/timeout/missing-handler failure) is **soft** (routes `on_error`); `throw new FlowHardError(msg)` is **hard** (halts the flow). Import `FlowHardError` from `@blackbelt-technology/pi-flows`.

### Where the template generates

Each flow is a **self-contained directory** — `.pi/flows/flows/<namespace>/<name>/flow.yaml` — and its code handlers live in that **same directory**. For every **convention-based** `code`/`code-decision` node (no explicit `target:`), pi-flows writes an inert reference template next to `flow.yaml`:

```
.pi/flows/flows/<namespace>/<name>/<id>.ts.default
```

where `<id>` is the step `id`. It is **rewritten on every `flow_write`** (and via `/flows:generate <flow>`) to stay in sync with the node's `inputs`/`outputs`/`branches`. The real `<id>.ts` is **never** overwritten. A node with an explicit `target:` gets no template — the author owns that file. Handlers resolve relative to the flow's own directory (`dirname(flow.source)`), so the generated and runtime paths are always identical.

### How to write the handler

Copy the template, drop `.default`, implement the body (in the flow's own directory):

```
cd .pi/flows/flows/<namespace>/<name>
cp <id>.ts.default <id>.ts
```

The generated scaffold for a `code` node (inputs `{invoice}`, outputs `[valid, nav_record]`):

```ts
import type { CodeNodeContext } from "@blackbelt-technology/pi-flows";

interface Input { invoice: string }
interface Output { valid: string; nav_record: string }

export default async function (input: Input, ctx: CodeNodeContext): Promise<Output> {
  // TODO: implement code node "validate"
  return { valid: "", nav_record: "" };
}
```

For a `code-decision` node (inputs `{valid}`, branches `{approve, reject}`) the scaffold adds a typed `Branch` union so a wrong label is a compile error:

```ts
import type { CodeNodeContext } from "@blackbelt-technology/pi-flows";

type Branch = "approve" | "reject";
interface Input { valid: string }
interface Output {}

export default async function (input: Input, ctx: CodeNodeContext): Promise<{ branch: Branch } & Output> {
  // TODO: implement code node "route"
  return { branch: "approve" };
}
```

Keep the `interface Input`/`Output` blocks in sync with the YAML — if they drift from the declared `inputs`/`outputs`, `flow_write`/`/flows:generate` emit a non-fatal **drift warning** (runtime shape validation is the backstop). Handlers run in-process via dynamic import (jiti handles `.ts`).

## Write locations (discovery)

| Content | Tool | Lands at |
|---------|------|----------|
| Agent | `flow_agents` `op: write` | `.pi/flows/agents/<name>.md` |
| Flow | `flow_write` | `.pi/flows/flows/<namespace>/<name>/flow.yaml` → `/<namespace>:<name>` |
| Code handler | (you / `/flows:generate`) | `.pi/flows/flows/<namespace>/<name>/<id>.ts` (same dir as `flow.yaml`) |

Each flow is a self-contained directory: `flow.yaml` plus its co-located handlers. Deleting a flow removes the whole directory. Project-local definitions (`.pi/flows/`) override package and built-in ones.

## Fixing validation errors

Both writing tools validate before writing. On failure they return `{ written: false, diagnostics: [...] }` and write nothing. Read each diagnostic's `message` and `suggestion`, fix the content, and call the tool again. Common cases:

- **Missing required field** (`name`, `description`, `model`, `tools` for agents; `name`, `description` for flows) → add it.
- **"Agent not in catalog"** → the flow references an agent that does not exist. Create it with `flow_agents` `op: write`, then retry `flow_write`.
- **Unwired declared input** → add the missing key to the step's `inputs:` block.
- **Bad reference / routing target** → every `blockedBy`, `branches` target, `on_complete`, and `on_error` must point at an existing step `id`; fix the typo.
- **Decision node with <2 branches**, or a backward branch with no `max_iterations` → add the missing branch / `max_iterations`.
- **Reserved output `branch`** declared as a data output on a `code-decision` → remove it from `outputs` (it is the routing key).
- **Unknown tool in `tools:`** → use a valid tool name (see the standard list above) or an extension-registered tool name.
- **Invalid YAML** → fix indentation/quoting; re-validate.
