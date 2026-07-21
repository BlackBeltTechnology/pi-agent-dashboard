# How we did it: Harden Security — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** with a security intent: "security-hardening
came later, so the whole system is unaudited — rescan it." The literal first prompt
was the `openspec-explore` skill banner (a thinking stance, not an implementation
order). The *real* objective, once the AI grounded itself, was: **run a disciplined,
full-system STRIDE security audit of a 30-package / ~400-spec monorepo, capture every
finding as durable OpenSpec artifacts, then turn the highest-leverage fix into an
implementation-ready change** — all without writing a single line of remediation code
(explore-mode rule: investigate + capture, never fix).

The premise itself was wrong, and catching that was the first win: the system already
had a **mature, layered trust model** (`localhost-guard`, `bearer-auth`, `ws-ticket`,
`path-containment`, CORS allowlist, device pairing). The audit's job was not "find an
unguarded system" but "find where the guards are applied **non-uniformly**."

## 2. TL;DR playbook

1. **Enter explore mode** and load the `security-hardening` skill first — read what
   STRIDE/OWASP surface it actually checks before theorizing.
2. **Map the real terrain before scanning.** Grep the exec/auth/fetch surface across
   *all* packages and read the existing guards. Ask the single reframing question:
   *is auth actually enforced, or is this a localhost-trust model?* That one fact sets
   the whole threat model.
3. **Register an OpenSpec audit change** (`security-boundary-audit`) as the findings
   register — one durable artifact, exact finding format.
4. **Parallelize the sweep.** Split the attack surface into ~7 clusters (core auth,
   dangerous caps, plugin routes, bridge, electron, client, aux tools) and spawn one
   `security-auditor` subagent per cluster in **waves**, each running STRIDE against a
   precise file list and returning findings in the register's format.
5. **Synthesize for the structural pattern, not the bug list.** Look for the *one
   finding behind most findings* (here: guards protect the CORE, not the EDGES).
6. **Verify before believing.** Run read-only checks (V1–V5) to confirm/downgrade/
   upgrade, then **line-verify each High with a concrete repro payload** — no inferred
   severities.
7. **Group remediation by leverage, not one-per-finding.** Write proposal + specs
   delta + tasks for each change; `openspec validate --strict` every one.
8. **Commit surgically** — stage only your own change dirs, leave pre-existing
   working-tree changes untouched.
9. **Run `plan-proposal` on the top change** and let `doubt-driven-review` spawn
   **cross-model** reviewers — they catch design defects (app-brick risk) the author
   model cannot see in its own work.

## 3. How the collaboration unfolded

**Phase 1 — Ground & reframe (explore).** The AI refused to theorize first. It loaded
the `security-hardening` skill, ran a scripted `secscan.sh` to enumerate the
exec/auth/fetch surface across all packages, and read the existing guard files. It
surfaced the reframe — *this is a localhost/LAN-balanced trust model with a real,
mature core* — and got the human's implicit buy-in to drain the ocean "in a
disciplined, parallel way rather than one linear crawl." **Why it worked:** grounding
before theorizing turned a vague "rescan everything" into a bounded, evidence-backed
plan and killed a false premise early.

**Phase 2 — Parallel STRIDE sweep (waves of subagents).** The AI scaffolded the
`security-boundary-audit` OpenSpec change as a findings register, then launched
`security-auditor` subagents in two waves across 7 clusters (A core auth → G aux
tools). Each returned findings in the register's exact format. **Why it worked:**
seven isolated STRIDE passes covered a 400-spec surface in parallel without polluting
the main context; the register gave every subagent one output schema.

**Phase 3 — Synthesize the structural theme.** 9 High + ~16 Medium findings converged
from independent clusters onto **one asymmetry**: `networkGuard` protects core routes
but plugin/provider-auth routes and the bridge WS were unguarded, and the default
deployment runs with the OAuth hook OFF. **Decision point:** the human let the AI
group fixes by that leverage rather than per-finding.

**Phase 4 — Verify, don't infer.** The AI ran V1–V5 read-only checks (config perms,
tunnel port exposure, Electron sandbox version, asciidoc passthrough, npm audit),
which **downgraded one High** (bridge WS is on `piPort`, not tunneled), **upgraded a
Low** (config.json HMAC secret written with no chmod → local JWT forgery), and
**confirmed the rest**. It then line-verified all 7 confirmed Highs with concrete repro
payloads (git-checkout `execSync` injection, automation create+run RCE, markdown XSS
via disabled `urlTransform`, Electron `openExternal`, shared preload). **Why it
worked:** every severity became grounded and reproducible, not asserted.

**Phase 5 — Plan remediation.** Seven `--strict`-validated OpenSpec changes: 4 for the
Highs, 3 batching the Mediums by subsystem. Committed surgically (24 files, own 8 dirs
only). **Decision points:** `draft` → the High trio; `B2/B3` → the Electron change;
`Batch the remaining Mediums` → the three subsystem changes; `commit`.

**Phase 6 — Doubt-driven planning (`plan-proposal`).** On the top change
(`add-universal-network-guard`) the AI wrote `design.md`, then ran
`doubt-driven-review` with **two cross-model** reviewers (GLM + DeepSeek). They
**independently converged** that the original "deny-all + enumerate a public allowlist"
design would **brick the app** (static assets are hashed files rooted at `/`; the SPA
fallback fires after `onRequest`; `/v1/*` proxy gate never sets `isAuthenticated`; the
model-proxy second port is a separate Fastify instance). The design **pivoted** to a
namespace-scoped guard; `scenario-design` folded a test manifest into `tasks.md`;
committed at the worktree boundary.

## 4. Prompts that worked

- **The goal prompt (explore-mode banner + security intent).** Effective because it set
  a *stance* (investigate, capture, never fix) that kept the AI from jumping to code and
  let it reframe the premise. A stronger explicit kickoff for a future operator:
  *"Enter explore mode. Run a full-system STRIDE audit with the security-hardening
  skill. First map the real attack surface and tell me if auth is actually enforced
  before you plan the sweep. Capture findings as an OpenSpec audit change — no fixes."*
- **`keep going`** (high-leverage) — unlocked the deep-dive verification phase; the AI
  interpreted it correctly as "stay in explore mode and line-verify the confirmed
  Highs." Works because the plan was already legible.
- **`draft`, `B2/B3`, `Batch the remaining Mediums`** — three tiny prompts that each
  triggered a full proposal+specs+tasks change. Effective *because* the AI had already
  laid out the change map, so a two-token pick was unambiguous.
- **`commit`** — trusted the AI to stage surgically; it correctly excluded three
  pre-existing unrelated working-tree changes.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Pause after the audit synthesis, waiting for direction | `keep going` | State up front: "after each phase, continue autonomously through verify → plan; only stop for scope decisions." |
| Present the full change map and wait to be told which to build | `draft`, `B2/B3`, `Batch the remaining Mediums` | Pre-authorize batching: "draft all High changes, then batch Mediums by subsystem — don't ask per change." |
| Wait for explicit commit permission | `commit` | Say "commit each coherent unit as you finish it, surgical staging only." |
| Stop at planning one change | supplying the `plan-proposal` skill | Name the follow-through: "when the audit is committed, run plan-proposal on the highest-leverage change." |

The steering here was almost entirely **throughput unlocks** ("keep going", "draft",
"commit") rather than corrections — a sign the AI's plan was already right. The one
place real correction mattered came from the AI itself invoking cross-model
`doubt-driven-review`, which caught the app-brick design defect a human skimming the
proposal would likely have missed.

## 6. Skills, tools & memory created — and why they're effective

- **`security-hardening` skill (invoked, not created).** The STRIDE/OWASP checklist
  that every `security-auditor` subagent ran against its cluster. Effective because it
  gave 7 parallel agents *one consistent methodology and output format*, so findings
  merged cleanly into the register.
- **`security-auditor` subagent × 7 (spawned).** One per attack-surface cluster.
  Effective: isolates each STRIDE pass in its own context, runs them in parallel waves,
  and keeps the 400-spec surface out of the main session's memory.
- **`doubt-driven-review` with cross-model reviewers (GLM + DeepSeek).** The single
  highest-value move. A model **cannot reliably review its own design** — same
  architecture, same blind spots. Two *different-architecture* reviewers independently
  converged on the same app-brick defect. When a design has irreversible/lock-out risk
  (auth boundary, migration, public API), cross-model doubt-review earns its cost.
- **Project memory saved (security architecture insight).** Captured the durable fact
  that the auth guard is applied **non-uniformly** (`networkGuard` per-route on core
  only; plugin/provider routes uncovered). Effective because it's the load-bearing
  architectural truth behind most findings — future sessions inherit it without
  re-deriving. *Note:* project memory was near-full (4949/5000), so the AI leaned on the
  on-disk audit change as the durable record rather than churning entries.

**Skill worth creating** if this recurs: a `security-audit-sweep` skill that scaffolds
the register change, defines the cluster split, and spawns the `security-auditor` wave
in one shot — this session did all of that by hand.

## 7. Pitfalls & dead ends

- **OpenSpec `--strict` "first-line SHALL" quirk.** The validator checks the
  *requirement's first line* for SHALL/MUST; if SHALL wraps onto line 2 it fails with a
  misleading error. **If you hit it:** reword so SHALL/MUST sits on the requirement's
  first line. This bit the session ~4 times.
- **"Validation error" on a fresh proposal is expected.** `openspec validate` flags a
  change that has a `proposal.md` but no `specs/` delta + `tasks.md` yet — that's not a
  bug, those are the *next* artifacts.
- **`/reload` red herring.** A grep for `/reload` matched prompt *strings*, not a route;
  the real route is `POST /api/resources/reload` (already under the guarded `/api`
  prefix). **Lesson:** verify a "dangerous route outside the guard" against the actual
  registrar before acting on the grep hit.
- **The naive allowlist fix was itself a hole.** "Just allowlist `/v1/`" would bypass
  the proxy auth gate. Deny-by-default guard design needs the auth gate to *set*
  `isAuthenticated`, not the guard to *exempt* the path.
- **Don't commit the whole working tree.** Three unrelated changes
  (`groups.json`, `package-lock.json`, `bundle-python-runtime/`) sat in the tree from
  other work — the AI staged only its 8 security dirs. Always diff `git status` before
  `git add`.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- Repo with the `security-hardening` skill + `security-auditor` subagent available.
- `openspec` CLI on PATH; `plan-proposal` + `doubt-driven-review` + `scenario-design`
  skills present.
- Cross-architecture review roles configured (`@propose-review-1` GLM,
  `@propose-review-2` DeepSeek).

**Steps:**
- [ ] Enter explore mode; load `security-hardening`; grep exec/auth/fetch surface.
- [ ] Answer the reframe question: is auth enforced, or localhost-trust? Correct the
      premise before scanning.
- [ ] Scaffold `security-boundary-audit` OpenSpec change as the findings register.
- [ ] Split surface into ~7 clusters; spawn `security-auditor` per cluster in waves.
- [ ] Synthesize for the *one structural pattern* behind most findings.
- [ ] Run V-checks (perms, tunnel exposure, versions, audit); line-verify each High
      with a repro payload — no inferred severities.
- [ ] Write remediation changes grouped by leverage; `openspec validate --strict` each.
- [ ] Commit surgically (own dirs only; diff `git status` first).
- [ ] `plan-proposal` on the top change; let `doubt-driven-review` run **two
      cross-model** cycles; pivot the design on convergent findings; fold scenarios;
      commit at the worktree boundary.

**Final artifacts produced (session `019f6886`):**
- `openspec/changes/security-boundary-audit/` — findings register + V1–V5 + 5 line-cited deep-dives.
- 7 `--strict`-valid remediation changes: `add-universal-network-guard`,
  `sanitize-untrusted-rendered-content`, `fix-git-checkout-command-injection`,
  `harden-electron-renderer-boundary`, `harden-server-capability-bounds`,
  `harden-untrusted-content-ingestion`, `harden-trust-and-credential-boundaries`.
- `add-universal-network-guard/design.md` + `test-plan.md` (post-doubt-review pivot).
- Commits `7ea385671` (audit + plan) and `ac2344968` (planned change).

---

_Generated from session `019f6886-2823-7855-9fbc-7852a3ff4bdc` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-17. Source extract: `/tmp/session_facts.md`._
