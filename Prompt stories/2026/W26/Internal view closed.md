---
session: 019f097a
week: 2026/W26
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [fix-file-preview-survives-message-churn]
proposal_excerpt: "In chat view, clicking a file link opens the inline `FilePreviewOverlay` (remote / no-editor fallback). When a new chat message arrives — or the in-flight assistant message streams another token — the open preview c…"
---

# How we did it: Diagnose a self-closing file preview, then capture it as an OpenSpec change — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore`) — a thinking-partner stance,
explicitly *no implementing*. The real ask surfaced in the second prompt, a plain bug
report:

> "In chat view I open a linked file to view, but when a new message is received in
> chatWindow, the view dialog is closing, I have to reopen."

So the true objective was **not** to fix the bug (explore mode forbids that) but to
*root-cause it precisely* and *capture the fix as a well-formed OpenSpec change* —
proposal, design, spec delta, and a TDD-ordered task list — so implementation can start
cleanly later. The session ended with four artifacts committed to `develop` as
`fix-file-preview-survives-message-churn`.

## 2. TL;DR playbook

1. Enter explore mode (`openspec-explore`) — this keeps you in diagnose-and-capture mode,
   never premature code.
2. Report the bug concretely: *what you do → what breaks → the workaround*. That framing
   (open file → new message → dialog closes) hands the AI a clean symptom.
3. Let the AI delegate the code harvest to an **`Explore` subagent** ("find the file-view
   dialog + chat message rerender code") to keep the main context clean.
4. Have the AI *read the actual code* to confirm the mechanism — don't accept the first
   theory. Here it traced state ownership from `ChatView` → `MarkdownContent` → `FileLink`
   → `useFileOpenRouting` and found the dialog state living at the **deepest leaf**.
5. Pin the two independent remount triggers (index-based `key` on grouped items;
   streaming→committed message transition) before designing the fix.
6. Say **"draft proposal"** — the AI scaffolds via `openspec new change <name>`, reads the
   nearest existing specs to anchor the delta, and writes all four artifacts.
7. Run `openspec validate <name>` — confirm it validates clean.
8. Say **"commit"** — but tell the AI to commit **only its own change dir**, not unrelated
   board churn.

## 3. How the collaboration unfolded

**Phase 1 — Board triage (Discovery).** In explore mode the AI first ran `openspec list`
and reported the OpenSpec board state: 54 active changes, ~2% completion, most at 0%. It
offered directions (a specific change / a fresh idea / the backlog itself) rather than
assuming. *Why it worked:* it surfaced context without funneling — the human could ignore
it and drop the real bug instead.

**Phase 2 — Symptom → hypothesis.** On the bug report the AI immediately named the class
of bug ("a re-render is nuking your dialog state") but refused to theorize further before
reading code. It spawned an `Explore` subagent to harvest the file-view dialog + chat
rerender code. *Why it worked:* the harvest stayed in a subagent, so the main thread only
received the relevant findings.

**Phase 3 — Mechanism confirmation (Design-in-code).** The AI read `ChatView.tsx`,
`MarkdownContent`, the overlay, and `useFileOpenRouting.ts`. It found the dialog's open
state stored in `useState` at the leaf `FileLink`, and that a `DialogPortal` only detaches
the DOM — React ownership stays under `FileLink`, so any `FileLink` remount wipes the
dialog. It then found **two** remount paths: an index-based `key={`group-${idx}`}` at
`ChatView:318`, and the streaming→committed message transition. *Decision point:* confirm
the whole chain end-to-end before proposing, rather than fixing the first suspect.

**Phase 4 — Capture as OpenSpec (Generate).** On "draft proposal" the AI scaffolded via
CLI (after discovering the right subcommand — see Pitfalls), read the two relevant specs
(`file-and-url-preview`, `tool-output-linkification`) to anchor the delta, checked a recent
change for the artifact format, then wrote proposal.md, design.md, the spec delta, and
tasks.md. It flagged the **one real design decision**: provider at `ChatView` (Option B,
survives message churn) vs at `App` (Option C, survives view switches too).

**Phase 5 — Validate & scope the commit (Verify).** `openspec validate` passed clean. On
"commit" the AI checked whether a `groups.json` diff was caused by its own `openspec new`,
concluded it was unrelated board reshuffling, and committed **only** its own change
directory (`9a30da2e`, 5 files, 288 insertions), leaving two other untracked change dirs
untouched.

## 4. Prompts that worked

- **The goal prompt** was the `openspec-explore` skill invocation — effective because it
  set a hard stance ("think, don't implement") that kept the whole session in
  diagnose-and-capture mode.
- **The bug report** ("I open a linked file... when new message received... the view dialog
  is closing") was high-leverage precisely because it was a concrete
  *action → symptom → workaround* triple. A weaker version — "the file preview is buggy" —
  would have forced a round of clarifying questions. **Reuse this shape:** state what you
  did, what broke, and the workaround, in one sentence.
- **"draft proposal"** — a two-word unlock. It worked because the diagnosis was already
  complete, so the AI had everything it needed to fill all four artifacts.
- **"commit"** — worked, but see the guardrail below: it needed the AI to self-scope.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human steered by… | Bake this in next time by… |
|-------------------|----------------------|----------------------------|
| Open with broad board triage (54 changes) rather than the user's actual pain | Dropping a concrete bug report as the next turn | Lead with the concrete symptom; let explore-mode triage be optional background |
| Theorize the root cause from the symptom alone | (No steer needed — the AI self-corrected: "let me find the actual code before theorizing") | Keep this reflex — demand code-confirmation of any re-render/state-loss theory |
| Risk committing unrelated working-tree churn (`groups.json`, two other change dirs) on a bare "commit" | The AI self-scoped, but the human should confirm | Say "commit **only** the change dir you created" explicitly |

The dominant lesson: in explore mode the human's job is to **inject the concrete problem**;
the AI's job is to **resist premature fixes** and convert the diagnosis into a spec.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created. The reusable assets were **existing** ones used well:

- **`openspec-explore`** — the stance skill that made this a *capture* session, not an
  *implement* session. Invoke it whenever you want to root-cause + write a proposal without
  drifting into code.
- **`Explore` subagent** — used to harvest the dialog + rerender code in isolation, keeping
  the main context focused on the mechanism. Invoke it for any "find where X lives" harvest
  before deep reading.
- **`openspec new change` + `openspec validate`** — the scaffold-and-check loop that turns a
  confirmed diagnosis into four validated artifacts.

*Recommendation:* the "state ownership at the leaf → portal detaches DOM but not React
ownership → remount wipes dialog state" pattern is a recurring React footgun worth a saved
memory: **dialog/overlay open-state belongs above the churn boundary (a context provider),
never inside a list-item leaf.**

## 7. Pitfalls & dead ends

- **`openspec change new <name>` failed** (1 failed command). The correct invocation is
  `openspec new change <name>`. If the CLI errors, run `openspec new --help` to get the
  subcommand order before retrying.
- **Index-based React keys** (`key={`group-${idx}`}`) are the smoking gun for
  "state resets when a new item arrives" — when positions shift, React remounts and leaf
  state dies. If a dialog/overlay self-closes on unrelated updates, check for index keys and
  leaf-stored `useState` first.
- **Portals mislead.** A `DialogPortal` detaches the DOM but React ownership stays with the
  parent — don't assume portal content is safe from a parent remount.
- **Bare "commit" is risky** on a dirty tree. Confirm the diff is *yours* (here `groups.json`
  was unrelated board reshuffle) and commit only your change directory.

## 8. Reproduce it faster — checklist

- [ ] Invoke `openspec-explore` to lock the think-don't-implement stance.
- [ ] State the bug as *action → symptom → workaround* in one sentence.
- [ ] Spawn `Explore` to harvest the relevant components (dialog + the thing that rerenders).
- [ ] Read the code; trace **where the open-state actually lives** and **what remounts it**.
- [ ] Identify every remount trigger (index keys, streaming→committed transitions) before designing.
- [ ] Say "draft proposal" → AI scaffolds via `openspec new change <name>`, anchors the delta to existing specs, writes proposal/design/spec/tasks.
- [ ] `openspec validate <name>` → clean.
- [ ] Commit **only** your change directory; verify no unrelated tree churn rides along.

**Inputs needed:** a running `openspec` CLI, the client source (`packages/client/src/…`),
and the existing specs to anchor the delta.

**Artifacts produced:**
`openspec/changes/fix-file-preview-survives-message-churn/{proposal.md, design.md, specs/tool-output-linkification/spec.md, tasks.md}` — committed as `9a30da2e` on `develop`.

---

_Generated from session `019f097a` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-27. Source extract: deterministic facts sheet (session-to-guideline)._
