---
session: 019f2d47
week: 2026/W27
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (14 user prompts)"
upgrade_status: pending
openspec_changes: [electron-attach-ownership-fixes]
proposal_excerpt: "When the Electron app launches and discovers a dashboard server already running on `:8000`, it takes the `attach` arm of the bootstrap state machine. `decideShutdownOnQuit` correctly refuses to stop a server Electron…"
---

# How we did it: Doubt-review + cross-platform hardening of an Electron ownership design — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a single, deliberately terse prompt: **"doubt review"**. The
target was an *in-flight* OpenSpec change — `electron-attach-ownership-fixes` — sitting
at design stage with a clean tree (no code written yet). The real objective, which the
14 steering turns progressively sharpened, was: **stress-test a four-thread ownership /
zombie-detection design before it hardens into code, then fold the fixes and the
cross-platform (Windows) reality back into every artifact** (`proposal.md`, `design.md`,
`tasks.md`, two spec deltas) until `openspec validate` passes. What began as "poke holes
in this" became a full re-architecture of the zombie-detection scheme across macOS,
Linux subreapers, and Windows — including native-library packaging and a jiti-safety
review.

## 2. TL;DR playbook

1. Start the doubt cycle **at design stage, on a clean tree** — the cheapest moment to be wrong. Prompt: `doubt review`.
2. Before cross-examining, **verify the load-bearing claims against source** (grep the actual `ppid`, `getActiveBridgeCount`, `detached-spawn.ts` invariants). Don't trust what the design *asserts*.
3. Run an **adversarial cross-model review**: hand a second, different-architecture model only the ARTIFACT + CONTRACT (no CLAIM, no your own findings), then RECONCILE. Two independent architectures agreeing is the strong signal.
4. Classify every finding: 🔴 Actionable / 🟡 Trade-off / new-only. Apply fixes 1–N across **all** artifacts in one pass, then `openspec validate`.
5. **Interrogate the platform you skipped** — ask "and what about Windows?" explicitly. Verify the mechanism (Job Object `KILL_ON_JOB_CLOSE`) rather than accept a "non-issue" hand-wave.
6. When a platform genuinely differs (Windows never reparents orphans; aggressive PID reuse), **research libraries/practices** before inventing — surface `ps-list`, handle-wait via `OpenProcess`/`WaitForSingleObject`, and check what the repo *already ships* (`isProcessAlive`, `node-pty`).
7. **Fold research into a tiered design** (Tier 1 pure-PID baseline, Tier 2 identity-safe koffi upgrade as an optional dep) and thread the new health field through every artifact.
8. Close the loop on **packaging + runtime**: confirm the native module ships (extraResource, outside asar), and verify the jiti loader interaction against an existing precedent (`node-pty` already loads under jiti).

## 3. How the collaboration unfolded

**Phase A — Ground the claims (Discovery).** The AI recognized the design was pre-code
and grepped source for the load-bearing assertions (`ppid` caching, `connectionCount()`,
`detached-spawn.ts` Job Object invariants) *before* forming any critique. This is the bit
worth repeating: the type system can't check "ppid is stable for a process lifetime," so
the AI verified it empirically and found the rationale **exactly inverted**.

**Phase B — Cross-model adversarial review (Verify).** The human steered the reviewer
model hard: `use vertex gemini` (×2) → `use vertexai gemini as subagent` →
`google-vertex/gemini-3.1-pro-preview`. First Gemini attempts returned empty (role-only
alias, not SDK-invocable); the AI fell back to GLM, then succeeded with the fully-qualified
Vertex model id. Both independent architectures converged on the same findings (A1 `ppid`
caching, A2 `ppid === 1` unreliable under systemd subreapers, B1 loopback-tautology version
check, B2 duplicate getter), and Gemini added a new one (C1 tray/modal disagreement). The
**RECONCILE table** was the decision artifact.

**Phase C — Apply fixes 1–4 (Generate).** `apply fixes` triggered a coordinated edit
across all four+ artifacts: replace cached `ppid` with a boot-captured `bootParentPid` +
live per-request `ppid`, wire the version check into the Electron arm only, reuse
`connectionCount()`, add a reload step. Then `openspec validate`.

**Phase D — Windows interrogation (the pivotal steer).** `and what about windows?` forced
the AI to verify the Job-Object claim (it *holds* — `KILL_ON_JOB_CLOSE` fires even on
`taskkill /F`) but exposed three gaps: a POSIX-only ppid reader that breaks Windows CI,
an overstated "non-issue," and an untested assumption. Fixes W1–W3 followed.

**Phase E — Adapt the model to Windows properly (Research → Fold).** `Is it possible to
adapt the keeper model to windows?` → `MAke research what practicies…` → `Fold Tier 1 and
Tier 2 to this proposal`. The AI first disambiguated "keeper" (an unrelated RPC sidecar
concept in this repo), explained Windows never reparents (so "ppid changed" never fires)
and PID reuse is the real hazard, researched `ps-list`/handle-wait/koffi, and folded a
two-tier `bootParentAlive` design in.

**Phase F — Packaging & jiti safety (close the loop).** `Is it possible to add koffi
delivered binaries in windows` → `check maybe can cause problems with jiti`. The AI grounded
answers in this repo's forge/bundle config (server ships outside asar under bundled Node;
`node-pty` is the proven native-module precedent), added a `1b` packaging task group, and
confirmed the final `The four packaging steps added?` were present.

## 4. Prompts that worked

- **The goal prompt — `doubt review`.** Terse but effective *because a skill backs it*
  (doubt-driven-review). It worked here because the target was in-flight and unwritten.
  Stronger kickoff for a cold reader: *"Run a doubt-driven review on the
  electron-attach-ownership-fixes design before any code is written; verify load-bearing
  claims against source first."*
- **`and what about windows?`** — the single highest-leverage follow-up. Four words that
  flipped a "non-issue" hand-wave into a verified mechanism + documented residual risk +
  a QA step. Bake in: always name the platform/edge you're tempted to skip.
- **`Fold Tier 1 and Tier 2 to this proposal`** — a precise scope directive that turned
  research into artifact edits without re-litigating the analysis.
- **`google-vertex/gemini-3.1-pro-preview`** — after three vague "use vertex gemini"
  tries, the *fully-qualified model id* is what actually let the subagent spawn. Give the
  exact SDK-invocable ref, not a nickname.
- **`check maybe can cause problems with jiti`** — a domain-expert instinct expressed as a
  hedge ("I'm not sure that it plays here"). Effective because it named a concrete risk the
  AI could then verify against a precedent.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Reach for a role-alias model that wasn't SDK-invocable (empty Gemini) | Escalating `use vertex gemini` → `use vertexai gemini as subagent` → the exact `google-vertex/gemini-3.1-pro-preview` id | State the fully-qualified, SDK-invocable model ref up front for cross-model reviews |
| Treat Windows as a "non-issue" and move on | Asking `and what about windows?` explicitly | Make "interrogate every platform you're tempted to skip" a review checklist item |
| Port the POSIX ppid-changed rule verbatim to Windows | `Is it possible to adapt the keeper model to windows?` (which also surfaced a naming clash — "keeper" is an unrelated RPC concept here) | Verify a term isn't already a named repo concept before answering; reframe Windows zombie test as pure parent-liveness |
| Invent a bespoke detector | `MAke research what practicies… maybe some typescript library` | Research existing libs (`ps-list`, koffi handle-wait) + what the repo already ships (`isProcessAlive`) before designing |
| Assume native-module packaging "just works" | `Is it possible to add koffi delivered binaries in windows` + `check … problems with jiti` | Ground native-dep answers in the repo's actual forge/bundle config and an existing precedent (`node-pty`) |
| Leave the fold incomplete | `The four packaging steps added?` | End every fold with an explicit coverage check across all artifacts + `openspec validate` |

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was persisted in this session, but the workflow leaned on and
demonstrated two reusable assets worth naming:

- **`doubt-driven-review` (invoked via "doubt review").** Captures the in-flight
  adversarial check *before* a decision hardens. Effective because it fires at design
  stage on a clean tree — the cheapest point to be wrong — and mandates source-grounding
  before critique. Invoke whenever an irreversible/architectural decision is about to
  stand.
- **The cross-model reconcile pattern (self + different-architecture subagent).** Hand a
  second model only ARTIFACT + CONTRACT, withhold your CLAIM and findings, then RECONCILE
  in a table. Effective because agreement between two independent architectures is a much
  stronger signal than one model's confidence.

**Recommend creating:** a project skill *"cross-platform-parent-liveness"* capturing the
Tier-1 (`isProcessAlive`/`process.kill(pid,0)`) vs Tier-2 (koffi `OpenProcess` +
`WaitForSingleObject` handle-wait, PID-reuse-safe) decision, the Windows no-reparenting
+ PID-reuse constraints, and the "native module ships outside asar under bundled Node,
`node-pty` is the precedent" packaging fact. This session re-derived all of it from
scratch.

## 7. Pitfalls & dead ends

- **If a cross-model subagent returns empty output**, the model is likely a role-only
  alias, not SDK-invocable → use the fully-qualified provider id (`google-vertex/…`) or
  fall back to another architecture (GLM worked here).
- **If zombie detection "never fires,"** check whether `ppid` is cached at module load —
  Node's `process.ppid` is itself a cache-on-first-access getter, so even per-request
  reads can be stale. Use a boot-captured `bootParentPid` + a genuinely live ppid read
  (`/proc/self/stat`, `ps -o ppid=`).
- **`ppid === 1` is not a reliable orphan test on Linux** — systemd `--user` subreapers
  and containers reparent to a non-1 PID. Test "parent is dead," not "ppid is 1."
- **Don't port the POSIX "ppid changed" signal to Windows** — Windows never reparents
  orphans (the recorded parent PID dangles), so that clause never fires. Test parent
  liveness directly, and guard against **PID reuse** (Tier-2 handle-wait).
- **grep line numbers go stale mid-session** after edits shift the file — re-grep the
  literal phrase to confirm a stale assertion is actually gone, don't trust old line refs.
- **A stray `modeldescription` / duplicate key** kept creeping into edits — validate and
  remove after each artifact pass.
- **Subshell quoting artifacts** made a coverage `printf` mis-report `0`s — re-run the
  count outside the subshell before concluding content is missing.

## 8. Reproduce it faster — checklist

- [ ] Target an in-flight design on a clean tree; run `doubt review` (doubt-driven-review skill).
- [ ] Grep source for every load-bearing claim (`ppid` caching, `connectionCount()`, Job Object invariants) **before** critiquing.
- [ ] Spawn a different-architecture reviewer with the **fully-qualified model id**; give it ARTIFACT + CONTRACT only; RECONCILE in a table.
- [ ] Classify findings (🔴/🟡/new), apply across **all** artifacts in one pass, `openspec validate`.
- [ ] Explicitly ask "what about \<the platform you skipped\>?" and verify the mechanism, not the assertion.
- [ ] For a genuinely different platform, research libs + repo-shipped helpers before designing; fold as tiers (baseline + optional identity-safe upgrade).
- [ ] Close on packaging + runtime: confirm native dep ships (extraResource/outside-asar) and check the loader (jiti) against an existing precedent.
- [ ] Verify final coverage across artifacts (re-grep literals, not stale line numbers) and re-run `openspec validate`.

**Key inputs to have ready:** the OpenSpec change dir (`openspec/changes/electron-attach-ownership-fixes/`), a working Vertex/GLM subagent model ref, the repo's forge/bundle config (`forge.config.ts`, `scripts/bundle-server.mjs`), and `platform/process.ts` (`isProcessAlive`).

**Final artifacts produced:** `proposal.md`, `design.md`, `tasks.md` (incl. the `1b` packaging group + Windows QA step), `specs/electron-shell/spec.md`, `specs/dashboard-starter-identity/spec.md` — all validating.

---

_Generated from session `019f2d47-1d66-725e-89f5-8efa02155bc2` · `pi-agent-dashboard` · 2026-07-04. Source extract: session-to-guideline deterministic facts sheet._
