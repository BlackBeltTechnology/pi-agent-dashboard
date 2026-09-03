# Contributing to PI Dashboard

This project is built with an AI agent (`pi`) doing most of the typing, and a human
doing the deciding. That shapes the workflow: it is not "branch, code, PR" — it is a
**spec-first pipeline** with explicit gates, and your job as a contributor is mostly to
supply intent, answer questions at the gates, and judge the output.

This document describes that pipeline **from the human side**: what you type, what you
are asked, where you must decide, and where you can walk away and let it run.

If you only remember one thing: **every feature and every bugfix starts as an OpenSpec
change, and ends as a squash-merge into `develop`.** There is no other path.

- Architecture reference: [`docs/architecture.md`](docs/architecture.md)
- Agent doctrine (what the agent must do every turn): [`AGENTS.md`](AGENTS.md)
- Setup, prerequisites, running locally: [`README.md`](README.md)
- Troubleshooting a red CI run: `ci-troubleshoot` skill

---

## The shape of it

Five phases. Two of them are yours to steer interactively; the rest can run unattended.

```mermaid
flowchart LR
  X["0 · EXPLORE<br/>interview-me → openspec-explore<br/><i>thinking only, no code</i>"]
  P["1 · PLAN<br/>branch develop<br/>MAIN SESSION ONLY<br/>human present"]
  B["2 · BUILD<br/>worktree .worktrees/os-&lt;c&gt;<br/>ship-it<br/>headless-capable"]
  S["3 · SHIP<br/>ship-change driven INLINE<br/>PR → CI → CodeRabbit"]
  M(["merged into develop"])
  CI["4 · CI — GitHub Actions<br/>machine side, no model"]
  POST["post-merge<br/>deploy-site · nightly · release"]

  X --> P
  P ==>|"WORKTREE BOUNDARY<br/>= interactive / headless line"| B
  B --> S
  S <-.->|"gh pr checks --watch"| CI
  S ==> M --> POST
  B -.->|"SHIP_IT_BLOCKED.md<br/>REVERSE BOUNDARY"| P

  classDef plan fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
  classDef build fill:#fff3e0,stroke:#e65100,stroke-width:2px
  classDef ship fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
  classDef ci fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
  class X,P plan
  class B build
  class S,M ship
  class CI,POST ci
```

<details>
<summary>Static PNG — if your viewer does not render Mermaid</summary>

![Pipeline overview](docs/pipeline-map/1-overview.png)

</details>

The thick arrow in the middle is the **worktree boundary**, and it is the single most
important line in this repo. To its left, planning happens on `develop` in your live
session, with you in the chair. To its right, implementation happens inside a dedicated
git worktree, and can run headless while you do something else.

The dotted arrow going backwards is the **escape hatch**. The boundary is not one-way:
when the build phase discovers the plan was wrong, it stops and hands the problem back to
you rather than quietly rewriting the plan by itself.

### Your two jobs, concretely

| Phase | Who drives | What you actually do |
|---|---|---|
| 0 · Explore | You | Talk. Argue. Reject bad framings. No files change. |
| 1 · Plan | You + agent | Answer gate questions, review the proposal, approve mockups, sanity-check the test plan. |
| 2 · Build | Agent | Nothing, unless it blocks. Go get coffee. |
| 3 · Ship | Agent | Nothing, unless CI or a reviewer surfaces something it will not auto-fix. |
| 4 · CI | Machine | Nothing. |

---

## Phase 0 — Explore: decide whether the thing is worth building

Start here whenever the idea is still fuzzy. Say something like *"let's explore adding
per-session token budgets"* or just `/skill:openspec-explore`.

Explore mode is deliberately **incapable of writing code**. It reads, searches, argues,
and challenges your framing. It may create OpenSpec artifacts if you ask — that is
capturing thinking, not implementing.

If your ask is underspecified — no clear who, why, success criterion or constraint — the
agent may instead run `interview-me`, which asks you **one question at a time** until it
is ~95% confident it understands what you want. This feels slow. It is much faster than
discovering the misunderstanding three hours later in a review.

**Exit criterion:** you can state, in one sentence, what changes and how you would know
it worked. Then move to planning.

For a small, obvious bugfix, skip this phase entirely and go straight to planning.

---

## Phase 1 — Plan: write the spec, review it adversarially, design the tests

Say **"plan this change"** (or `/skill:plan-proposal`). You must be on `develop`, and this
must run in your **main interactive session** — not a subagent. Two of the steps below
need to ask you questions, and a subagent cannot.

```mermaid
flowchart TD
  subgraph PLAN["1 · PLAN — branch develop · plan-proposal · MAIN SESSION ONLY"]
    direction TB
    P1["openspec-new / -ff / -continue<br/>proposal.md · design.md<br/>specs/**/spec.md · tasks.md"]
    P2{{"doubt-driven-review<br/>SUBAGENT fresh-context<br/>+ cross-model 2nd reviewer offer<br/>ARTIFACT + CONTRACT only, never the CLAIM"}}
    P3["frontend-mockup-loop-dashboard<br/>GROUND → CONTRACT → MOCKUP → TEST<br/>→ FIX → PROMOTE → LEARN<br/>changes/&lt;c&gt;/mockups/ + ui-plan.md"]
    P4["scenario-design — MANDATORY<br/>writes test-plan.md manifest<br/>level: L1 | L2 | L3 | electron | ci<br/>disposition: automated | manual-only"]
    P5["FOLD manifest → tasks.md<br/>vanilla '- [ ]' only<br/>+ harness-exemplar pointer<br/>+ Triple: input · trigger · observable"]
    P6{"fold-completeness gate<br/>every manifest row ↔<br/>exactly one task"}
    P7["commit 'docs(&lt;c&gt;): plan …' to develop"]

    P1 --> P2
    P2 -->|"valid + actionable finding → PAUSE"| P1
    P2 -->|"stop: trivial / 3 cycles / ship it"| P3
    P3 --> P4 --> P5 --> P6
    P6 -->|incomplete| P5
    P6 -->|pass| P7
  end
  P7 ==>|"STOP at the boundary<br/>worktree spawned from this commit"| OUT(["→ ship-it"])

  classDef gate fill:#ffebee,stroke:#c62828,stroke-width:2px
  classDef sub fill:#ede7f6,stroke:#4527a0,stroke-width:2px
  class P6 gate
  class P2 sub
```

<details>
<summary>Static PNG — if your viewer does not render Mermaid</summary>

![Planning phase](docs/pipeline-map/2-plan.png)

</details>

### What gets written

Everything lands in `openspec/changes/<change-name>/`:

- **`proposal.md`** — why, what changes, what is explicitly out of scope. Also a
  `## Discipline Skills` section naming which engineering disciplines the work triggers
  (security, performance, observability…). If none apply, it says so under the heading —
  omitting the heading is not allowed.
- **`design.md`** — only when the change warrants one.
- **`specs/**/spec.md`** — the requirement deltas.
- **`tasks.md`** — the checklist the build phase executes.
- **`test-plan.md`** — the test manifest (see below).
- **`mockups/`** — when UI is involved.

### The doubt review (you will be offered a second opinion — take it)

Whenever the proposal or design is written or changed, it goes to `doubt-driven-review`:
a **fresh-context subagent** that has not seen the conversation. It receives only the
artifact and the contract it must satisfy — deliberately **never** the agent's own claim
that the work is good, because that primes the reviewer to agree.

In an interactive session you are also **always offered a cross-model second reviewer** —
a different model entirely. Accepting costs a minute and catches the class of mistake a
model is blind to in its own output. Take it for anything non-trivial.

Findings are triaged by precedence: contract-misread → actionable → trade-off → noise.
An actionable finding **pauses everything** until the artifact is corrected. The loop
stops after trivial findings, three cycles, or your explicit "ship it".

### Mockups, if there is UI

UI changes go through a design loop: GROUND → CONTRACT → MOCKUP → TEST → FIX → PROMOTE →
LEARN. The agent serves the mockup on a local URL **and a LAN URL that works on your
phone**, and hands it to you for review. Look at it on a real device.

Mockups land in `openspec/changes/<name>/mockups/`, with `ui-plan.md` mapping surfaces →
design tokens → states. Tokens come from the 4-theme system (studio, earth, athlete,
gradient); verify **both dark and light**. Roughly 150 mockups are already in the repo —
the agent should copy a nearby one rather than inventing a new visual language.

### The test plan (this is the part people try to skip — don't)

`scenario-design` is **mandatory**. It derives real-life scenarios — edge cases,
performance, frontend quirks, error handling — not smoke tests, and writes
`test-plan.md`. Every row carries:

- a **level**: `L1` (vitest unit), `L2` (`qa/*.sh` VM smoke), `L3` (`tests/e2e/*.spec.ts`
  Playwright against the docker harness), `electron`, or `ci`;
- a **disposition**: `automated` or `manual-only`.

Those rows are then **folded** into `tasks.md` as ordinary checkboxes. Each folded test
task must name an **exemplar** — the nearest existing test of that category to copy
harness glue from. A bare "author some.spec.ts" is rejected.

A gate then checks that **every manifest row maps to exactly one task**. If your
`tasks.md` comes out as smoke-tests-only, planning has failed and you should push back.

**Your call at this point:** read `test-plan.md`. Ask "if this shipped broken, which row
would have caught it?" If the answer is "none", say so now — it is a hundred times cheaper
than saying it in review.

### Crossing the boundary

Planning artifacts get committed to `develop` as `docs(<change>): plan …`, and the
worktree is spawned from that commit — either via the dashboard's "start work" button or
`git worktree add`. The worktree is `.worktrees/os-<change>` on branch `os/<change>`.

Then planning **stops**. It does not slide into implementation.

---

## Phase 2 — Build: the agent writes code, and gates itself

From inside the worktree, say **"ship it"**. This phase is designed to run **headless** —
you can start it and leave.

```mermaid
flowchart TD
  subgraph BUILD["2 · BUILD — worktree os/&lt;c&gt; · ship-it · headless-capable"]
    direction TB
    S1["1 · orient<br/>openspec status = orientation ONLY<br/>filesystemRealityCheck: test file exists AND passes<br/><b>a checkbox is NEVER proof</b>"]
    S2["2 · openspec-apply-change<br/>+ inject resolved harness-exemplar path<br/>SUBAGENTS: Explore · Audit · DocScribe<br/>react-expert · nodejs-expert · typescript-expert · tailwind-expert"]
    S25["2.5 · git fetch + merge origin/develop<br/>integration UPSTREAM of the strong gate<br/>merge, never rebase · conflict → abort + STOP"]
    S3["3 · docker harness<br/>test-up.sh → read dashboardPort from .pi-test-harness.json<br/>L1 vitest · L2 qa/*.sh · L3 tests/e2e/*.spec.ts<br/>trap EXIT = test-down.sh ALWAYS"]
    S4{"4 · red-test fix loop — OWNED BY ship-it<br/>never re-invoke apply on a checked task<br/>assertNoWeakening on every test diff<br/>bound = a no-progress cycle"}
    S44["4.4 · deterministic enforcers — offline, before any model call<br/>check-conventions --base origin/develop · dox-byte-gate<br/>i18n-lint --strict · i18n-parity<br/>knip-config → knip-ratchet → --check-baseline-diff"]
    S45{{"4.5 · local review checkpoint — UNCONDITIONAL<br/>isolated SUBAGENT model @review, review-code rubric<br/>REQUIRED — no fallback to session default = self-review<br/>300 s cap · classifyFindings · MAX 2 ROUNDS"}}

    S1 --> S2 --> S25 --> S3 --> S4
    S4 -->|red| S3
    S4 -->|green| S44
    S44 -->|non-zero exit| S4
    S44 -->|clean| S45
    S45 -->|"issue(blocking)"| S4
  end
  S45 -->|clean| OK(["→ ship-change, inline"])
  S4 -->|no-progress / design gap| ESC["SHIP_IT_BLOCKED.md<br/>worktree left intact · exit non-zero<br/>surfaced on the dashboard"]
  S45 -->|"unsatisfiable without weakening a test"| ESC
  ESC -.->|"REVERSE BOUNDARY — human re-enters plan-proposal"| BACK(["← PLAN"])

  classDef gate fill:#ffebee,stroke:#c62828,stroke-width:2px
  classDef sub fill:#ede7f6,stroke:#4527a0,stroke-width:2px
  classDef esc fill:#fff8e1,stroke:#f57f17,stroke-width:2px
  class S4,S44 gate
  class S45,S2 sub
  class ESC esc
```

<details>
<summary>Static PNG — if your viewer does not render Mermaid</summary>

![Build phase](docs/pipeline-map/3-build.png)

</details>

A few properties worth understanding, because they explain the behaviour you will observe:

**A ticked checkbox is never trusted.** On every invocation the agent re-derives, from the
filesystem, whether each automated scenario's test file actually exists and actually
passes. A `- [x]` written by a previous partial run proves nothing. This is what makes
"ship it" safe to re-run after an interruption: a re-run and a fresh run converge on the
same end state.

**`develop` is merged before the strongest gate, not after.** The docker e2e harness is
the most expensive and most truthful check in the pipeline, so integration happens
*upstream* of it — the harness validates the merged tree, not your stale one. It merges
`origin/develop` (a merge, never a rebase, because the PR is squash-merged anyway and
force-pushing a worktree branch is a known footgun). A conflict it cannot resolve
mechanically aborts and stops rather than testing a half-merged tree.

**Tests may not be weakened to reach green.** Every edit to a test file is diffed against a
mechanical guard that rejects added `.only`/`skip`, deleted assertions, and strong→
permissive matcher swaps. If a fix is only achievable by softening a test, the agent is
required to stop and escalate instead.

**Cheap checks run before expensive ones.** A batch of deterministic, offline enforcers —
conventions, doc byte budgets, i18n lint and parity, and the knip dead-code ratchet — runs
*before* any model is asked to review. A mechanically-broken tree never costs a model call.
The dead-code ratchet is one-way: you fix a failure by deleting dead code, never by raising
the baseline.

**The code review is unconditional and cannot be self-review.** Every run — no matter how
small the diff — spawns an isolated reviewer subagent bound to the `@review` role, with the
`review-code` rubric, fed the three-dot diff plus the proposal. There is deliberately no
fallback to the session's own model, because that model wrote the code. If `@review` is
unconfigured, the run fails and tells you to set it. Only blocking findings re-enter the
fix loop; the review is capped at two rounds.

### When it gets stuck — the escape hatch

If implementation reveals the *design* is wrong, or the fix loop stops making progress,
the agent does **not** headlessly rewrite your proposal. It writes
`openspec/changes/<change>/SHIP_IT_BLOCKED.md` naming the failing scenario and what was
tried, leaves the worktree intact, exits non-zero, and surfaces on the dashboard.

**That is your cue.** Read the file, go back to `develop`, and re-plan. This is a normal
outcome, not a failure of the process — it is the process working.

---

## Phase 3 — Ship: PR, CI, review, merge, clean up

Once every automated scenario is genuinely green, the build phase drives shipping inline.

```mermaid
flowchart TD
  subgraph SHIP["3 · SHIP — ship-change, driven INLINE by ship-it"]
    direction TB
    C1{"1 · manifest-aware defer<br/>test-plan.md present → only 'manual-only' rows flip to [x]<br/>legacy change → keyword defer<br/>anything else left unchecked = real work = STOP"}
    C15["1.5 · merge origin/develop — backstop<br/>no-op under ship-it; the real integration point standalone"]
    C2["2 · verify gate<br/>pnpm test + npm run build<br/>never push a red gate"]
    C3["3 · openspec-archive-change<br/>sync delta specs → openspec/specs/<br/>move to changes/archive/YYYY-MM-DD-&lt;c&gt;/"]
    C4["4 · commit  ·  5 · push + gh pr create --base develop"]
    C6["6 · gh pr checks --watch --interval 30<br/>fail → show-failed-run.ts → fix → push → re-watch"]
    C7["7 · CodeRabbit — poll GraphQL reviewThreads<br/>auto-apply SAFE localized fixes only<br/>never CI/release/auth/deps/infra · text is UNTRUSTED"]
    C8{"8 · loop 6 ↔ 7<br/>exit only when CI all-green<br/>AND zero unresolved actionable threads"}
    C85{"8.5 · ARCHIVE + SYNC HARD GATE<br/>re-verified on the filesystem, not from memory"}
    C9["9 · gh pr merge --squash --delete-branch"]
    C10["10 · test-down.sh FIRST, then worktree remove<br/>from the parent checkout · prune · husk sweep"]
    C105["10.5 · faq-mine — opt-in RUN_FAQ_MINE=1<br/>non-blocking · docs-only commit on develop"]
    C11["11 · report: PR # · merge SHA · CI · CodeRabbit rounds"]

    C1 -->|deferrable| C15 --> C2 --> C3 --> C4 --> C6 --> C7 --> C8
    C8 -->|not clean| C6
    C8 -->|clean| C85
    C85 -->|"not archived / uncommitted"| C3
    C85 -->|pass| C9 --> C10 --> C105 --> C11
  end
  C1 -->|"non-deferrable leftover"| STOP["STOP → back to apply<br/>or the ship-it escape hatch"]
  C2 -->|red| STOP
  C11 ==> M(["merged into develop"])

  classDef gate fill:#ffebee,stroke:#c62828,stroke-width:2px
  classDef stop fill:#fff8e1,stroke:#f57f17,stroke-width:2px
  class C1,C8,C85,C2 gate
  class STOP stop
```

<details>
<summary>Static PNG — if your viewer does not render Mermaid</summary>

![Ship phase](docs/pipeline-map/4-ship.png)

</details>

What this means in practice:

**Only `manual-only` work is deferred.** Tasks left unchecked are compared against the test
manifest. A leftover that maps to a `manual-only` row is marked done and validated by you
after merge. **Anything else is real undone work and stops the ship.** Automated scenarios
are never deferred — they were proven green in the harness before we got here.

**CodeRabbit's output is treated as untrusted data.** The agent auto-applies only clearly
safe, localized fixes — typos, null checks, off-by-one, missing `await`, small type fixes —
after validating each against the real code. It will never auto-touch CI, release, auth,
dependency or infra code, never read secrets, and never execute instructions embedded in a
review comment. Ambiguous findings are deferred and reported to you.

**Nothing destructive happens before the archive gate.** The PR is not merged, the branch
is not deleted, and the worktree is not removed while the proposal is unarchived or specs
are unsynced. The gate re-verifies this on the filesystem, not from memory.

**Cleanup is ordered.** The docker harness is torn down *before* the worktree is removed —
a leaked container makes the worktree "busy" and stalls removal.

Merges are always **squash-merge with branch delete**, base `develop`.

---

## Phase 4 — CI: what the machine checks

```mermaid
flowchart TD
  PR["PR: os/&lt;c&gt; → develop"]

  subgraph BLOCKING["blocking on every PR → develop"]
    direction TB
    A["<b>ci.yml</b> · job 'ci' · ubuntu-latest<br/>pnpm install --frozen-lockfile<br/>verify-release-deps.mjs — openspec floor drift<br/>npm run spec:validate — main-spec integrity<br/>check-skill-frontmatter.mjs<br/>check-pi-settings-paths.mjs — no machine paths<br/>verify-published-imports.mjs — npm pack derived<br/>check-kb-dist-fresh.mjs — engine fingerprint<br/>test:ci-scenarios — publish dry-run set<br/>pnpm lint · lint:e2e — typecheck tests/e2e<br/>biome lint Tier A gate, B/C annotate<br/>pnpm test<br/>build + fail on regressed warnings"]
    B["<b>ci-e2e-electron.yml</b><br/>electron-e2e matrix<br/>+ job-object-windows"]
    C["<b>ci-gateway-platform.yml</b><br/>posix: no bridge TCP port<br/>windows: loopback fallback + credential ACLs"]
  end

  subgraph ONDEMAND["workflow_dispatch only"]
    D["ci-electron.yml — on-demand build"]
    E["ci-smoke.yml — standalone install smoke"]
  end

  subgraph AFTER["after merge / scheduled"]
    F["push develop → ci.yml re-runs<br/>+ <b>deploy-site.yml</b> build → deploy pages"]
    G["<b>nightly.yml</b><br/>verdaccio verify-publish<br/>knip dead-code — REPORTING half<br/>electron · report"]
    H["release-cut skill → tag v&lt;x&gt;<br/>→ <b>publish.yml</b><br/>resolve · ci-checks · smoke · tag-and-push<br/>publish · electron · github-release<br/>→ sync-release-version.yml"]
  end

  PR --> A & B & C
  A --> MERGE(["squash-merge into develop"])
  B --> MERGE
  C --> MERGE
  MERGE --> F --> G --> H

  NOTE["asymmetry: the STRONG gate — the docker e2e harness — runs LOCALLY in ship-it, not in CI.<br/>knip is inverted: preventive ratchet local at 4.4, reporting-only nightly."]

  classDef block fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px
  classDef note fill:#fffde7,stroke:#f9a825,stroke-width:1px
  class A,B,C block
  class NOTE note
```

<details>
<summary>Static PNG — if your viewer does not render Mermaid</summary>

![CI workflows](docs/pipeline-map/5-ci.png)

</details>

Two asymmetries surprise people:

1. **The strongest test gate is local, not in CI.** The docker e2e harness runs in the
   worktree during the build phase. CI runs the unit suite, lint, typecheck and build —
   it does not re-run the browser harness on every PR.
2. **Dead-code detection is inverted.** The *preventive* knip ratchet runs locally before
   the PR exists; the nightly job is only the *reporting* half and can no longer block
   anything by the time it runs.

Dependencies are installed with **pnpm only** (`pnpm-workspace.yaml` sets
`nodeLinker: hoisted`) — an `npm install` drifts the tree and will bite you.

---

## The inner loops, and what stops each one

Every loop in this pipeline has an explicit, different stop condition. Knowing them tells
you whether the agent is working or spinning.

```mermaid
flowchart LR
  subgraph L["the six inner loops and what stops each"]
    direction TB
    L1["<b>doubt cycle</b> · PLAN<br/>actor: fresh-context SUBAGENT + cross-model<br/>STOP: trivial findings | 3 cycles | 'ship it'"]
    L2["<b>mockup loop</b> · PLAN<br/>actor: main session + serve_mockup / score_mockup<br/>STOP: rubric pass — contrast + responsive + anti-slop,<br/>both themes, 3 breakpoints"]
    L3["<b>fold gate</b> · PLAN<br/>actor: main session<br/>STOP: every manifest row ↔ exactly one task"]
    L4["<b>red-test fix</b> · BUILD 4<br/>actor: ship-it ITSELF — never apply<br/>STOP: a cycle that changes nothing → escape hatch"]
    L5["<b>review round</b> · BUILD 4.5<br/>actor: isolated @review SUBAGENT<br/>STOP: hard cap 2 rounds, 300 s per call<br/>— NOT a no-progress bound: a model always 'progresses'"]
    L6["<b>CI ↔ CodeRabbit</b> · SHIP 6 ↔ 8<br/>actor: session drives, GitHub executes<br/>STOP: all checks green AND no actionable threads"]
    L1 --> L2 --> L3 --> L4 --> L5 --> L6
  end
  classDef s fill:#e8eaf6,stroke:#283593,stroke-width:2px
  class L1,L2,L3,L4,L5,L6 s
```

<details>
<summary>Static PNG — if your viewer does not render Mermaid</summary>

![Inner loops](docs/pipeline-map/6-loops.png)

</details>

Note the deliberate difference between the fix loop and the review loop. The fix loop is
bounded by **no progress** — a cycle that changes nothing means it is stuck. The review
loop cannot use that rule, because a reviewer can invent a fresh finding every round and
each fix does change the tree; so it gets a **hard numeric cap of two rounds** instead.

---

## Bugfixes: the same pipeline, compressed

A one-line bugfix uses the identical path, just thinner:

1. Skip explore. Say *"plan a fix for &lt;symptom&gt;"*.
2. The proposal is short. The doubt review usually terminates on trivial findings in one
   cycle — still take the cross-model offer if the bug is subtle.
3. `scenario-design` still runs, and this is where the value is: **the regression test is
   the point of the fix.** A bugfix whose test plan has no row reproducing the bug is not
   a fix, it is a guess.
4. Build, ship, merge as normal.

If you are tempted to skip the spec for something trivial — a typo, a comment, a version
bump — then just make the commit. The pipeline is for behaviour changes.

---

## Things that will annoy you, and why they exist

| Friction | Reason |
|---|---|
| "Why is it asking me questions before writing anything?" | Every question at planning time is worth roughly an hour at review time. |
| "Why can't it just skip the test plan for this small change?" | Because the small change is the one that ships broken. Smoke-tests-only is a planning failure by definition. |
| "Why did it stop instead of fixing the test?" | Because the only remaining fix was to weaken the test, which is forbidden. |
| "Why is it re-running things I already saw pass?" | Because it verifies against the filesystem, not against its own memory of having passed. |
| "Why a whole worktree instead of a branch?" | So the build phase can run headless without touching your checkout, and so several changes can be in flight at once. |
| "Why is docs writing delegated to another agent?" | Docs under `docs/` use a compressed style optimised for agent reading; a dedicated subagent enforces it. See [`AGENTS.md`](AGENTS.md). |

---

## Quick reference

```bash
pnpm install                                       # deps — pnpm ONLY
npm test                                           # vitest, whole repo
npm run build                                      # web client (Vite)
npm run reload                                     # after packages/extension/ changes
curl -X POST http://localhost:8000/api/restart     # after server/shared changes
npm run test:e2e                                   # Playwright, opt-in, needs the docker harness
npm run quality:changed                            # Biome on changed files
```

Rebuild rule of thumb: **extension → reload · server/shared → restart · client → build +
restart · applied OpenSpec change → full rebuild.** Details in the `implement` skill.

When something is broken at runtime, start with the `debug-dashboard` skill; when CI is
red, start with `ci-troubleshoot`.

---

## Diagram sources

The Mermaid blocks above are the source of truth — GitHub renders them natively. The PNGs
in the collapsed `<details>` are only a fallback for viewers that do not (some editors,
PDF exports, plain-text diffs).

Both live in [`docs/pipeline-map/`](docs/pipeline-map/). **If you edit a diagram, edit it in
both places** — the block in this file and the matching `.mmd` — then re-render its PNG:

```bash
cd docs/pipeline-map
mmdc -i 3-build.mmd -o 3-build.png -b white -s 2 -c mmdc.json
```

Use Mermaid for any new diagram in this repo — never ASCII box drawings.
