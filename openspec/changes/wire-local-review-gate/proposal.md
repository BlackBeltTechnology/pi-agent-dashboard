# Wire a local review gate into ship-it, and plug the enforcers that already exist

## Why

Two gaps, same root cause: **the project owns review capability it never runs.**

**1. The semantic reviewer runs too late.** `review-code` exists, is
engine-agnostic, and its own doctrine names the inner loop as its home. But
`ship-it`'s procedure goes `harness green → ship-change`, so the first reviewer
that ever reads a diff is CodeRabbit — ~5 minutes after a push, on a metered
quota, at the point where acting on a finding costs a force-push cycle. Every
defect a local reviewer would have caught is paid for twice.

This matters more than a lint rule because the strongest defect found while
scoping this ladder is not statically detectable:

```
packages/server/src/session/replay-compaction.ts:43
  * COUPLING: this rule is defined by `packages/client/src/lib/chat/event-reducer.ts`
```

Server replay logic mirrors client reducer rules, enforced by a comment. No
linter, no SAST, no dependency graph catches that. A reviewer holding the diff
**and the change's intent** does.

**2. Three enforcers are written, working, and wired to nothing.** The repo has
14 scripts in `scripts/`. `verify-release-deps`, `check-skill-frontmatter`, and
`verify-lockfile-versions` are wired into CI. These are not:

| Script | Wired into |
|---|---|
| `i18n-lint.mjs` | npm script only — no CI, no `quality:changed`, no `ship-it` |
| `i18n-parity.mjs` | npm script only |
| `split-large-agents.mjs` | **nowhere** — and the 30 KB cap it exists to fix is currently breached twice |

Buying new analysis while owned enforcers sit unplugged is spending on capability
the project already has.

## What Changes

- **Add a review checkpoint to `ship-it` (new step 4.5).** After the harness is
  green and before `ship-change` is driven, invoke `review-code` with the diff
  **plus the change's intent** (`proposal.md` + the task text). The reviewer
  engine is a **role-aliased model**, not the CodeRabbit CLI — the inner loop must
  not spend the cloud quota that the PR gate needs (`review-code`'s own rule).
- **Route findings through the existing loop.** `issue(blocking)` findings
  re-enter `ship-it`'s step-4 fix loop under its existing no-progress bound;
  every other severity is reported and does not block. The bound is shared, not
  new — a review that cannot converge must hit the same escape hatch and write
  `SHIP_IT_BLOCKED.md` rather than spin.
- **Wire `i18n:lint` and `i18n:parity`** into the quality gate.
- **Wire the AGENTS.md size cap.** `split-large-agents.mjs` gains a `--check`
  mode and a caller, so the 30 KB cap is enforced rather than documented.
- **Add `scripts/check-conventions.mjs`** — one script, the repo's established
  pattern, covering the mechanically-checkable AGENTS.md rules that are actually
  violated: docs using ASCII box-drawing instead of Mermaid (4), browser
  scenarios living in `qa/tests/*.sh` instead of Playwright specs (3), the root
  AGENTS.md per-file-index ban (currently clean — a regression guard), and the
  missing `## Discipline Skills` line (35 of 63 active proposals).
- **The Discipline-Skills check is ADVISORY, by contract.** The standing
  `openspec-discipline-wiring` spec requires *"The convention is advisory, not
  gating."* This change does not override that requirement; the check reports and
  exits zero on that rule. Making it gating would be a deliberate spec
  modification and is raised as an open question, not assumed.
- **Record that ast-grep was evaluated and rejected.** A structural-rule engine
  was considered for AGENTS.md enforcement and measured against the repo: every
  code-shaped convention is either already obeyed (0 real `client → server`
  imports — the 4 matches are comments) or legitimately "violated" by design
  (of 604 raw hex literals in the client, ~447 are in `themes.ts`, `index.css`,
  and `monaco-theme.ts`, i.e. the token-definition files where hex belongs). The
  violated rules are markdown/filesystem-shaped, which an AST engine cannot read.
  Documenting the negative result prevents re-litigating it.

## Capabilities

### New Capabilities

- `local-review-gate` — the pre-push semantic review checkpoint: when it runs,
  what it is fed, how severities route, and how it terminates.
- `repo-convention-checks` — the `check-conventions.mjs` enforcer: which rules it
  covers, which are gating vs advisory.

### Modified Capabilities

- `ship-it-orchestrator` — gains step 4.5 between the harness gate and the
  inline `ship-change` drive; the red-test fix loop becomes a
  red-test-or-blocking-review fix loop under the same bound and same escape hatch.
- `code-quality-loop` — the oracle grows beyond Biome+tsc+vitest.
- `ui-i18n-coverage` — its checks become enforced rather than manual.
- `kb-dox-tree` — the byte cap becomes machine-checked.

## Non-Goals

- Replacing CodeRabbit. It remains the PR gate; this change demotes it from
  *primary reviewer* to *backstop*.
- Using the CodeRabbit CLI locally — evaluated, not chosen.
- Adding ast-grep or any new rule engine — evaluated, rejected, recorded.
- Making the Discipline-Skills convention gating (would modify an existing spec).
- Backfilling the 35 proposals missing `## Discipline Skills`.

## Impact

- `.pi/skills/ship-it/SKILL.md` — new step 4.5 + composed-skills list.
- `scripts/check-conventions.mjs` (new), `scripts/split-large-agents.mjs`
  (`--check` mode).
- `package.json` — gate wiring for the i18n and convention checks.
- `docs/code-quality.md`, `AGENTS.md` — delegated to DocScribe.
- **Every `ship-it` run gets slower and can now stop for a non-test reason.**
  That is the tradeoff being bought, and it is the main risk: a reviewer that
  emits a false `issue(blocking)` stalls an unattended run.

## Open Questions

- **Should the Discipline-Skills check become gating?** 35/63 is a 56% violation
  rate, which is evidence the advisory convention is not working. Fixing that
  means modifying `openspec-discipline-wiring`'s "advisory, not gating"
  requirement — a spec change with its own justification, deliberately not
  smuggled in here.
- **Does step 4.5 run on every change, or only non-trivial ones?**
  `review-code` explicitly excludes one-line/mechanical changes as
  overhead > benefit. `ship-it` needs a cheap, deterministic triviality test, or
  it will spend a review on a typo fix.
- **What is the reviewer's no-progress bound?** Sharing step 4's bound risks a
  red test and a blocking finding together exhausting it prematurely.
- **Which role alias backs the reviewer**, and what happens when it is
  unconfigured — hard fail, or skip with a warning? Silently skipping turns a
  gate into decoration.

## Discipline Skills

- `review-code` — the change wires this skill in; its severity taxonomy and stop
  condition are the contract being implemented.
- `doubt-driven-review` — step 4.5 gains the power to halt an unattended ship;
  stress that before it stands.
- `observability-instrumentation` — a review gate that stalls a headless run must
  say why, in a place a human finds later.
- `code-simplification` — four rules in one new script is the ceiling; resist
  growing `check-conventions.mjs` into a framework.
