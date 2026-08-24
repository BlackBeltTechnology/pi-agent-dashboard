---
session: 019f05a7
week: 2026/W26
type: documentation
model: "@fast"
premium: true
premium_reason: "heavy steering (7 user prompts)"
upgrade_status: pending
---

# How we did it: turning an external "taste" skill into a portable anti-slop package — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time. Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** ("Enter explore mode. Think deeply... you must NEVER write code"). The real objective surfaced across the first two prompts: the operator had found an external community skill (`taste-skill` by Leonxlnx, a 1200-line "codified taste" document) and wanted to know how it related to the project's own `frontend-mockup-loop` skill — then, once the difference was clear, to **extract the portable, mechanical anti-slop rules into a standalone, general, reusable skill package** that mirrors how `frontend-mockup-loop` ships as its own extension, and **wire the two together** without letting the new advisory rules override the loop's cited-source spine or WCAG gates.

In short: *compare two design skills, then harvest the reusable half of the external one into a new sibling package and connect it to ours.*

## 2. TL;DR playbook

1. Start in **explore mode** to compare, not build. Read both skills in full first (`ls`/`find` for SKILL.md files, then Read the external one and ours).
2. Have the AI produce a **side-by-side epistemology table** (kind, basis, domain, stack) so the difference is legible before any code.
3. Steer with the framing that decides everything: *"it's a broader, general reusable skill — that's why the frontend skill is a separate extension. Draft."*
4. Let the AI draft a **stack-agnostic, advisory** SKILL.md that keeps the mechanical/countable rules and drops the framework coupling (Next/RSC/GSAP), with an override path on every rule.
5. Say *"Package as new extension. Part B be part. Yes, wire the loop."* — AI creates `packages/anti-slop/` (skill-only: `package.json` + `README.md` + SKILL.md), mirroring `mockup-loop` conventions.
6. Wire precedence explicitly: add an **advisory companion** paragraph to `frontend-mockup-loop` SKILL.md feeding tells into its FIX step, with cited rules + WCAG gates always winning.
7. Delegate the `docs/` index update to a **subagent** with the caveman-style rule passed verbatim (path-alphabetical rows in `file-index-extension.md`).
8. Enforce **self-consistency**: sweep em-dashes from the new skill (it bans them), preserving only backtick-wrapped literals that *name* the banned character.
9. Stage **only your files** (`git reset` then explicit `git add`), commit, leave unrelated tree changes untouched.

## 3. How the collaboration unfolded

**Discovery (explore mode).** The AI resisted implementing and instead read both skills in full, then produced a two-column table contrasting `taste-skill` (static knowledge document, codified taste-as-law, marketing/portfolio domain, Next+GSAP stack, explicitly *not* dashboards) against `frontend-mockup-loop` (a tooling-backed loop, cited external rules, product-UI domain, React+Vite). *Why it worked:* naming the epistemological difference up front made the extraction plan obvious and prevented a naive copy-paste.

**Design (draft).** On the "broader, general reusable skill" steer, the AI drafted a ~14 KB SKILL.md (vs 50 KB+ upstream): kept the universal, grep-able rules (palette bans, typography, em-dash, fake-data, fake-screenshot, motion-motivated), split them into **Part A (universal — fires on dashboards too)** and **Part B (marketing-only — skip for product UI)**, dropped the stack coupling and GSAP skeletons, and added an override path per rule. Attributed to taste-skill (MIT).

**Generate (package + wiring).** On "Package as new extension / wire the loop," the AI mirrored `mockup-loop`'s layout: because anti-slop is skill-only, the package needs just `pi.skills` — no `src/`, no tools, no deps. It created `package.json` (`@blackbelt-technology/anti-slop-frontend` v0.1.0), a README with the A/B scope table + loop relationship + attribution, then added the companion cross-reference to `frontend-mockup-loop`, spelling out precedence in both directions.

**Docs (delegated).** The AI checked the file-index split structure, decided anti-slop rows belong in `file-index-extension.md` (sibling design-skill package), and delegated the write to a `general-purpose` subagent with the caveman-style rule verbatim. The subagent corrected the AI's alphabetical-ordering assumption (`packages/anti-slop` sorts before `packages/extension`, not before `mockup-loop`).

**Verify + self-consistency + commit.** The operator pushed for "fill description," then two em-dash sweeps (first the `description:` field, then the whole body) so the skill eats its own dogfood. Final commit `27561da5` staged exactly five files, leaving unrelated working-tree changes alone.

## 4. Prompts that worked

- **The goal prompt (explore-mode kickoff).** Effective because it forced a *compare-before-build* stance; the AI read both skills fully and articulated the difference before touching a file. A stronger version states the endpoint up front: *"Explore how taste-skill relates to our frontend-mockup-loop; I want to extract the portable half into a new standalone skill package like mockup-loop and wire them together."*
- **"Its broader, general reusable skill. Thats the reason the frontend skill is separate extension. Draft"** — high-leverage: one sentence set the architecture (standalone package), the character (general/reusable), and the rationale (mirror the separate-extension pattern), then authorized drafting.
- **"Package as new extension. Part B be part. Yes, wire the loop"** — three decisions in one line: create the package, keep the marketing-only Part B, connect to the loop.
- **"fill description"** — short follow-up that triggered self-consistency scrutiny of the skill's own metadata.
- **"yes" / "commit"** — terminal confirmations that unblocked the body sweep and the final commit.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| stay in "compare" mode and not propose an artifact | "Draft" (authorize the write explicitly) | state the extraction endpoint in the goal prompt |
| under-specify packaging vs the existing pattern | "Package as new extension... that's why the frontend skill is separate" | name the mirror package (`mockup-loop`) up front |
| leave the marketing-only rules ambiguous | "Part B be part" | pre-declare the Part A universal / Part B marketing split |
| flag the em-dash in `description:` but leave it | "fill description", then "yes" to sweep the body | state a *self-consistency bar*: a skill that bans X must not contain X (except as a named literal) |
| assume alphabetical order for index rows | subagent caught `anti-slop` < `extension` | let the doc subagent verify sort order against real neighbors |
| risk committing unrelated tree changes | "commit" (AI then scoped the stage itself) | always `git reset` + explicit `git add` of only your files |

## 6. Skills, tools & memory created — and why they're effective

- **`packages/anti-slop/` (skill-only extension package)** — captures the portable, *mechanical and countable* anti-slop rules (palette bans, typography, em-dash, fake data, fake screenshots, motion) as an advisory catalog with a per-rule override path. Effective because it removes the framework-coupling of the 1200-line upstream, works on dashboards (Part A) as well as marketing surfaces (Part B), and ships as an independent sibling extension that can be installed on its own. Invoke it when doing a design/quality pass on any frontend surface.
- **The loop wiring in `frontend-mockup-loop` SKILL.md** — an "Anti-slop companion (advisory)" paragraph that feeds tells into the loop's FIX step with unambiguous precedence (cited rules + WCAG/severity gates always win). Effective because it composes two skills without letting the softer one override the hard gates. Invoke automatically whenever the mockup loop runs.

If repeating this extraction pattern often, create a **"harvest an external skill into a portable package"** skill capturing: read-both → epistemology table → keep-mechanical/drop-stack → skill-only package scaffold → wire-with-precedence → delegate docs → self-consistency sweep.

## 7. Pitfalls & dead ends

- **Alphabetical-ordering assumption for index rows.** The AI first assumed `packages/anti-slop` sorts before `mockup-loop`; the correct neighbor is `packages/extension`. If you hit index placement, verify against the *actual* adjacent rows, not a guess.
- **"Ban X but the skill contains X" inconsistency.** The `description:` (and later 19 body em-dashes) violated the skill's own em-dash ban. Fix: sweep to the skill's prescribed fallback (spaced hyphen ` - `; plain hyphen for ranges), but *preserve* backtick-wrapped literals that name the banned character (lines that literally say "ban the `—`").
- **Unrelated working-tree noise.** `.pi/settings.json*`, `docs/examples/c4-example.md`, `openspec/groups/groups.json` were dirty but not part of this work. The one failed `git status` inspection command was harmless; the fix was `git reset -q` then explicit `git add` of the five real files.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the external skill URL (`https://github.com/Leonxlnx/taste-skill`), the mirror package to copy conventions from (`packages/mockup-loop/`), and the target loop skill to wire into (`packages/mockup-loop/.pi/skills/frontend-mockup-loop/SKILL.md`).

- [ ] Explore mode; read both skills in full; produce an epistemology table.
- [ ] Keep mechanical/countable rules; drop stack coupling; add per-rule override.
- [ ] Split Part A (universal) vs Part B (marketing-only).
- [ ] Scaffold `packages/<name>/` skill-only: `package.json` (`pi.skills` only), `README.md`, SKILL.md.
- [ ] Validate `package.json`; confirm the `packages/*` workspace picks it up.
- [ ] Add advisory companion paragraph to the loop SKILL.md; state precedence (cited rules + WCAG win).
- [ ] Delegate `docs/` index rows to a subagent (caveman style, verbatim); verify sort order.
- [ ] Sweep self-inconsistencies (em-dashes) to prescribed fallbacks; keep named literals.
- [ ] `git reset` + explicit `git add` of only your files; commit.

**Artifacts produced:**
- `packages/anti-slop/.pi/skills/anti-slop-frontend/SKILL.md`
- `packages/anti-slop/package.json`
- `packages/anti-slop/README.md`
- `packages/mockup-loop/.pi/skills/frontend-mockup-loop/SKILL.md` (companion wiring)
- `docs/file-index-extension.md` (index rows + annotation)
- commit `27561da5`

---

_Generated from session `019f05a7-c3b7-7bbc-835c-755f5221eb9e` · `pi-agent-dashboard` · 2026-06-26. Source extract: `/tmp/facts-77819-1784852434.md`._
