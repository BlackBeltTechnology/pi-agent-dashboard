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

**2. Owned enforcers are wired to nothing — and two of them are broken.** The
repo has 41 files in `scripts/`. `verify-release-deps`,
`check-skill-frontmatter`, and `verify-lockfile-versions` are wired into CI.
These are not (all counts measured on this branch, and MUST be re-derived at
implementation time):

| Enforcer | Wired into | Actually works today? |
|---|---|---|
| `i18n-lint.mjs` | npm script only | Only advisory — `process.exit(STRICT ? 1 : 0)`; needs `--strict` to gate. Exits 0 today |
| `i18n-parity.mjs` | npm script only | **NO — exits 1.** Reads `packages/client/src/lib/i18n.tsx`, which moved to `lib/i18n/` |
| `kb dox lint` (`packages/kb/src/dox.ts`) | **nowhere** | Yes, but un-gateable as-is: exits 1 on **any** of 7 issue kinds. Owns `AGENTS_BYTE_CAP = 30000` + `over-threshold` / `arm:"bytes"`; reports **59** issues today |

The 30 KB cap is breached **once** today (`docs/AGENTS.md`, 31521 bytes; the next
largest, `packages/shared/src/AGENTS.md` at 29903, is under).

The `i18n-parity` breakage and the stale paths in this proposal's own ast-grep
evidence share one root cause: **a client directory reorganisation**
(`lib/i18n.tsx` → `lib/i18n/`, `lib/themes.ts` → `lib/theme/themes.ts`) left
stale path references in unwired scripts. An enforcer nobody runs is an enforcer
nobody notices rotting — which is the argument for wiring, restated.

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
- **Repair, then wire, `i18n:lint` and `i18n:parity`.** `i18n-parity.mjs` reads
  **two** stale paths (`lib/i18n.tsx` and `lib/i18n-hu.ts`, both moved under
  `lib/i18n/`); both are fixed first. `i18n:lint` is invoked with `--strict` so it
  gates rather than advises.
- **Wire the AGENTS.md size cap through `kb dox lint --json`**, failing only on
  `over-threshold` / `arm:"bytes"`. The enforcer already implements the cap, so no
  second cap checker is written — but it cannot be wired unfiltered: its CLI exits
  1 on **any** of its 7 issue kinds, and the tree has 59 issues today.
- **The enforcers gate inside `ship-it`, as a pre-review step (4.4).**
  `quality:changed` has no automated caller today — not CI, not `ship-it`, not
  `ship-change` — so wiring "gating" checks there would gate nothing.
- **Add `scripts/check-conventions.mjs`** — one script, the repo's established
  pattern, covering four mechanically-checkable AGENTS.md rules. Each rule's
  **detector is defined precisely in `design.md` (D6)**, because every count below
  is a function of its detector:
  - ASCII box-drawing instead of Mermaid — **4 violations** under the narrow
    detector (box-drawing inside a fenced block, excluding directory-tree rows).
    Two files (`README.md`, `docs/electron-session.md`) contain legitimate
    directory trees and MUST NOT be flagged.
  - Browser scenarios in `qa/tests/*.sh` instead of Playwright specs —
    **0 violations today**; this rule ships as a pure regression guard. The three
    files that mention browser-ish terms (`03-websocket`, `04-ws-ticket-auth`,
    `10-faux-model`) assert WS/API behaviour, not rendered UI, and are correctly
    placed in the per-OS VM matrix.
  - The root AGENTS.md per-file-index ban — currently clean, a regression guard.
  - The missing `## Discipline Skills` line — **34 of 74** active proposals.
- **The Discipline-Skills check is GATING for touched proposals** (decided
  during artifact creation; this reverses the proposal's original advisory
  stance). The standing `openspec-discipline-wiring` requirement *"The convention
  is advisory, not gating"* is therefore **modified in this change** — as is its
  sibling *"permits omission only when no discipline applies"*, which would
  otherwise instruct a touched proposal to both omit and include the heading. The
  gate is scoped to proposals the change touches, so the 34-proposal backlog is
  not blocked and no backfill is required.
- **Record that ast-grep was evaluated and rejected.** A structural-rule engine
  was considered for AGENTS.md enforcement and measured against the repo: every
  code-shaped convention is either already obeyed (0 real `client → server`
  imports — the 4 matches are comments) or legitimately "violated" by design
  (of 678 raw hex literals in the client, 451 — 66% — are in
  `lib/theme/themes.ts`, `index.css`, and `lib/theme/monaco-theme.ts`, i.e. the
  token-definition files where hex belongs). The
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
- `openspec-discipline-wiring` — the "advisory, not gating" requirement becomes
  gating-for-touched-proposals.

## Non-Goals

- Replacing CodeRabbit. It remains the PR gate; this change demotes it from
  *primary reviewer* to *backstop*.
- Using the CodeRabbit CLI locally — evaluated, not chosen.
- Adding ast-grep or any new rule engine — evaluated, rejected, recorded.
- Backfilling the 34 proposals missing `## Discipline Skills`.
- Clearing the wider `kb dox lint` backlog — 59 issues across 5 kinds, of which
  exactly 1 is the byte-cap breach. Only the byte arm is gated here.
- Hardening `ship-it`'s red-test bound, which has the same non-termination shape
  as the review bound this change fixes. Named deliberately, deferred.

## Impact

- `.pi/skills/ship-it/SKILL.md` — new steps 4.4 (enforcers) + 4.5 (review) +
  composed-skills list.
- `scripts/check-conventions.mjs` (new); `scripts/i18n-parity.mjs` (stale-path
  repair). **No `--check` mode is added to `split-large-agents.mjs`** — `kb dox
  lint` already owns the cap.
- `package.json` — an enforcer script that `ship-it` invokes.
- `docs/code-quality.md`, `AGENTS.md` — delegated to DocScribe.
- **Every `ship-it` run gets slower and can now stop for a non-test reason.**
  That is the tradeoff being bought, and it is the main risk: a reviewer that
  emits a false `issue(blocking)` stalls an unattended run.

## Open Questions

All four original open questions were settled with the user during artifact
creation; rationale lives in `design.md` (D1, D3, D4, D7).

| Question | Decision |
|---|---|
| Discipline-Skills check gating? | **Gating** for touched proposals; `openspec-discipline-wiring` modified here |
| Triviality escape for step 4.5? | **None** — every `ship-it` run is reviewed |
| Reviewer bound | **Hard numeric cap: review → fix → re-review, never a third round** (revised after doubt-review; the shared step-4 bound provably does not terminate with a model in the loop) |
| Reviewer engine / unconfigured | **`@review` alias, REQUIRED** — an unconfigured role is a hard failure, not a fallback |

A doubt-driven-review cycle (single-model + cross-model on `@propose-review-1`)
corrected this proposal's factual base and reversed two of the four decisions
above. See `design.md` for the revised rationale.

## Discipline Skills

- `review-code` — the change wires this skill in; its severity taxonomy and stop
  condition are the contract being implemented.
- `doubt-driven-review` — step 4.5 gains the power to halt an unattended ship;
  stress that before it stands.
- `observability-instrumentation` — a review gate that stalls a headless run must
  say why, in a place a human finds later.
- `code-simplification` — four rules in one new script is the ceiling; resist
  growing `check-conventions.mjs` into a framework.
