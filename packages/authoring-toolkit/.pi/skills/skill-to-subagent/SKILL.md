---
name: skill-to-subagent
description: "Turn an existing pi skill into an isolated subagent and wire it into a project's implementation pipeline. Use on triggers like \"wrap this skill as a subagent\", \"turn X into a subagent\", \"create a subagent from a skill\", \"should this be a subagent or a skill\", \"subagentize this\", \"isolate this into its own context\", \"add a subagent to the pipeline\". Tech-stack independent (works for any target project) but pi-platform-specific: relies on pi's .pi/agents/*.md, the Agent tool, role aliases, and inherit_context. Decides fitness first (coherence-critical work stays an inline skill), then writes the bridge agent, routes the model by function, tunes context inheritance, and wires a spawn checkpoint. Not a skill-authoring workflow (that's skill-creator) and not a feature-build workflow."
related_skills: skill-creator
---

# Skill → Subagent

## Overview

A **skill** is instructions loaded *into* the main agent's context (progressive disclosure: name+description always present, body on trigger). A **subagent** is a worker spawned *beside* the main agent in an **isolated** context window that returns a distilled report, then burns its context. They are orthogonal.

Converting a skill to a subagent is worth it when the skill's work is **read-heavy or write-light, self-contained, and returns a distilled artifact** — because running it inline would bloat the parent's context and degrade its reasoning. It is **harmful** when the work is coherence-critical (decisions later steps depend on), because a subagent only sees a compressed snapshot and can make conflicting assumptions.

This skill is the repeatable procedure for that conversion, plus wiring the result into a project's implementation loop. It is tech-stack independent (the target project can be any language) but pi-platform-specific.

## When to Use

- You have a skill whose work would bloat the main context if run inline
- A phase of an implementation loop is read-heavy (audit, lookup, summarize) or write-light (docs) and self-contained
- You are designing which parts of a pipeline should run isolated vs inline
- Triggers: "wrap this skill as a subagent", "subagentize this", "should this be a subagent"

**When NOT to use:**

- Authoring a brand-new skill from scratch → `skill-creator`
- The work is coherence-critical (the builder/decider, review+fix, anything whose choices later steps depend on) → keep it an inline skill
- A one-shot trivial task where spawn overhead > benefit

## Step 1 — DECIDE: subagent or inline skill?

Apply the **discriminator** first. It is the whole game.

```text
   Does the phase need shared coherence with the surrounding work?
   (i.e. do later steps depend on decisions made here?)

     YES ──▶ INLINE SKILL   (full context; review, fix, decide, mutate)
     NO, and it is read-heavy / write-light and returns a distilled
         artifact ──▶ SUBAGENT   (isolated, ≤2KB report)
```

Then confirm fitness — a subagent must clear **all** of these, or it is negative value:

- **Context-cost-if-inline is high** — running it inline would meaningfully bloat the parent.
- **Clear input→distilled-output contract** — you can name the inputs and the ≤2KB output shape.
- **Low interactivity** — it does not need `ask_user` loops mid-task (those belong in the parent).
- **Self-contained** — it does not mutate shared state the parent must then reconcile.
- **Clears the token bar** — multi-agent runs burn ~15× the tokens of a single chat; the context it saves must exceed the tokens it spends.

If it fails any, keep it an inline skill. Most "writer" and "reviewer" phases fail the coherence test and should stay inline.

## Step 2 — BRIDGE: write the thin agent `.md`

The skill stays the single source of truth. The agent is a thin spawn shell that loads it. Write to `<project>/.pi/agents/<Name>.md` (project tier) or a package's `agents/` dir (shipped tier).

```yaml
---
description: <when the parent should spawn this>. Wraps /skill:<name>. Returns a distilled report, never raw dumps.
model: "@research"          # role ALIAS, resolved at spawn (see Step 3)
inherit_context: false      # see Step 4
tools: [read, grep, find, ls, bash]   # least-privilege; add write/edit only if it emits files
---

You are the <Name> subagent. Load and follow `/skill:<name>`.

Your single job: <one scoped task>, return a short structured report, then burn
this context so the parent stays sharp.

INPUTS the parent MUST supply in the spawn prompt (inherit_context is false —
you get no parent chatter; work only from these):
  • <input 1 — e.g. the diff scope / file paths>
  • <input 2 — the intent, 1-2 lines>

OUTPUT CONTRACT (≤ 2000 tokens):
## <Result heading>
<distilled findings — cite path + line ranges, quoted code ≤ 10 lines>
## Notes  (what you did not check)

Do NOT paste whole files. Cite path + heading. Then stop.
```

## Step 3 — ROUTE: pick the model by FUNCTION, via role alias

Use **role aliases**, never literal model ids — the agent then tracks the operator's role config and stays portable across machines.

| Function | Role | Why |
|---|---|---|
| Deterministic pipeline / glue / lookup / exploration | `@fast` | Cheap, fast; cost dominates |
| Long-context synthesis (transcripts, big docs) | `@research` | Strong synthesis / long window |
| Reasoning-heavy analysis (security audit, root-cause) | `@research` (or a reasoning model role) | Careful step-by-step over code |
| Map-reduce | chunk workers `@fast`, merge `@compact`/`@research` | Cheap per chunk, strong merge |
| Mechanical writing (doc rows, merges) | `@compact` | Cheap-but-capable |
| Visual / screenshot review | `@vision` | Multimodal |

## Step 4 — TUNE: `inherit_context`

- **`false` + explicit inputs (default, most reliable).** The child starts clean; the parent passes every input in the spawn prompt. Dodges the compression-drop trap. Use for self-contained batch/analysis jobs.
- **`true`** only when the child's judgement genuinely needs the surrounding decision context — and **even then, still pass exact paths + intent in the prompt**, because the inherited snapshot is *compressed* and can drop the one detail the specialist needs.

## Step 5 — WIRE: spawn checkpoint into the pipeline

**pi has no automatic delegation** — a subagent runs only on an explicit `Agent` tool call. Make delegation mechanical by adding a **checkpoint table** to the project's implementation skill (and/or `AGENTS.md`): map an *observable signal in the diff/task* to a spawn, so the main agent reaches for it without needing to remember.

```markdown
| Signal in the task / diff | Spawn |
|---|---|
| touches auth / secrets / PII / untrusted input / perf budget | `Audit` (fix inline) |
| a change landed and docs/ prose needs updating | `DocScribe` |
```

Keep the builder/decider inline in that table's preamble — only read/write-light phases get spawned.

## Step 6 — VERIFY

Spawn on a real task and check the output, do not trust it blind.

## Pitfalls

- **YAML `": "` trap** — an unquoted `description` containing an inner `": "` (colon-space) parses as a nested mapping and the loader **silently drops the agent**. Quote the whole value, or reword to remove the `": "`.
- **Compression-drop** — `inherit_context: true` gives a *lossy* snapshot; never rely on it to carry a specific path/snippet. Pass inputs explicitly.
- **Fresh ResourceLoader** — a spawned subagent re-discovers skills from disk (its own loader), so the wrapped skill must be discoverable on disk, not just loaded in the parent.
- **Telephone game** — cap output at ≤2KB and cite paths; a subagent that dumps raw files defeats its own purpose.
- **Over-privilege** — least-privilege `tools`; add `write`/`edit` only if the subagent legitimately emits files.
- **Isolating coherence** — never subagent the builder, the review+fix loop, or any decider; that is the documented multi-agent failure mode.

## Verification

- [ ] The discriminator was applied — the phase is genuinely non-coherence-critical
- [ ] The agent `.md` frontmatter parses (no `": "` trap); `model` is a role alias
- [ ] `tools` are least-privilege; `inherit_context` matches the input strategy
- [ ] The prompt names every required input and a ≤2KB output contract
- [ ] A spawn checkpoint (signal → spawn) exists in the pipeline so it is reached mechanically
- [ ] A real spawn returned a distilled report, not raw dumps
