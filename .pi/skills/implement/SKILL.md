---
name: implement
description: Disciplined implementation in pi-agent-dashboard. Pairs (a) the 3-component rebuild matrix — extension→reload, server→restart, client→build+restart, openspec-apply→full rebuild — with (b) the project's code discipline rules (TDD, simplicity-first, surgical changes). Use when starting to write code, after editing src/extension|src/server|src/client, when unsure what to rebuild after a change, or before committing. Loads on triggers like "I changed the bridge", "rebuild and restart", "implement X", "after edit", "TDD this", "how do I land this change". Skip for trivial edits.
---

# Implement

Two halves: **how to write the change** (discipline) and **how to land it in the running system** (rebuild + restart).

The skill exists because both halves are easy to get wrong:
- Agents over-engineer simple changes when they're not anchored.
- Agents rebuild the wrong component (or worse, all components when they didn't need to) after editing files.

## Quick decision tree

```
        Did you edit code?
                │
       ┌────────┴────────┐
       │                 │
       ▼                 ▼
   src/extension/    src/server/ or src/shared/
       │                 │
       ▼                 ▼
   npm run reload    curl -X POST localhost:8000/api/restart
                     (no build step — jiti runs TS directly)

   src/client/ (dev mode)   →  nothing, Vite HMR
   src/client/ (prod mode)  →  npm run build && restart
   Multi-component / openspec  →  npx tsx ./scripts/full-rebuild.ts
```

Quick check current mode:
```bash
npx tsx ./scripts/check-mode.ts           # prints "dev" or "production"
```

Restart server (preserves mode unless overridden):
```bash
npx tsx ./scripts/restart-server.ts             # graceful restart, keeps mode
npx tsx ./scripts/restart-server.ts --dev       # force dev mode
npx tsx ./scripts/restart-server.ts --prod      # force production mode
```

Full rebuild (after `openspec-apply` or multi-component change):
```bash
npx tsx ./scripts/full-rebuild.ts
```

> Scripts are TypeScript (cross-platform). All invocations use `npx tsx` so they work identically on Linux, macOS, and Windows. `tsx` is already a project dep.

Full matrix with edge cases (dev-mode fallback, fault-tolerant restart, single-restart-path rule) lives in [`references/rebuild-matrix.md`](references/rebuild-matrix.md).

## The discipline — write less code, write the right code

The full code-discipline reference lives in [`references/code-discipline.md`](references/code-discipline.md). It expands `AGENTS.md` "Code Instructions" with concrete patterns, anti-patterns, and examples. Headline rules:

| Rule | One-liner |
|------|-----------|
| 1. Think before coding | State assumptions. Ask via `ask_user` when unclear. Never speculate about unread files. Confirm major plans. |
| 2. Simplicity first | Minimum code that solves the problem. No speculative abstractions. "Would a senior engineer say this is overcomplicated?" |
| 3. Surgical changes | Touch only what you must. Don't "improve" adjacent code. Match existing style. Every changed line traces to the request. |
| 4. Goal-driven (TDD) | Write/update tests first → verify they fail → make them pass. Captures intent before code exists. |
| 5. Communication | High-level summary per change. Use `ask_user` (not plain text) when you need a choice. |

These rules also live in `AGENTS.md` so they're always in context. This skill loads on implementation triggers so they get foregrounded when the agent is about to write code.

## Running tests — tee→grep, never rerun

Never rerun `npm test` to inspect errors. Pipe once, grep many times:

```bash
npm test 2>&1 | tee /tmp/pi-test.log         # run once, capture
grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log    # find failures
grep -n -A 20 'FAIL ' /tmp/pi-test.log         # failure + context
```

For deeper test triage (per-package vitest configs, watch mode, coverage), see the **`debug-dashboard`** skill — its `references/test-failure-triage.md`.

## When the running system misbehaves

Implementing != debugging. If the dashboard starts misbehaving (server hung, bridge won't connect, blank page, tests failing for non-obvious reasons), switch to the **`debug-dashboard`** skill.

If your change went red in CI after `git push`, switch to the **`ci-troubleshoot`** skill.

## Related skills

- `openspec-new-change` — capture a non-trivial change as an OpenSpec proposal first
- `openspec-apply-change` — implement tasks from an OpenSpec change with the artifact workflow
- `openspec-verify-change` — validate implementation matches artifacts before archiving
- `code-review` — review the diff before committing
- `debug-dashboard` — diagnose a misbehaving running system
- `ci-troubleshoot` — diagnose failed CI runs after push
- `release-cut` — when the change is ready to ship as a versioned release
