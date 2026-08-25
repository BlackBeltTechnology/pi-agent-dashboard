# SKILL.md — code-simplification index

Pull-only condensed map. Source: packages/eng-disciplines/.pi/skills/code-simplification/SKILL.md. Keys on triggers, five principles, Chesterton's Fence gate, pattern→signal tables, incremental process, language guidance.

## When to Use
- Triggers — "simplify this", "reduce complexity", "clean this up", "make this clearer". After feature works + tests pass but feels heavy; review flags readability; deep nesting/long fns/unclear names; scattered related logic; post-merge duplication.
- NOT — code already clean; don't understand it yet; perf-critical and simpler = measurably slower; about to rewrite module entirely.

## The Five Principles
- 1 Preserve behavior exactly — same output/errors/side-effects/ordering; tests pass unmodified; unsure → don't.
- 2 Follow project conventions — read CLAUDE.md/conventions, match neighboring code; breaking consistency = churn.
- 3 Clarity over cleverness — dense ternary chain → if/else mapping; chained reduce → named Map step.
- 4 Maintain balance — don't inline away named helpers, don't merge unrelated logic, don't strip extensibility abstraction; line count ≠ simplicity.
- 5 Scope to what changed — default recent code only; no drive-by refactors.

## The Simplification Process

### Step 1: Understand Before Touching (Chesterton's Fence)
- Fence exists for a reason — understand before removing. Answer: responsibility, callers/callees, edge cases/error paths, defining tests, why written this way (perf/platform/history), git blame. Can't answer → not ready.

### Step 2: Identify Simplification Opportunities
- Structural — 3+ nesting → guard clauses/helpers; 50+ line fns → split; nested ternaries → if/else/switch/lookup; boolean flags `doThing(true,false,true)` → options objects; repeated conditionals → named predicate.
- Naming — generic (`data`,`result`,`temp`) → describe content; abbreviations → full words (keep `id`,`url`,`api`); misleading names → rename; "what" comments → delete, "why" comments → keep.
- Redundancy — duplicated 5+ lines → shared fn; dead code → remove after confirming; useless wrapper → inline; factory-for-a-factory → direct; redundant type assertions → remove.

### Step 3: Apply Changes Incrementally
- One simplification at a time; run tests after each; fail → revert and reconsider.
- Refactors separate from feature/bug PRs — two PRs, not one. Rule of 500 — >500 lines touched → codemods/sed/AST transforms.

### Step 4: Verify the Result
- Compare before/after — genuinely easier? new inconsistent patterns? diff clean/reviewable? teammate approve? Harder → revert.

## Language-Specific Guidance
- TypeScript/JS — drop `async` wrapper, `||` conditional assignment, `filter()` manual array build, return boolean expr directly.
- Python — dict comprehension; early-return guard clauses. React/JSX — variant+label ternaries; prop drilling → flag, don't auto-refactor.

## Common Rationalizations
- "Fewer lines is always simpler" — 1-line nested ternary ≠ 5-line if/else. "Types self-document" — structure, not intent. "Abstraction might be useful later" — speculative = complexity without value. "Refactor while adding feature" — split them.

## Red Flags
- Simplification requires modifying tests (behavior changed); result longer/harder; renaming to own preferences; removing error handling; simplifying un-understood code; batched changes; out-of-scope refactor.

## Verification
- Tests pass unmodified; build no new warnings; linter/formatter passes; each change incremental + reviewable; clean diff; conventions followed; error handling intact; no dead code left; teammate/reviewer approves.
