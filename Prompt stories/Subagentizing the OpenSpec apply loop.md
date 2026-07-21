# How we did it: subagentizing the OpenSpec apply loop (and splitting code review two ways) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (the `openspec-explore` skill) with a design question, quoted from the first prompt:

> "When open spec applied a task list is processed. … make subagents which can operate own context but all informations / skills prepared needed to the task done. Maybe the development / reviewer / tester / documenter agents can be separated. But be careful, make that way that the quality is same or better than in current one session orchestration."

The **real objective**, once steering clarified it: decide *whether and how* to turn the OpenSpec apply-loop work into subagents — each running in its own isolated context but fully equipped with the skills/KB it needs — **without losing the coherence** a single-session orchestration gives you. The tacit success bar was "quality ≥ today," which turned out to be the whole design constraint.

It became a four-part deliverable: (1) a two-tier code-review split, (2) two real apply-loop subagents, (3) a portable skill that generalizes the whole technique, (4) everything committed cleanly in a shared working tree.

## 2. TL;DR playbook

1. **Enter explore mode and ground in the real codebase first.** Read the apply skill, the subagent producer, and the existing `.pi/agents/` before theorizing. (`ctx_batch_execute` over the files, not guesses.)
2. **Research the genuine tension in parallel.** Fetch + index Anthropic "multi-agent research system" (pro) *and* Cognition "don't build multi-agents" (anti), plus Google eng-practices + Conventional Comments. The disagreement between them *is* the design.
3. **Apply one discriminator to every candidate slot:** *does this phase need shared coherence with the build?* → **yes = inline skill**; **no, and it's read/write-light returning a distilled artifact = subagent.**
4. **For code review specifically, split by moment:** dev inner-loop reviewer = a skill on an *unlimited* model engine; the *rate-limited* cloud gate (CodeRabbit) = opt-in, reserved for the PR. Distill the review discipline from *scored* public sources, not memory.
5. **Build only the slots that earn isolation.** Here: `Audit` (deep security/perf pass) + `DocScribe` (docs writer). Keep builder, reviewer, tester inline. Wire spawns via a **checkpoint table** (signal → spawn) — pi has no auto-delegation.
6. **Dogfood a subagent to verify, then review its output — never trust blind** (especially on a cheap model).
7. **Extract the reusable methodology into a portable skill** once you've done it by hand once.
8. **Commit each unit atomically** (`git reset && git add <files> && git commit` in one command) because the working tree is shared with concurrent sessions.

## 3. How the collaboration unfolded

**Phase A — Ground & research (Discovery).** The AI resisted theorizing: it first read the apply/implement skills, the `pi-dashboard-subagents` producer, and the shipped wrapper agents, then fetched *both sides* of the multi-agent debate in parallel. *Why it worked:* the recommendation was anchored in how pi actually spawns/feeds subagents and in cited evidence, so it survived scrutiny instead of being vibes.

**Phase B — The review sub-thread (Design → Build).** A steering turn redirected from "subagents" to "use a code reviewer while developing as a skill; CodeRabbit only at ship." The AI discovered CodeRabbit was doing **triple duty** on a rate-limited API, reframed the ask as a *resource conflict*, then scored six review methodologies and distilled the `review-code` discipline. *Decision point:* the human chose **skill, not subagent** for review — because review+fix is coherence-critical.

**Phase C — Subagent design (Design).** Returning to the main thread, the AI reused the review outcome as a **discriminator** and re-scored the four speculative roles. Four peers collapsed to **two** real subagents (`Audit`, `DocScribe`) + reviewer-as-skill + builder/tester inline.

**Phase D — Build & dogfood (Generate → Verify).** Wrote the two agent `.md` files, wired checkpoint tables, then **spawned `DocScribe` to document its own siblings** — a live end-to-end test. The AI reviewed the subagent's diff before accepting it.

**Phase E — Extract (Generalize).** The final steering turn asked whether the technique could be a general, tech-stack-independent skill. The AI split the fused doc into a **portable skill** (`skill-to-subagent`) + a **repo-specific instance** (the old doc, reframed), delegating the doc edits back to `DocScribe`.

## 4. Prompts that worked

- **The goal prompt (explore mode + rich context).** Pasting the `openspec-explore` skill set a *thinking* stance and licensed the AI to investigate without prematurely implementing. Effective because it separated "think" from "build" — the messy design work happened before any file was touched.
- **"research for best practices" (high leverage).** Three words that forced the AI off its own opinions and onto cited sources. Rewrite for reuse: *"Research this from authoritative sources, score them, and ground the recommendation in the actual codebase."*
- **"use a code reviewer while developing as a skill … coderabbit gate … when we ship the PR."** Reframed a vague preference into a concrete architecture. Effective because it named *the moment* (dev vs ship), which is the real axis.
- **"1. research… distill one general purpose … 2. Skill 3. yes" (batch decision).** Answering several open questions in one numbered reply unlocked a big chunk of work. Reuse the pattern: when the AI asks 2–3 questions, answer them all at once, numbered.
- **"skip rename" (decisive scope cut).** Once the rename revealed a costly fork, one prompt killed it. Effective because it accepted a known residual instead of chasing perfection.
- **"Is it possible to extract … a general purpose, tech stack independent skill …"** The extraction insight — turning a one-off into reusable tooling.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human steered by… | Bake this in next time by… |
|---|---|---|
| Start reasoning from first principles | "research for best practices" | Instruct up front: *cite sources + read the codebase before recommending* |
| Propose building a new reviewer | (implied) "maybe we already have it" | Always search existing skills before authoring a new one |
| Fuse the general methodology with repo-specific detail | "Not only this project, a general one which defines the disciplines" | Separate the portable procedure (skill) from the repo instance (doc) from the start |
| Plan a full rename with large cross-ref fan-out | "skip rename" | Surface the cost/fork **early**, offer a skip option, don't sink time first |
| Claim `inherit_context: true` for context-needing subagents | (AI self-corrected) | Default to `false` + pass exact inputs in the prompt; a compressed snapshot drops details |
| Want to commit everything dirty | "commit" (repeatedly, scoped) | Only ever stage *your* files; the tree is shared — never sweep concurrent WIP |

The recurring meta-lesson: **the human kept the AI honest about scope and evidence.** Every redirect was either "ground this" or "don't over-build this."

## 6. Skills, tools & memory created — and why they're effective

- **`review-code` skill** (`packages/eng-disciplines`) — engine-agnostic code-review *discipline*: governing principle (pass on "definitely improves health," not perfection — the loop terminator), dimension order, Conventional-Comments severity taxonomy, review→fix loop. *Effective because* it runs on an unlimited model engine, so the dev inner loop reviews every change without spending cloud quota. *Invoke* per non-trivial change before commit.
- **`skill-to-subagent` skill** (`packages/authoring-toolkit`) — the portable procedure for turning any skill into an isolated subagent and wiring it into a pipeline. *Effective because* it captures the discriminator + bridge template + pitfalls once, so the next conversion is mechanical. *Invoke* on "wrap this skill as a subagent" / "should this be a subagent."
- **`Audit` subagent** (`.pi/agents`, `@research`) — deep read-only security+perf pass on a diff; returns labelled findings, parent fixes inline. *Invoke* when a diff touches auth/secrets/PII/untrusted-input/perf-budget.
- **`DocScribe` subagent** (`.pi/agents`, `@compact`) — writes `docs/` prose in caveman style (the AGENTS.md Rule-6 delegation target). *Invoke* after a change lands and docs need updating. **Proven live** — it documented itself.
- **Memory (project convention):** the two-tier review rule, so future sessions don't re-spend CodeRabbit in the inner loop.

## 7. Pitfalls & dead ends

- **YAML `": "` trap silently drops a skill/agent.** An unquoted `description` with an inner colon-space parses as a nested map and the loader drops it. *Fix:* quote the whole value or reword (em-dash). Caught `DocScribe`'s "Self-contained: give it…" this way.
- **Renaming a *vendored* skill is a fork, not a `mv`.** `code-review` is pinned in `skills-lock.json` (from `coderabbitai/skills`); a local rename desyncs and re-pulls. *Fix:* check provenance before renaming; if you must retarget its trigger, you've already forked it — decide consciously.
- **The multi-edit tool takes an `edits[]` array — not `oldText2`/`newText2`.** Extra numbered fields are silently ignored (only the first block applies). *Fix:* put every replacement as its own array entry.
- **Memory store hit capacity mid-write, with a concurrent session also writing.** *Fix:* compact a verbose, version-stale entry to free room, then add the new one fast (usage shifts under you).
- **`git index.lock` from a concurrent session** blocks commits. *Fix:* **don't force-remove it** — poll until it clears (the other commit finishes), then retry atomically.
- **`ctx_batch_execute` threw a disk-I/O error** once. *Fix:* fall back to a plain `Bash` command.
- **Delegating a nuanced `docs/` restructure to a cheap model.** *Fix:* give bounded, anchor-preserving instructions (keep headings verbatim; condense, don't delete) and **review the diff** — it also introduced repo-root-relative links from a `docs/` file that needed `../`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- Explore mode available (`openspec-explore`); the target apply/implement skills readable.
- Web fetch for the cited sources (Anthropic multi-agent, Cognition, Google eng-practices, Conventional Comments).
- Role aliases configured (`@research`, `@compact`, `@fast`) — `list_roles` to confirm.

**Checklist:**
- [ ] Ground in the codebase + cite sources *before* recommending.
- [ ] Apply the discriminator to every candidate: coherence-critical → inline skill; read/write-light + distilled → subagent.
- [ ] Split rate-limited tools by moment (dev skill vs ship gate); reserve quota for the PR.
- [ ] Build only slots that earn isolation; keep the builder/decider inline.
- [ ] Frontmatter `description` quoted-or-trap-free; `model` a role alias; `inherit_context: false` + explicit inputs; least-privilege `tools`; ≤2KB output contract.
- [ ] Wire a checkpoint table (signal → spawn) — pi has no auto-delegation.
- [ ] Dogfood one spawn; review its output.
- [ ] Extract the reusable procedure into a skill once the manual pass works.
- [ ] Commit each unit atomically; never stage concurrent-session files.

**Artifacts produced (4 commits):**
- `a5e1107a7` — `review-code` discipline + two-tier review split (`review-changes.ts` opt-in flip)
- `c1efc1fe1` — `Audit` + `DocScribe` subagents + apply-loop checkpoint wiring
- `97a3b1aef` — `skill-to-subagent` portable skill; `docs/skills-as-subagents.md` reframed as instance
- Key files: `packages/eng-disciplines/.pi/skills/review-code/`, `.pi/agents/Audit.md`, `.pi/agents/DocScribe.md`, `packages/authoring-toolkit/.pi/skills/skill-to-subagent/`

---

_Generated from session `019f6d24-4d5e-769d-9fbf-e94c80eb296c` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-17. Source extract: `/tmp/session_facts.md`._
