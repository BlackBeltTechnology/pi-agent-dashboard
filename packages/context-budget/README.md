# @blackbelt-technology/pi-dashboard-context-budget

Measure what a pi session actually sends the model, every turn, before any work happens.

The meter attaches to `before_provider_request`, which fires after the provider payload
is built and before it is sent — so the numbers are the real request, not a reconstruction
of one. `ctx.getSystemPrompt()` reports pi's system prompt string, which is not the same
thing as the serialized payload.

## Why

A context trim can apply cleanly, produce a valid config, and change nothing on the wire.
That happened during this package's own development: a `"skills": ["-…"]` exclusion in
project settings was accepted, looked correct, and was a silent no-op (package-provided
skills must be excluded in the *package entry*). Only a before/after measurement caught it.

`diff --expect-removed` encodes that lesson: it exits non-zero when something you expected
to remove is still on the wire.

## Usage

```bash
# measure the current directory's session cost
npx context-budget measure -o before.json

# ...change settings / skills / tools...
npx context-budget measure -o after.json

# prove the change reached the wire
npx context-budget diff before.json after.json --expect-removed ctx-doctor,memory_remove
```

`measure` runs one headless pi turn (`pi -e <meter> -p "reply with the single word: ok"`)
in the current working directory, so it reflects that project's settings, skills and
extensions.

To measure the effect of dropping tools without editing any config:

```bash
CONTEXT_BUDGET_DROP=memory_remove,recall npx context-budget measure -o trimmed.json
```

## What it reports

- **payload** total, split into `system` / `tools` / `messages`
- **system-prompt blocks** — `skills-catalogue`, `project-context`, `memory-policy`, and
  `other`. The parts always sum to the whole: a block that stops matching shows up as
  `other` growing rather than as bytes disappearing.
- **per-tool schema bytes**, sorted — the cost of each registered tool
- **per-skill catalogue bytes** — what each advertised skill costs every turn

## Library

```ts
import { analyzePayload, comparePayloads, checkBudget } from "@blackbelt-technology/pi-dashboard-context-budget";

const b = analyzePayload(capturedPayload);
const { ok, violations } = checkBudget(b, { maxPayloadBytes: 120_000 });
```

`analyzePayload` is pure — no pi, no network, no filesystem — so budget assertions can run
in CI against a stored capture.

## Env

| Variable | Meaning |
|---|---|
| `CONTEXT_BUDGET_OUT` | where the meter writes its capture (default `./context-budget.json`) |
| `CONTEXT_BUDGET_DROP` | comma-separated tool names to deactivate via `setActiveTools` before measuring |
