---
session: 019e8a4e
week: 2026/W23
type: development
model: "@fast"
premium: true
premium_reason: "created 0 skill(s) / 1 memory(ies)"
upgrade_status: pending
openspec_changes: [add-ctx-tool-renderer]
proposal_excerpt: "The `context-mode` MCP plugin exposes a family of `ctx_*` tools (`ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_search`, `ctx_index`, `ctx_fetch_and_index`, `ctx_insight`). None of them are in the client…"
---

# How we did it: Add a `ctx_*` tool renderer to the dashboard client — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator kicked off with a single command: `/skill:openspec-apply-change add-ctx-tool-renderer`.
The real objective, spelled out in the attached OpenSpec proposal, was to stop the
dashboard client from dumping the seven high-frequency `context-mode` MCP tool results
(`ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`, `ctx_search`, `ctx_index`,
`ctx_fetch_and_index`, `ctx_insight`) as raw JSON through `GenericToolRenderer`, and
instead render them as scannable, collapsible cards with a dedicated parser + renderer.
This was a full spec-driven apply: build the parser, the renderer, wire the registry,
add tests, run the suite + build, add docs rows, and do a live visual check — 26 tasks.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change-name>` from **inside the worktree**, then
   immediately correct the skill-resolution path (see §5): "use the parent worktree's
   OpenSpec skills/definitions when in a git worktree."
2. Read every context file + the existing `tool-renderers/` infra (registry, types,
   an existing renderer like `AgentToolRenderer`, a sample `__tests__` file) to match
   conventions before writing a line.
3. **Harvest real fixtures first.** Scan the session `.jsonl` store for actual `ctx_*`
   result texts (one sample per tool, plus an `intent` and a "No results found" case).
   These become the parser's source of truth — do not hand-invent grammar.
4. Write the **pure parser** (`parseCtxResult(toolName, result, isError) → CtxResult`
   typed union) that strips the `⚠️ context-mode v…` banner, classifies errors, parses
   each tool's grammar, and **never throws** (raw fallback on any header miss).
5. Write the **renderer** that switches body on parsed `kind` (chips, code blocks,
   collapsed accordions, error card), then wire `registry.ts` (seven explicit `ctx_*`
   entries) + `ToolCallStep.tsx` collapsed summaries.
6. TDD both layers: parser tests + component tests. Run vitest with an **isolated HOME**
   (`HOME=$(mktemp -d)`) and stub jsdom's missing `matchMedia`.
7. Full suite (`npm test`) + `npm run build` + explicit `tsc --noEmit`; delegate docs
   file-index rows to a subagent in caveman style.
8. For the live visual check in a worktree, spin a **second dashboard on spare ports**
   (`TMPDIR=/tmp npx tsx …/cli.ts start --port 8100 …`) so `:8000` stays untouched — then
   tear it down.

## 3. How the collaboration unfolded

**Phase 1 — Skill resolution & setup.** The apply skill was invoked from the worktree.
The first two bash calls failed trying to `cat`/`find` the `openspec-apply-change`
SKILL.md locally, and the operator steered twice to make the AI resolve OpenSpec
skills/definitions from the **parent** repo root rather than the checkout. Once resolved,
`openspec status` + `openspec instructions apply --json` gave the task list.

**Phase 2 — Convention discovery.** The AI read all context files and grepped the
existing `tool-renderers/` directory (registry.ts, types.ts, lang-detect.ts,
`AgentToolRenderer`, a sample test) to match the established pattern. *Why it worked:*
matching existing infra meant zero re-litigation of style in review.

**Phase 3 — Fixture harvest (the source of truth).** Instead of inventing the result
grammar, the AI ran scripts (via `ctx_execute`/`ctx_execute_file`) to pull real `ctx_*`
result texts out of 575 session `.jsonl` files — one per tool plus an `intent` example
and a "No results found" search — and wrote them into `parse-ctx-result.fixtures.ts`.
*Why it worked:* the parser was then written against reality, so edge cases (banner
stripping, error classes) were covered by construction.

**Phase 4 — Parser + renderer (TDD).** Pure parser first (24 tests), then the renderer
(13 tests) with header chips, code blocks, `max-h-80` collapsed accordions, and an error
card with collapsible "Received arguments". Registry + `ToolCallStep` summaries wired in.

**Phase 5 — Verify.** Full suite (7139 tests), clean build, explicit `tsc`. Docs rows
delegated to a subagent (caveman style, per the Documentation Update Protocol).

**Phase 6 — Live visual check.** The hard part. The `:8000` dashboard serves the **main**
repo, not the worktree's fresh `dist/`. The AI stood up a second production dashboard on
`:8100` (pi-port 9100) serving the worktree build, confirmed it shared persistence, found
an ended session rich in `ctx_*` cards, and verified the collapsed summaries + expanded
DOM — then stopped and tore the extra server down.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change add-ctx-tool-renderer`. Effective
  because the change already had a written proposal + tasks.md; the slash-skill turned a
  one-liner into a 26-task execution plan. *Stronger version for a worktree:* add the
  skill-resolution rule up front — "apply `add-ctx-tool-renderer`; you're in a git
  worktree, so resolve OpenSpec skills + definitions from the parent repo root."
- **High-leverage follow-ups** — "Use parent's OpenSpec definitions in workspace" and
  "Use parent worktree parent directory's OpenSpec skills when in git worktree." Two short
  redirects that unblocked the entire apply loop after the local skill lookup failed.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Look for the `openspec-apply-change` SKILL.md **inside the worktree** (2 failed finds) | "Use parent's OpenSpec definitions in workspace" | State up front: in a worktree, resolve OpenSpec skills/definitions from the parent repo root, not the checkout |
| Treat worktree skill paths as self-contained | "Use parent worktree parent directory's OpenSpec skills when in git worktree" | Add the worktree→parent resolution rule to the kickoff prompt / AGENTS.md |
| Assume the live `:8000` dashboard would show the worktree build | (self-corrected) recognized `:8000` serves the **main** repo, not the worktree `dist/` | Remember: worktree client changes need a separate dashboard on spare ports to view |

Beyond the two explicit steering turns, the AI imposed its own quality bars: never let the
parser throw, harvest real fixtures instead of inventing them, isolate test HOME, and leave
`:8000` untouched during the visual check.

## 6. Skills, tools & memory created — and why they're effective

One **project memory** was saved (no skill):

- **What it captures:** how to visually verify client changes in a worktree without
  disrupting the main dashboard — build the worktree (`npm run build`), then start a
  second dashboard on spare ports with `TMPDIR=/tmp npx tsx …/cli.ts start --port 8100 …`.
- **Why it's effective:** it removes the biggest time sink of this session (30+ browser
  actions fighting `:8000` vs worktree `dist/`, jiti cache failures from the sandbox's
  ephemeral TMPDIR, and about:blank navigation churn). Next time the port + TMPDIR recipe
  is one lookup away.
- **When to invoke it:** any time you need a real-browser visual check of a **worktree**
  client build while a production dashboard is already running on `:8000`.

*Recommended follow-up:* this workflow is repeatable enough to deserve a small skill —
"spin an isolated worktree dashboard on spare ports for visual QA, then tear down." (The
repo already has an `isolated-ui-verification` project skill covering exactly this; prefer
invoking it rather than reconstructing the port dance by hand.)

## 7. Pitfalls & dead ends

- **Skill lookup inside a worktree fails.** `cat`/`find` for `openspec-apply-change`
  SKILL.md in the checkout returns nothing → resolve from the parent repo root.
- **Vitest needs an isolated HOME.** Bare `npx vitest run …` failed; use
  `HOME=$(mktemp -d) npx vitest run --project @blackbelt-technology/pi-dashboard-web …`.
- **jsdom lacks `matchMedia`.** Component tests need a `matchMedia` stub in the test file
  (the theme provider reads it).
- **jiti cache dies under the context-mode sandbox** because it sets an ephemeral TMPDIR;
  launch the worktree dashboard via plain Bash with a stable `TMPDIR=/tmp`.
- **`:8000` serves the main repo, not the worktree** — its `dist/` won't include your
  worktree build. Stand up a second dashboard on `:8100`.
- **Browser harness fights the live session:** live sessions auto-follow to the bottom and
  `/session/<id>` URLs redirect home; scrolling triggered navigation → about:blank white
  screenshots. Workarounds: pick an **ended** session (no auto-follow, stable refs),
  interact via refs only (no scroll), and reopen the browser to clear the about:blank state.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change (proposal.md + tasks.md) already written;
the worktree checked out at `.worktrees/<name>`; a running `:8000` dashboard you must not
disturb.

- [ ] Invoke `/skill:openspec-apply-change <name>`; if in a worktree, tell it to resolve
      OpenSpec skills/definitions from the parent repo root.
- [ ] Read context files + existing `tool-renderers/` infra to match conventions.
- [ ] Harvest **real** `ctx_*` result fixtures from the session `.jsonl` store → fixtures file.
- [ ] Write the pure parser (typed union, banner strip, error classify, never throws).
- [ ] Write the renderer (chip/code/accordion/error bodies) + wire `registry.ts` +
      `ToolCallStep.tsx` summaries.
- [ ] TDD: parser tests + component tests, run with `HOME=$(mktemp -d)` + `matchMedia` stub.
- [ ] `npm test` (full suite) + `npm run build` + `tsc --noEmit`; delegate docs rows to a
      subagent (caveman style).
- [ ] Visual check: `TMPDIR=/tmp` second dashboard on `:8100`, open an **ended** session
      with `ctx_*` cards, verify via refs, tear the extra server down.

**Final artifacts:**
- `packages/client/src/components/tool-renderers/parse-ctx-result.ts`
- `packages/client/src/components/tool-renderers/CtxToolRenderer.tsx`
- `packages/client/src/components/tool-renderers/__tests__/parse-ctx-result.test.ts`
- `packages/client/src/components/tool-renderers/__tests__/CtxToolRenderer.test.tsx`
- edits to `registry.ts`, `ToolCallStep.tsx`, `openspec/changes/add-ctx-tool-renderer/tasks.md`

---

_Generated from session `019e8a4e` · `pi-agent-dashboard` · 2026-06-02. Source extract: `/tmp/session_facts_UqElSA.md`._
