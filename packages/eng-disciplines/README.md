# @blackbelt-technology/pi-dashboard-eng-disciplines

Cross-cutting **engineering-discipline** skills for pi sessions. These are
*orthogonal* to the openspec pipeline — they slot into any stage without
competing for its triggers. Adapted from
[Addy Osmani's agent-skills](https://github.com/addyosmani/agent-skills) and
[NousResearch's hermes-agent](https://github.com/NousResearch/hermes-agent)
(both MIT; see [`NOTICE`](./NOTICE)).

## Why this package exists

The repo's openspec skills (`openspec-explore`, `openspec-new-change`,
`openspec-apply-change`, `code-review`, `ship-change`, …) already own the
DEFINE→PLAN→BUILD→VERIFY→REVIEW→SHIP lifecycle — and that pipeline is a *shipped
product* (bundled into the Electron app). Importing a second lifecycle pack
verbatim would put two workflows in a trigger-fight and degrade a user-facing
surface.

So this package deliberately ships **only the disciplines openspec does not
cover**, with every `description` retargeted so it never fires on
`spec` / `plan` / `build` / `ship` / `review` verbs.

## Skills

| Skill | Fills the gap | Fires on (not openspec verbs) |
|-------|---------------|-------------------------------|
| `interview-me` | pre-spec intent extraction, upstream of `openspec-explore` | "interview me", "grill me", underspecified ask |
| `doubt-driven-review` | in-flight adversarial check, per-decision (≠ post-hoc diff review) | "stress-test this", "verify before commit", "are we sure" |
| `review-code` | engine-agnostic inner-loop review *discipline* (≠ the cloud PR gate) | "review this code", "review my diff", "is this change good", "review before commit" |
| `code-simplification` | active simplify pass (vs the passive simplicity-first rule) | "simplify this", "reduce complexity", "clean up" |
| `security-hardening` | security discipline (no prior equiv) | "security audit", "harden", "threat model" |
| `performance-optimization` | measure-first perf (no prior equiv) | "it's slow", "profile", "optimize perf" |
| `observability-instrumentation` | runtime visibility (no prior equiv) | "add metrics/tracing/logging", "instrument" |
| `systematic-debugging` | post-failure root-cause discipline (no prior equiv) | "root cause this", "why is this failing", "debug systematically" |
| `node-inspect-debugger` | runtime state a `console.log` can't reach; jiti-verified breakpoints | "set a breakpoint", "inspect runtime state", "console.log isn't enough" |
| `scenario-design` | test-scenario design (ISTQB) before the bug exists (≠ post-bug `systematic-debugging`) | "design test scenarios", "find edge cases", "is this spec testable" |

> **On `review-code` vs the cloud gate.** The openspec pipeline does not own a
> reviewer *discipline* — it delegates post-hoc review to a cloud tool
> (CodeRabbit, via `rabbit-code-review`), which is rate-limited and therefore
> unfit for a per-change inner loop. `review-code` fills exactly that gap: the
> engine-agnostic discipline (WHAT to look for, severity taxonomy, review→fix
> loop) that runs inline on an unlimited model engine before commit. The cloud
> gate stays reserved for the PR. This is why `review-code` ships here while
> `code-review-and-quality` (below) does not — it is a discipline, not a second
> lifecycle.

### Deliberately excluded

Everything in Addy's pack that overlaps the shipped openspec pipeline or existing
project skills: `spec-driven-development`, `planning-and-task-breakdown`,
`idea-refine`, `incremental-implementation`, `frontend-ui-engineering`,
`code-review-and-quality`, `shipping-and-launch`, `browser-testing-with-devtools`,
`ci-cd-and-automation`, `git-workflow-and-versioning`, etc.

## Scope

**Dev-only.** This package is *not* bundled into the Electron app's
`bundled-extensions` (unlike the openspec skills). It loads in working-tree pi
sessions via the `pi.skills` manifest entries. Promoting any of these to a
shipped surface is a separate, explicit decision.

## How loading works

pi auto-discovers each `.pi/skills/<name>/SKILL.md` listed under `pi.skills` in
`package.json`. Skills load by natural-language trigger from their frontmatter
`description` — no manual invocation.

## Attribution

Most skill bodies are reproduced under MIT from Addy Osmani's `agent-skills`,
with only the frontmatter `name`/`description` (trigger routing) modified. The
`systematic-debugging` and `node-inspect-debugger` skills are ported under MIT
from NousResearch's `hermes-agent` and adapted to this repo's jiti-based
TypeScript stack (the emitted-JS pitfall is corrected, and `cdp-inspect.ts` is a
dependency-free TypeScript rewrite of the upstream CDP scope-walker). The
`scenario-design` skill is repo-authored (MIT, `author: robson`) — no
third-party attribution. The `review-code` skill is repo-authored (MIT) —
distilled from public methodology (Google Engineering Practices, the Conventional
Comments spec) with no copied code. Full attribution and license in
[`NOTICE`](./NOTICE).
