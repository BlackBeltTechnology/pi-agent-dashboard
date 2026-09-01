---
session: 019f8612
week: 2026/W30
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
openspec_changes: [image-fit-tool-result-images]
proposal_excerpt: "pi-image-fit only fits images that enter a session through the built-in read tool (a tool_call hook that rewrites event.input.path). Every other image origin bypasses it: tool-result images (browser/MCP screenshots)…"
---

# How we did it: Extend `pi-image-fit` to catch every oversize image — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened as a **support fire**: *"Fix session, `019f8604-08ea-79a0-b226-fee2a5dd09d2`, too large image there."* A pi session had become unloadable because one saved image exceeded Anthropic's 8000px-per-side limit, so the provider rejected the whole request.

Once the immediate fix landed, the *real* objective surfaced through steering: **"There is an extension `pi-image-fit`. Why did it not catch the problem automatically?"** The task morphed from a one-off repair into a **planning exercise** — root-cause the coverage gap in the `pi-image-fit` extension, then produce a fully reviewed OpenSpec change that closes it for *every* image origin (tool-result, user-pasted, historical), not just the built-in `read` path. The deliverable was a committed, doubt-reviewed, scenario-folded OpenSpec plan — not the implementation.

## 2. TL;DR playbook

1. **Triage the corrupt transcript in place.** Locate the session JSONL, scan each line for image blocks, print dimensions/bytes to find the offender (an 8956×5080 browser screenshot).
2. **Back up before mutating** (`cp file.jsonl file.jsonl.bak`), resize *only* the offending image (`sips` long-edge 1568), rewrite that one line, re-validate all lines parse as JSONL.
3. **Answer "why didn't the extension catch it?" by reading the actual hook.** Show that `pi-image-fit` only hooks `tool_call` for the `read` tool and rewrites `event.input.path` — inline base64 `toolResult` images never touch that seam.
4. **Find the right seam before promising a fix.** Grep pi's type defs for available hooks (`tool_result`, `context`, `before_provider_request`) and read each contract. Pick the **catch-all `context` seam** because it re-checks every image before *every* provider call → also rescues already-persisted sessions on reload.
5. **Scaffold the OpenSpec change** (`openspec new change`), then author proposal → design → specs → tasks, validating after each artifact.
6. **Run `plan-proposal` properly** — do not hand-author test tasks. Run **doubt-driven-review** (single-model + auto cross-model) on proposal+design, reconcile actionable findings back into the artifacts.
7. **Run scenario-design → `test-plan.md` manifest → category-routed fold**, then the fold-completeness gate (every manifest row → exactly one task; `openspec status` parses).
8. **Commit only your change dir** and STOP at the worktree boundary — planning does not enter implementation.

## 3. How the collaboration unfolded

**Phase A — Incident repair (Discovery + Fix).** The AI found the session file, wrote a Node one-liner to print each image's dimensions, and isolated line 69 (8956×5080 px, 411 KB) as over-limit. It **confirmed its plan before mutating**, backed up the transcript, resized the single offender to 1568×889 (411 KB → 64 KB) via `sips`, rewrote the line, and verified all 73 lines still parsed. *Why it worked:* surgical, backup-first, verified — the other three in-limit images were left untouched.

**Phase B — Root cause (why the extension missed it).** Prompted by the user, the AI read `packages/image-fit-extension/src/extension.ts` and quoted the exact hook: `pi.on("tool_call")` guarded by `if (event.toolName !== "read") return`. It explained the extension's whole scope is "agent reads an image file from disk" — the incident image was inline base64 in a `toolResult`, a completely different origin. *Decision point:* the human implicitly asked for a permanent fix, converting the bug report into a design task.

**Phase C — Seam selection (the pivotal decision).** Rather than jump to the obvious `tool_result` hook, the AI **verified all available seams first** by grepping pi's types, and surfaced a decision table. It found the `context` seam fires before *every* LLM call with a safe deep copy of `event.messages`. Critical realization: a `tool_result` hook fires only once at tool time and would **not** rescue the already-poisoned session `019f8604`, whereas a `context` hook re-checks every image before each call and covers user-pasted + historical images too. The human chose the single `context` catch-all. *Why it worked:* the AI declined to promise coverage until it had proven the seam existed in pi's type defs.

**Phase D — Artifact generation.** `openspec new change` scaffolded `image-fit-tool-result-images`; the AI wrote proposal → design → specs → tasks, re-reading source for accurate helper signatures (`probeDimsFromBuffer`, `resizeBuffer`) and validating after each. It committed only its own change dir, explicitly leaving unrelated modified files unstaged.

**Phase E — Rigorous review + fold (`plan-proposal`).** The user invoked `plan-proposal`, and the AI **self-corrected**: it had skipped doubt-review and had hand-authored test tasks (which the skill forbids). It ran single-model + automatic cross-model (`zai/glm-5.2`) adversarial review, reconciled real findings (mime-less cache key collision, false "near-zero per-turn" claim, role-agnostic traversal, unproven subagent coverage) back into the artifacts, then ran scenario-design → 26-scenario manifest → category-routed fold with a fold-completeness gate, and stopped at the worktree boundary.

## 4. Prompts that worked

- **Goal prompt** — *"Fix session, `<id>`, too large image there."* Effective because it named the exact session id, letting the AI go straight to the file. **Stronger version:** add the symptom + desired durability: *"Session `<id>` won't load — 'image too large'. Fix the transcript, then tell me why `pi-image-fit` didn't prevent it."*
- **High-leverage follow-up** — *"There is an extension `pi-image-fit`. Why it not catch the problem automatically?"* This single question turned a one-off repair into a root-cause + design task. It forced the AI to read the real hook instead of guessing.
- **"yes"** — approved continuing into design after the AI laid out a decision table; cheap approval on a well-framed choice.
- **Skill-injection prompts** (`openspec-ff-change`, then `plan-proposal`) — invoking the correct workflow skill by name is what triggered the disciplined review+fold instead of ad-hoc artifact writing.
- **"commit"** — a one-word gate that made the AI stage *only* its change and explain what it deliberately left out.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Treat the ask as a one-off transcript repair | "Why did `pi-image-fit` not catch this automatically?" | State up front: "fix the incident *and* close the coverage gap permanently." |
| Reach for the obvious `tool_result` seam | Choosing the `context` catch-all after the AI surfaced the seam table | Ask "which seam also rescues already-saved sessions?" to force the durability lens. |
| Hand-author test tasks in tasks.md | Invoking `plan-proposal`, which forbids hand-authored tests | Run `plan-proposal` from the start; never write test tasks manually — fold them from a manifest. |
| Skip doubt-review / scenario-design | `plan-proposal` skill re-imposed both mandatory steps | Treat doubt-review + scenario-fold as non-optional gates for any spec change. |
| Stage everything | "commit" (AI then staged only its change dir) | Keep unrelated edits out of the change commit; stage by path. |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created — the session was a *consumer* of three existing skills, and that composition is the reusable lesson:

- **`openspec-ff-change`** — fast-forwards proposal→design→specs→tasks in one pass. Invoke when you have a clear change name and want all artifacts scaffolded quickly.
- **`plan-proposal`** — the planning orchestrator. It caught two process violations (skipped doubt-review, hand-authored tests) that the AI had committed. Invoke for *any* non-trivial OpenSpec change; it composes doubt-driven-review + scenario-design + the manifest fold and stops at the worktree boundary.
- **`doubt-driven-review`** — single-model + automatic cross-model (`@propose-review-1` = `zai/glm-5.2`) adversarial pass. It found the mime-less cache-key collision and the false "near-zero per-turn" perf claim before they reached implementation.

**Recommendation:** this exact flow ("repair a corrupt session transcript, then plan the extension fix") is repeatable — a `repair-oversize-session-image` project skill capturing the JSONL-scan + `sips`-resize + backup-and-reverify steps would remove the manual Node one-liner each time.

## 7. Pitfalls & dead ends

- **`openspec validate` "no deltas" on the proposal is expected** — delta specs are the *next* artifact, not part of the proposal. Don't chase it as an error.
- **Heredoc commit messages trip on parentheses.** The `git commit -m "$(cat <<'EOF' … )"` form failed on parens in the body; the fix was to write the message to `/tmp/msg.txt` and `git commit -F`.
- **Byte-size is not a safe short-circuit for "is this image too big."** The incident image was only 411 KB but 8956 px wide — you must probe dimensions, not just bytes. (This became design decision D4.)
- **A `tool_result`-only hook silently fails to rescue already-saved sessions** — it fires once at tool time. Verify the seam covers the *reload* path before committing to it.
- **Don't hand-author test tasks** in an OpenSpec `tasks.md`; `plan-proposal` requires them folded from a scenario manifest, and it will make you redo them.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the failing session id; the extension source path (`packages/image-fit-extension/src/extension.ts`); pi's bundled type defs (`node_modules/@earendil-works/pi-coding-agent/`); a configured cross-model review role (`@propose-review-1`).

1. `find ~/.pi/agent/sessions -name "*<id>*.jsonl"` → locate transcript.
2. Node-scan each line for image blocks; print `w×h`, bytes → find the offender.
3. `cp transcript.jsonl transcript.jsonl.bak`; `sips` resize long-edge 1568 on the offender; rewrite the one line; re-validate JSONL.
4. Read the extension hook; confirm the missed origin (inline `toolResult` base64 bypasses the `read`-tool `tool_call` seam).
5. Grep pi types for seams; pick `context` (fires pre-every-call, safe deep copy, rescues saved sessions).
6. `openspec new change image-fit-tool-result-images`; author + validate proposal → design → specs → tasks.
7. Run `plan-proposal`: doubt-review (single + auto cross-model) → reconcile findings → scenario-design → `test-plan.md` manifest → fold → fold-completeness gate.
8. Stage only the change dir; commit (`-F` a message file to avoid heredoc paren issues); STOP at the worktree boundary.

**Artifacts produced:**
- `openspec/changes/image-fit-tool-result-images/{proposal,design,tasks,test-plan}.md`
- `openspec/changes/image-fit-tool-result-images/specs/pi-image-fit/spec.md`
- Repaired session transcript `…019f8604….jsonl` (+ `.bak`)
- Commits `912637a43` and `d24422860` on `develop`

---

_Generated from session `019f8612-20ee-7e73-bb8c-2d7d66da2a8e` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-21. Source extract: `facts.XXXXXX.h4Bx5tZLXE`._
