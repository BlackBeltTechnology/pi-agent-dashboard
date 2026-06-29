# How we did it: <Task title> — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

One paragraph: what the user originally wanted, in plain language. Quote the first
prompt, then restate the *real* objective once the steering turns clarified it.

## 2. TL;DR playbook

A numbered, copy-pasteable sequence of the moves that actually worked — the shortest
path from zero to the finished artifact. 5–10 steps. Each step = one concrete action
(a prompt to give, a tool/skill to run, a file to produce). This is the part a reader
will skim first.

## 3. How the collaboration unfolded

Narrative of the session as phases (group the tool activity into 3–6 phases, e.g.
*Discovery → Gather → Design → Generate → Verify*). For each phase:

- **What the AI did** (the tools/files, summarized — not a raw log).
- **Why that approach worked** (the effective bit worth repeating).
- **The decision points** where the human chose a direction.

## 4. Prompts that worked

List the prompts that moved the work forward, with a short note on *why each was
effective*. Distinguish:

- **The goal prompt** — what made it (or would have made it) a good kickoff.
- **High-leverage follow-ups** — short prompts that unlocked a lot ("all three",
  "yes", "do X everywhere").

Rewrite weak prompts into a stronger version a future user should use instead.

## 5. Steering & corrections (what to watch for)

The heart of the guideline. From the steering turns, extract the moments where the
human had to redirect the AI, and turn each into a *guardrail*:

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| e.g. drift the brand name | "always write BlackBelt" | stating naming rules up front / saving a memory |

Include corrections, scope expansions ("there are also emails from X"), and
quality bars the user imposed.

## 6. Skills, tools & memory created — and why they're effective

For each skill/memory/subagent created in the session:

- **What it captures** and the reusable problem it solves.
- **Why it's effective** (what manual work it removes, what it makes reproducible).
- **When to invoke it** next time.

If no skill was created but the workflow is clearly repeatable, recommend the skill
that *should* be created.

## 7. Pitfalls & dead ends

Failed commands, retried edits, things that didn't work, blind alleys. Each as a
"if you hit X, do Y" note so the reader avoids the same loss.

## 8. Reproduce it faster — checklist

A tight checklist (the distilled, no-narrative version of §2) plus the key inputs
the operator must have ready (API keys, source files, config) and the final
artifacts produced (paths).

---

_Generated from session `<session-id>` · `<cwd>` · <date>. Source extract: `<facts file>`._
