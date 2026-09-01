---
session: 019de0a2
week: 2026/W18
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (16 user prompts)"
upgrade_status: pending
openspec_changes: [rich-diff-in-chat, strip-token-backgrounds-in-code-blocks]
proposal_excerpt: "The Edit tool card in chat renders diffs with a homegrown unified-patch renderer (`createTwoFilesPatch` + manual line coloring) while the dedicated `FileDiffView` content area renders the same data with `@git-diff-vie…"
---

# How we did it: rich-diff-in-chat — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** — a thinking-partner stance with one hard rule:
*read, search, diagram, and create OpenSpec artifacts, but never write application code.*
The kickoff prompt was the full explore-mode template ("Enter explore mode. Think deeply.
Visualize freely… you must NEVER write code or implement features").

The **real objective**, which emerged over the first few steering turns, was concrete:
the chat's `Edit` tool card renders diffs with a homegrown unified-patch renderer
(`createTwoFilesPatch` + manual line coloring), while the dedicated `FileDiffView`
content area renders the same data with the far richer `@git-diff-view/react`. The user
wanted to **promote the rich renderer into chat** — but only lazily (render on expand,
not while collapsed) — and to capture that as a fully validated, apply-ready OpenSpec
change. Implementation was explicitly out of scope for this session.

## 2. TL;DR playbook

1. **State the explore-mode contract up front** — planning only, artifacts yes, code no.
2. **Ground before proposing:** `grep`/`wc`/`head` the two real renderers
   (`EditToolRenderer.tsx`, `DiffPanel.tsx`, `ToolCallStep.tsx`) to confirm what exists —
   *especially* that lazy-mount already comes free from `ToolCallStep`'s `expanded` gate.
3. **Scaffold the change:** `openspec new change "rich-diff-in-chat"`.
4. **Walk the artifact chain in order** — `proposal → design → specs → tasks` — running
   `openspec instructions <artifact>` for each template and `openspec validate` after each.
5. **Do a pre-apply grounding pass**: diff your drafted artifacts against the *actual*
   `DiffPanel.tsx` code and patch every mismatch before anyone runs apply.
6. **Commit only the change directory** — unstage unrelated in-flight files first.
7. **To implement, exit explore mode by starting a fresh non-explore session** and run
   `/opsx:apply rich-diff-in-chat` there. You cannot exit explore mode from inside.

## 3. How the collaboration unfolded

**Phase A — Discovery & grounding.** The AI immediately mapped the two diff-rendering
surfaces with an ASCII diagram (chat homegrown `DiffView` ~30 lines vs. `DiffPanel`'s
`@git-diff-view/react` ~275 lines) and confirmed via `grep` in `ToolCallStep.tsx` that
Edit cards default to **collapsed** and only mount their renderer on expand — so the
rich swap is "free" for collapsed cards. *Why it worked:* the design's central risk
(bundle weight, re-tokenize cost) was neutralized by finding an existing gate rather than
inventing one. **Decision point:** the user asked "render in lazy mode?" → answer was
"you already have it."

**Phase B — Artifact generation (`/opsx:ff`).** The AI created the change and walked
`proposal → design → specs → tasks`, validating after each. Design landed 6 decisions
(D1–D6) and 6 risks; specs produced 10 testable scenarios including the two crucial
lazy-mount ones; tasks became 8 groups / 38 subtasks. **Decision points:** user chose
"D6 directly" (refactor `DiffPanel` to consume the extracted `<RichDiff>`, not add a 3rd
renderer), "narrow" scope, and "use theme."

**Phase C — Pre-apply grounding pass.** Before switching modes the AI re-read the *real*
`DiffPanel.tsx` and found **three gaps** between artifacts and code: (A) tasks said
`.initRaw()` but code uses `.init()`; (B) extraction should be Path-A-only (change-derived
diffs) with the git-aggregate Path B staying inline; (C) visual props are internal and
theme comes from `useThemeContext().resolved`, not a hardcoded `"dark"`. All three were
patched across `tasks/specs/design` and re-validated clean. *Why it worked:* catching
spec-vs-reality drift here is 10× cheaper than during apply.

**Phase D — Commit & the mode wall.** The AI committed only the 5 new artifact files
(`afc811b`), carefully unstaging pre-staged unrelated files. Then the user repeatedly
typed "exit explore mode" (6 times) trying to trigger implementation. The AI **held the
line** every time: explore mode is a session-level system-prompt constraint that cannot
be toggled from inside the conversation — the exit must happen operator-side by starting
a new session.

## 4. Prompts that worked

- **The goal prompt (explore-mode template).** Effective because it set an unambiguous
  *planning-only* contract, so the AI never drifted into code and instead invested in
  grounding + artifacts. Reuse it verbatim when you want thinking + OpenSpec artifacts
  with zero implementation risk.
- **"Is it possible to render in lazy mode? When collapse render on that time."** A
  high-leverage question — it surfaced the single biggest design lever (lazy-on-expand)
  early, and the answer ("already free from `ToolCallStep`") de-risked the whole change.
- **"D6 directly"** — a two-word unlock that picked the *right* architecture (extract a
  shared `<RichDiff>` and have `DiffPanel` consume it) instead of a parallel third renderer.
- **"1. narrow / 2. ok / 3. ok, but use theme"** — terse multi-answer steering that
  simultaneously scoped extraction down and mandated theme-awareness.
- **`/opsx:ff` then `/opsx:apply`** — the standard OpenSpec fast-forward + apply skills.
  Stronger phrasing for a future operator: *"Fast-forward all artifacts for
  rich-diff-in-chat, then STOP — I'll apply from a non-explore session."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Draft artifacts against *assumed* API shapes (`.initRaw()`, hardcoded `"dark"`) | Implicitly, by the AI's own pre-apply grounding pass finding 3 gaps | Always run a "diff artifacts vs. real source" pass **before** commit — cite exact file/line for every claim |
| Consider extracting *all* diff paths | "narrow" | State the carve-out up front: extract only change-derived (Path A); leave git-aggregate (Path B) inline |
| Default visual styling to `"dark"` | "use theme" | Say "theme-aware, via `useThemeContext().resolved`" in the design prompt |
| Add a 3rd renderer alongside the two existing ones | "D6 directly" | Name the DRY goal explicitly: extract one primitive, both surfaces consume it |
| (User) expect to implement inside explore mode | Repeated "exit explore mode" ×6 — which did nothing | Know the rule: explore mode is a **session-level** constraint; to implement, spawn a fresh non-explore session and `/opsx:apply` there |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — it was a pure planning run using the
existing `/opsx:*` (OpenSpec) skills. What *should* be captured is the recurring pattern:

- **Recommended memory / doctrine:** *"Explore mode cannot be exited mid-session; it is a
  system-prompt constraint set at launch. To implement a change drafted in explore mode,
  start a fresh non-explore pi session in the same cwd and run `/opsx:apply <change>`."*
  This session burned ~6 prompts and hours of wall-clock on that wall; a one-line memory
  removes the loop for every future explore session.
- **Reusable move worth a mini-skill:** the **pre-apply grounding pass** — before
  committing OpenSpec artifacts, re-read the real target source and reconcile every API
  claim (method names, prop shapes, theme sources). It reliably catches spec-vs-code drift
  while it's still cheap to fix.

## 7. Pitfalls & dead ends

- **"exit explore mode" typed into the chat does nothing.** It's read as an ordinary
  message; the constraint lives in the session's system prompt. *If you hit this:* stop
  asking the model — close the session (TUI `Ctrl+C`, or the dashboard "+ / New session"
  button, or a plain `pi` in the cwd) and run `/opsx:apply` in the fresh session.
- **Artifacts drifting from real code.** The first draft assumed `.initRaw()` and a
  hardcoded theme. *If you hit this:* run the grounding pass (Phase C) before commit.
- **Committing unrelated in-flight work.** The tree had `extract-flows-as-plugin`,
  `strip-token-backgrounds`, etc. staged. *If you hit this:* `git reset HEAD <paths>` to
  unstage, verify `git diff --cached --stat` shows *only* your change dir, then commit.
- **2 edit errors** during artifact patching (exact-match failures) — re-read the file
  region and retry with a tighter unique anchor.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the two renderer files (`EditToolRenderer.tsx`,
`DiffPanel.tsx`), the wrapper (`ToolCallStep.tsx`), and OpenSpec CLI available.

- [ ] Enter explore mode with the planning-only contract stated.
- [ ] Ground the two diff surfaces with `grep`/`wc`/`head`; confirm lazy-mount already
      exists in `ToolCallStep` (`expanded` gate).
- [ ] `openspec new change "rich-diff-in-chat"`.
- [ ] Walk `proposal → design → specs → tasks` via `openspec instructions`, `openspec
      validate` after each.
- [ ] Decide up front: extract shared `<RichDiff>` (D6), Path-A-only, theme-aware via
      `useThemeContext().resolved`.
- [ ] Pre-apply grounding pass: reconcile `.init()`, internal visual props, theme source.
- [ ] `git reset HEAD` unrelated files → commit only the change dir.
- [ ] **To implement:** start a fresh non-explore session → `/opsx:apply rich-diff-in-chat`.

**Final artifacts produced:**
- `openspec/changes/rich-diff-in-chat/proposal.md`
- `openspec/changes/rich-diff-in-chat/design.md` (D1–D6, R1–R6)
- `openspec/changes/rich-diff-in-chat/specs/tool-renderers/spec.md` (10 scenarios)
- `openspec/changes/rich-diff-in-chat/tasks.md` (8 groups · 38 subtasks)
- Commit `afc811b` — "openspec: add rich-diff-in-chat change proposal" (5 files, +384).

---

_Generated from session `019de0a2-fbfa-7389-9fbb-cbd5683e29ca` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-02. Source extract: deterministic facts sheet._
