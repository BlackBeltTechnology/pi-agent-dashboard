# Code Discipline — Expanded

Expands `AGENTS.md` "Code Instructions" with concrete patterns, anti-patterns, and examples. The canonical short form is in `AGENTS.md`; this reference exists so when the **`implement`** skill loads on an implementation trigger, the agent has the discipline rules in foreground with worked examples.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

### Do

- State your assumptions explicitly at the top of your response.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists than what was requested, say so. Push back when warranted.
- Use `ask_user` (the tool, not plain text) when you need clarification, confirmation, or a choice.
- **Read the file before claiming anything about it.** No claims about code you have not opened.

### Don't

- ❌ Guess at filenames / function signatures / behaviour without reading.
- ❌ Silently pick an interpretation when two reasonable ones exist.
- ❌ Push ahead with a "best guess" on a major change.
- ❌ Hide a tradeoff because surfacing it makes the work look harder.

### Worked example

User asks: "Add caching to the proposal endpoint."

❌ Bad: Immediately add an in-memory `Map` cache and write code.

✅ Good:
> Two questions before I implement:
> 1. Per-process in-memory cache (cheap, lost on restart) or persistent (Redis / file)? The codebase doesn't currently use either, so this adds a new dependency direction.
> 2. What's the invalidation trigger? Time-based TTL, manual `POST /api/cache/invalidate`, or event-driven (e.g. clear when a proposal is attached)?
>
> If you have no strong opinion, my recommendation is: per-process Map, 30 s TTL, no manual invalidation. Smallest possible change. Want me to proceed with that?

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

### Anti-patterns to avoid

- Adding a `config` argument "in case we want to customize later" → YAGNI. Add it when the second call site needs it.
- Wrapping a 3-line function in a class → unjustified ceremony.
- Adding `try/catch` around code that can't throw → noise.
- Adding `interface` for a single implementation → premature abstraction.
- "What if the user passes null?" for an internal helper called once → impossible scenario.

### The senior-engineer test

After writing, look at your diff and ask: **"Would a senior engineer say this is overcomplicated?"** If yes, rewrite. The most common cuts:

- Inlined a "helper" that was used once
- Removed a config option nobody asked for
- Replaced 3 layers of abstraction with a direct call
- Deleted error handling for impossible cases

### DRY rule

Extract a shared helper / class / component **when the same pattern appears in multiple places**. Don't pre-extract for a single call site. The mistake to avoid is both:
- Pre-extracting (creating a "reusable" thing with one user) AND
- Not extracting when duplication already exists.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

### When editing existing code

- ❌ Don't "improve" adjacent code, comments, or formatting.
- ❌ Don't refactor things that aren't broken.
- ❌ Don't change indentation / style preferences "while you're there".
- ✅ Match existing style, even if you'd do it differently.
- ✅ If you notice unrelated dead code, **mention it** — don't delete it.

### Orphan rule

When your changes create orphans (unused imports, variables, functions):
- ✅ Remove imports/variables/functions that **your changes** made unused.
- ❌ Don't remove **pre-existing** dead code unless asked. That's a separate task.

### The test

Every changed line should trace directly to the user's request. If you can't justify a hunk in terms of the original ask, drop it.

## 4. Goal-Driven Execution (TDD)

**Define success criteria. Loop until verified.**

### Transform vague tasks into testable goals

| Vague | TDD-shaped |
|-------|------------|
| "Add validation" | "Write tests for invalid inputs, then make them pass" |
| "Fix the bug" | "Write a test that reproduces it, then make it pass" |
| "Refactor X" | "Ensure tests pass before and after" |
| "Make it faster" | "Write a benchmark, set a target, optimize until met" |

### TDD loop

```
   ┌───────────────────────────────────────────────┐
   │                                               │
   │   1. Write / update test for desired behaviour│
   │              │                                │
   │              ▼                                │
   │   2. Run test → MUST fail (proves it's        │
   │              │   actually testing something)  │
   │              ▼                                │
   │   3. Write minimal code to pass               │
   │              │                                │
   │              ▼                                │
   │   4. Run test → passes                        │
   │              │                                │
   │              ▼                                │
   │   5. Refactor (tests still pass)              │
   │                                               │
   └───────────────────────────────────────────────┘
```

Step 2 is non-optional. A test that passes before you write the code is testing the wrong thing.

### Multi-step plan format

For non-trivial tasks, write a brief plan:

```
1. [Step]            → verify: [check]
2. [Step]            → verify: [check]
3. [Step]            → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Communication

- At every step, give a **high-level explanation** of what changed. Don't dump diffs without summary.
- Use `ask_user` (the tool — `method: confirm | select | multiselect | input | batch`) when you need clarification, confirmation, or a choice.
  - ❌ Writing "Do you want me to do X? (y/n)" as plain text
  - ✅ `ask_user(method: "confirm", title: "Do X?")`
- Keep responses tight. Long-form is appropriate for explore mode; tight diffs + a 2-line summary are appropriate for implementation.

---

**These guidelines are working if:**
- Fewer unnecessary changes in diffs (smaller, more focused PRs)
- Fewer rewrites due to overcomplication
- Clarifying questions come **before** implementation rather than **after mistakes**
