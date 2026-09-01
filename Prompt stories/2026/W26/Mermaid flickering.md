---
session: 019f0644
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
---

# How we did it: Kill the Mermaid render flicker — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened inside **explore mode** (`openspec-explore`) — a thinking-only
stance, no implementation. But the real objective surfaced fast and concrete: the
chat content view's **Mermaid diagrams flicker** while messages stream in. Each
streamed token grows the markdown `content`, which grows the `code` string handed to
`MermaidBlock`, which re-fires the render effect against *incomplete* diagram source —
flashing "Loading diagram…" and parse errors until the fence finally closes. The user
wanted the flicker gone. The two steering turns then widened it into "fix **every**
flicker source," and finally "commit — but only the fix."

## 2. TL;DR playbook

1. Locate the rendering path: `rg -l -i "mermaid"` → `MermaidBlock.tsx` and its
   consumer `MarkdownContent.tsx`.
2. Read both plus the existing tests to see how `content` flows during streaming.
3. **Fix #1 (incomplete source):** add `isFencedBlockComplete(content, code)` in
   `MarkdownContent.tsx`; pass a `complete` prop into `MermaidBlock`; early-return the
   render effect until the closing fence arrives.
4. **Fix #2 (errored source):** add a module-level `_errorCache` in `MermaidBlock.tsx`
   mirroring `_svgCache`, seed the error `useState` from it, short-circuit re-renders
   of known-bad `(code, theme)`, and clear it on theme change.
5. Add focused tests for both gates; run under `HOME=$(mktemp -d) npx vitest run …`.
6. Type-check the touched files directly when the project-reference `tsc` config
   throws pre-existing noise.
7. `git add` **only the 4 mermaid files** and commit — leave unrelated working-tree
   changes untouched.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (find the render path).** `rg -l -i "mermaid"` surfaced
`MermaidBlock.tsx`; a second grep found its consumer `MarkdownContent.tsx`. The AI
read both plus their `__tests__` to understand how `content` is passed during
streaming. *Why it worked:* it read the consumer, not just the component — the flicker
lived in the data flow between them, not in either file alone.

**Phase 2 — Root-cause #1 (incomplete source).** The AI reasoned that streaming grows
`content` token-by-token, so `code` grows too, re-firing the render effect against a
half-written diagram. Decision point: **don't debounce — gate.** Render only once the
fence is closed (source final, checksum stable). It added
`isFencedBlockComplete(content, code)` and a `complete` prop, with a safe fallback to
`true` when the code isn't found verbatim so behaviour is never *worse* than before.

**Phase 3 — Steering #1 (the second flicker).** The human pushed back: *"but when
mermaid have wrong, image cannot be generated still cause flickering."* The AI found
the asymmetry — successful renders cached in `_svgCache`, failures never cached — so an
invalid diagram replayed Loading→render→error on every remount (constant, as new
messages stream in). It added `_errorCache`, seeded the error state from it, and
short-circuited known-bad renders. *Decision point:* failures are deterministic per
`(code, theme)`, so caching them is safe.

**Phase 4 — Verify & commit.** Ran the vitest suites (4 new tests + existing),
type-checked the touched files, then committed **only** the 4 fix files
(`14bc7f6b`), deliberately leaving unrelated working-tree changes (mockups,
`c4-example.md`, `.pi/settings.json`) alone.

## 4. Prompts that worked

- **The goal prompt** launched via `openspec-explore`. Ironically the explore stance
  forbids implementing — yet the work *was* implemented. Lesson: if you want a fix, don't
  open in explore mode. A stronger kickoff: *"The chat's Mermaid diagrams flicker while
  streaming. Find the root cause in the render path and fix it, tests first."*
- **High-leverage follow-up:** *"but when mermaid have wrong, image cannot be generated
  still cause flickering. Check."* — Short, but it named a **second, distinct** failure
  mode the first fix missed. This is the prompt that turned a partial fix into a complete
  one. Reusable pattern: after a fix, probe the *error path* explicitly.
- **"commit"** — one word, but the AI correctly interpreted it as "commit the fix only,"
  not "commit everything dirty."

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Fix only the happy-path (incomplete-source flicker) and stop | "but when mermaid have wrong… still cause flickering" | Ask up front: "cover BOTH incomplete AND errored diagram states" |
| — (it got this right) commit scope | "commit" → AI scoped to the 4 fix files only | State "commit only the files you changed" so dirty working trees never leak in |
| Run under the polluted real `$HOME` | (AI self-corrected) | Always `HOME=$(mktemp -d) npx vitest run …` for hermetic test runs |

## 6. Skills, tools & memory created — and why they're effective

No skill or memory was persisted this session. But the workflow is textbook-repeatable
and worth capturing. The reusable pattern is **"cache-symmetry for a flickering
streamed render"**:

- **What it captures:** when a component caches *success* results for instant remount
  but not *failure* results, streamed/remounting parents replay the failure animation
  → flicker. Fix = mirror the success cache with an error cache keyed on the same
  deterministic inputs.
- **Why it's effective:** removes a whole class of "why does my streamed diagram/
  preview/render blink" bugs without debouncing or throttling.
- **When to invoke:** any streamed markdown/diagram/media block that renders
  incrementally. Consider a `project` skill: *"streamed-render flicker: gate on
  completeness + cache both success and error."*

## 7. Pitfalls & dead ends

- **Explore mode blocks implementation.** The session started in `openspec-explore`,
  whose stance forbids writing code. If your goal is a fix, don't open there — or
  exit first. (Here the work proceeded anyway; know the tension.)
- **`tsc` on the project reference throws pre-existing noise.** `npx tsc --noEmit -p
  packages/client/tsconfig.json` surfaced an unrelated project-reference config error.
  Don't chase it — verify your files with a direct standalone `tsc` invocation on just
  the touched files instead.
- **Vitest leaks DOM across tests** (no auto-cleanup here) — a prior test's error DOM
  lingered. Scope queries to the render `container`, not the global document.
- **Dirty working tree at commit.** Unrelated changes (mockups, `c4-example.md`,
  `.pi/settings.json`) were present. `git add` the specific fix files by path — never
  `git add -A`.

## 8. Reproduce it faster — checklist

- [ ] `rg -l -i "mermaid"` → open `MermaidBlock.tsx` + `MarkdownContent.tsx` + their tests.
- [ ] Add `isFencedBlockComplete(content, code)` in `MarkdownContent.tsx`; pass
      `complete` into `MermaidBlock`; early-return the render effect until closed.
- [ ] Add module-level `_errorCache` in `MermaidBlock.tsx`; seed error state from it;
      short-circuit known-bad `(code, theme)`; clear alongside `_svgCache` on theme change.
- [ ] Focused tests for both gates; run `HOME=$(mktemp -d) npx vitest run <files>`.
- [ ] Type-check touched files directly (ignore project-reference config noise).
- [ ] `git add <4 fix files by path>` && commit — leave unrelated changes untouched.

**Inputs to have ready:** the repo, the two component paths, a hermetic `$HOME` for tests.
**Artifacts produced:** `MermaidBlock.tsx`, `MarkdownContent.tsx`, and their two test
files — commit `14bc7f6b`.

---

_Generated from session `019f0644-282a-71ff-9191-b59216b44fc7` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-27. Source extract: session-to-guideline facts sheet._
