# Skills as Subagents — Analysis, Scoring & Model Routing

How to turn pi **skills** into **subagents**, which of this repo's extension skills are
worth wrapping, what context/KB each needs to stay effective, and which model/provider
role best fits each function.

> Audience: maintainers deciding when to delegate a skill's work to an isolated
> subagent instead of running it inline in the main agent's context.

> **Note:** The portable, tech-stack-independent methodology for wrapping skills as subagents now lives in the [`skill-to-subagent`](../packages/authoring-toolkit/.pi/skills/skill-to-subagent/) skill — invoke `/skill:skill-to-subagent`. This doc is pi-agent-dashboard's *applied instance*: the scored skills (§3), the role map (§4), per-skill context/KB injection (§5), and the shipped wrapper agents (§7) are repo-specific and remain here.

## Table of contents

- [1. Skill vs. subagent — two mechanisms](#1-skill-vs-subagent--two-mechanisms)
- [2. The bridge: wrapping a skill as a subagent](#2-the-bridge-wrapping-a-skill-as-a-subagent)
- [3. Subagent-fitness scoring](#3-subagent-fitness-scoring)
- [4. Model / provider routing](#4-model--provider-routing)
- [5. Context, KB & sibling-skill injection per skill](#5-context-kb--sibling-skill-injection-per-skill)
- [6. The skill-authoring workflow](#6-the-skill-authoring-workflow)
- [7. Tier A wrappers shipped with this doc](#7-tier-a-wrappers-shipped-with-this-doc)
- [8. Follow-up: co-locating agents with their skill's package](#8-follow-up-co-locating-agents-with-their-skills-package)

---

## 1. Skill vs. subagent — two mechanisms

Skills are instructions loaded inline into the main agent; subagents are isolated workers spawned beside it with their own context window, model, and tools. The portable breakdown (fitness scoring, bridge recipe, context tuning) now lives in the [`skill-to-subagent` skill](../packages/authoring-toolkit/.pi/skills/skill-to-subagent/) — invoke `/skill:skill-to-subagent` for the complete procedure. This section summarizes the two mechanisms; see §3–§5 below for pi-agent-dashboard's scored skills, role map, and per-skill context.

## 2. The bridge: wrapping a skill as a subagent

The recipe for wrapping a skill as a thin spawn shell — frontmatter (model, inherit_context, tools), prompt shape, and SDK quirks — is detailed in the [`skill-to-subagent` skill](../packages/authoring-toolkit/.pi/skills/skill-to-subagent/). See that skill for the Mermaid diagram, YAML template, and context-tuning notes. The sections below (§3–§7) are pi-agent-dashboard's repo-specific application: scored fitness per skill, role-alias routing, per-skill KB injection, and the shipped agents.

## 3. Subagent-fitness scoring

Scored on: **context-cost-if-inline · clear input→distilled-output contract · low interactivity ·
self-contained (not mutating the parent tree needing sync-back)**. 21 distinct extension skills
(`packages/*/.pi/skills`, excluding the `electron/resources` bundled dupes).

| Skill (package) | Fit /5 | Why |
|---|---|---|
| **video-transcription** | 5 | Long deterministic pipeline, file→SRT, zero interaction |
| **session-to-guideline** (authoring-toolkit) | 5 | Reads a *huge* JSONL transcript → one distilled doc |
| **doc-summarizer** (document-converter) | 5 | Already fans out to child subagents; massive input→summary |
| **kb-search** (kb) | 5 | Read-only ranked lookup — the canonical Explore pattern |
| **security-hardening** (eng-disciplines) | 4 | Audit phase = read-heavy analysis → findings report (fix inline) |
| **systematic-debugging** | 4 | Evidence-gathering → root-cause report is isolatable (fix inline) |
| **anti-slop-frontend** | 4 | Advisory design review → countable findings list |
| **document-converter** | 4 | Self-contained convert pipeline, file→file |
| **pi-dashboard** (extension) | 4 | Scripted REST orchestration of other sessions |
| **dashboard-plugin-scaffold** | 3 | One `ask_user` batch up front, then prescriptive writes |
| **performance-optimization** | 3 | Profile/measure phase isolatable; fix inline |
| **observability-instrumentation** | 3 | Mutates code but scoped |
| **code-simplification** | 3 | Mutation + benefits from parent context |
| **browser** (extension) | 3 | Task automation isolatable, but often user-visual |
| **kb-setup** / **project-init** | 3 | Self-contained setup, but the confirm gate must stay in the parent |
| **skill-creator** (authoring-toolkit) | 2 | Interactive (asks for examples) + writes files |
| **doubt-driven-review** | 2 | In-flight adversarial check needs live decision context |
| **frontend-mockup-loop** | 2 | Many user visual steers in a tight loop |
| **node-inspect-debugger** | 1 | Interactive stepping / breakpoints |
| **interview-me** | 0 | One-question-at-a-time loop — its own SKILL.md says "interactive only, never in CI/autonomous loops" |

**Tiers**

- **Tier A — wrap now (fit 5):** `video-transcription`, `session-to-guideline`, `doc-summarizer`, `kb-search`.
- **Tier B — wrap the read/analysis phase only (fit 4):** `security-hardening`, `systematic-debugging`, `anti-slop-frontend`, `document-converter`, `pi-dashboard`. Split "investigate → report" (subagent) from "mutate → verify" (inline).
- **Tier C — leave inline (fit ≤2):** gated on `ask_user` loops or live visual review.

## 4. Model / provider routing

Current role map (`~/.pi/agent/providers.json`) — recommendations use **role aliases** so they
track whatever the operator assigns:

| Role | Resolves to | Character |
|---|---|---|
| `@fast` | `opencode-go/deepseek-v4-flash` | Cheap, fast, multimodal — glue / lookup / vision |
| `@compact` | `anthropic/claude-haiku-4-5` | Cheap-but-capable — summarise / merge |
| `@planning` / `@coding` / `@research` | `anthropic/claude-opus-4-8` | Strong reasoning / code / long-context synthesis |
| `@vision` | `opencode-go/deepseek-v4-flash` | Screenshot / rendered-UI review |
| *(direct)* `opencode-go/glm-5.2` | GLM-5.2, `reasoning:true`, **1M ctx** | Reasoning + very-long-context jobs |

Routing principle by **function**, not by skill name:

| Function | Best role/model | Rationale |
|---|---|---|
| Deterministic pipeline / orchestration glue | `@fast` | No heavy reasoning; cost dominates |
| Read-only lookup / exploration | `@fast` | Speed + cheap, distilled output |
| Long-context synthesis (transcripts, big docs) | `@research` (opus); `glm-5.2` if input > ~200K tokens | Quality synthesis / 1M window |
| Reasoning-heavy analysis (security audit, root-cause) | `glm-5.2` (reasoning) or `@research` | Deep step-by-step over code |
| Code writing / refactor | `@coding` | Strongest edit fidelity |
| Map-reduce (chunk → merge) | chunk workers `@fast`, merge `@compact`/`@research` | Cheap per chunk, strong merge |
| Visual / screenshot review | `@vision` | Multimodal |

Per-Tier-A/B model pick:

| Subagent (wraps) | Model role | Why |
|---|---|---|
| Transcribe (`video-transcription`) | `@fast` | Pipeline glue around the Soniox API |
| SessionGuideline (`session-to-guideline`) | `@research` (→ `glm-5.2` if transcript > 200K) | Long-context synthesis into a playbook |
| DocSummarize (`doc-summarizer`) | merge `@research`; chunk workers `@fast` | Map-reduce |
| KbLookup (`kb-search`) | `@fast` | Read-only ranked lookup |
| SecurityAudit (`security-hardening`) | `glm-5.2` / `@research` | Careful reasoning over untrusted-input paths |
| DebugRootCause (`systematic-debugging`) | `glm-5.2` / `@research` | Evidence-first reasoning |
| AntiSlopReview (`anti-slop-frontend`) | `@vision` | Reviews rendered UI |
| DocConvert (`document-converter`) | `@fast` | Deterministic conversion |
| DashboardOps (`pi-dashboard`) | `@fast` | REST orchestration glue |
| Audit (security-hardening + performance-optimization) | `glm-5.2` / `@research` | Deep step-by-step analysis over untrusted-input + latency-critical paths; returns findings report (fix inline) |
| DocScribe (docs prose writer) | `@compact` | Caveman-style `docs/` updates for landed changes; AGENTS.md Rule-6 delegation target |

## 5. Context, KB & sibling-skill injection per skill

What to *present* to a wrapped skill to keep it effective (beyond its own bundled `references/`,
which progressive disclosure already loads):

- **video-transcription** — Soniox API key; input/output paths. TS helpers only.
- **session-to-guideline** — session JSONL path; `extract_session.ts`; `skill_manage`/`memory` sinks.
- **doc-summarizer** — document-converter engine; `@fast` for chunk workers.
- **kb-search** — a built KB index; `--doc-type` scope; read-only toolset.
- **security-hardening** — codebase read access; `kb_search`; OWASP refs; fix phase stays inline.
- **systematic-debugging** — failing test/log paths; `kb_search`; `node-inspect-debugger` as sibling.
- **anti-slop-frontend** — `ui-contract.md`; design-token sources; pairs with `frontend-mockup-loop`.
- **document-converter** — the doc-engine facade; OCR flags.
- **pi-dashboard** — dashboard base URL + `/api/health`; the REST skill doc.
- **dashboard-plugin-scaffold** — gather the `ask_user` batch in the *parent*, pass answers in the prompt; monorepo paths.
- **performance-optimization** — the latency/throughput budget; profiler output paths.
- **code-simplification** — target files; test command; `code-quality` sibling.
- **browser** — target URL; `agent-browser` CLI; screenshot dir.

General multipliers: (a) **least-privilege tool allow-list** in frontmatter; (b) **`kb_search`** so
the child self-serves the repo map instead of the parent pre-loading files; (c) **sibling skills**
named in the prompt; (d) **`inherit_context`** tuned per skill.

## 6. The skill-authoring workflow

The authoring workflow — planning, initializing, editing, packaging, and iterating — is covered by two skills: [`skill-creator`](../packages/authoring-toolkit/.pi/skills/skill-creator/) for crafting new skills from scratch, and [`skill-to-subagent`](../packages/authoring-toolkit/.pi/skills/skill-to-subagent/) for turning an existing skill into an isolated worker. Invoke them as `/skill:skill-creator` and `/skill:skill-to-subagent` respectively.

Repo-specific conventions:
- Skills live at `packages/*/.pi/skills/<name>/` (or `.pi/skills/` for project skills); trigger by
  NL description or `/skill:name`.
- **Frontmatter YAML trap:** an unquoted `description` containing an inner `": "` parses as a nested
  mapping and the loader **silently drops the skill**. Quote the whole value, escape inner `"`.
  Enforced by `scripts/__tests__/skill-frontmatter.test.mjs`.
- Only `name` + `description` are read for triggering — put *all* "when to use" cues in `description`,
  not the body.
- Helper scripts in **TypeScript**, run with `bun` (or `node ≥22`), Node built-ins only, no build step.
- Caveman style for tree rows / architecture notes; readable prose for standalone docs like this one.

## 7. Tier A/B wrappers shipped with this doc

Generated alongside this doc under `.pi/agents/` (project tier — see §8):

| Agent file | Wraps / purpose | Model | `inherit_context` | Tier |
|---|---|---|---|---|
| `Transcribe.md` | `video-transcription` | `@fast` | false | A |
| `SessionGuideline.md` | `session-to-guideline` | `@research` | false | A |
| `DocSummarize.md` | `doc-summarizer` | `@research` (chunks `@fast`) | false | A |
| `KbLookup.md` | `kb-search` | `@fast` | false | A |
| `Audit.md` | `security-hardening` + `performance-optimization` analysis | `glm-5.2` / `@research` | false | B |
| `DocScribe.md` | `docs/` prose writer (Rule-6 delegation) | `@compact` | false | B |

Spawn via the `Agent` tool with the matching `subagent_type`. Each returns a distilled report,
not raw output — protecting the parent's context budget.

They live in the **project** `.pi/agents/` tier (not co-located with each skill's package) — see
§8 for why, and the follow-up to fix it.

## 8. Follow-up: co-locating agents with their skill's package

Goal: ship each wrapper agent inside the *same* package as the skill it wraps so installing the
package delivers both atomically — the same way skills are already bundled per-package.

**Current reality (verified 2026-07-07 against `~/Project/pi-dashboard-subagents`).** Agents are
resolved by the `pi-dashboard-subagents` extension's `resolveAgentMdPath()` (`extensions/agent.ts`).
It now has a **4-tier** lookup (commit `2dbd87a`), first match wins:

1. `<cwd>/.pi/agents/<type>.md` — `project`
2. `<getAgentDir()>/agents/<type>.md` — `user` (`~/.pi/agent/agents/`)
3. `<EXTENSION_ROOT>/agents/<type>.md` — `bundled` (the subagents package's own `agents/`)
4. `<installedPath>/agents/<type>.md` — `package` (any installed pi package), via a cached
   discovery index (`buildPackageAgentIndex`)

Two things about tier 4 matter for co-location:

- **Convention is `<package-root>/agents/*.md`, NOT `<pkg>/.pi/agents/`** — it mirrors the bundled
  tier's `<EXTENSION_ROOT>/agents/`. My original recommendation of `packages/<pkg>/.pi/agents/`
  was wrong.
- Tier 4 is **user-scope only today.** `buildPackageAgentIndex` filters `scope === "user"` and
  only sees packages listed as *configured pi packages*. This monorepo's workspace packages are
  NOT registered as configured pi packages, and project-scope is not indexed — so co-located
  agents here still won't be found until (a) project-scope discovery lands and (b) each package is
  a configured pi package.

**History + open gap.** The package tier shipped via change `add-package-agent-discovery-tier`
(merged PR #1, **archived** 2026-07-07) — but **user-scope only**. Its synced spec
(`openspec/specs/package-agent-discovery/spec.md`) states *"project-scoped packages SHALL NOT be
indexed,"* justified by *"`ExtensionContext` has no `isProjectTrusted()`."* **That justification is
now stale** — `ExtensionContext.isProjectTrusted()` and `SettingsManagerCreateOptions.projectTrusted`
both exist in the current SDK (verified). So **project-scope-when-trusted is not yet proposed**; it
needs a NEW follow-up change (thread `SettingsManager.create(cwd, agentDir, { projectTrusted:
ctx.isProjectTrusted() })`, drop the `scope === "user"` hard-filter, correct the `agent.ts:169`
comment + the spec). Only after that lands **and** the workspace packages are registered as
configured pi packages can the four wrappers move from project `.pi/agents/` into each skill
package's **`agents/`** dir:

| Wrapper | Target (package root, not `.pi/`) |
|---|---|
| `Transcribe.md` | `packages/video-transcription/agents/` |
| `SessionGuideline.md` | `packages/authoring-toolkit/agents/` |
| `DocSummarize.md` | `packages/document-converter/agents/` |
| `KbLookup.md` | `packages/kb/agents/` |

Rejected alternatives: a `worktreeInit`/build copy step into project `.pi/agents/` (a shim), or
moving them into `pi-dashboard-subagents/agents/` (discoverable but owned by the wrong package).
