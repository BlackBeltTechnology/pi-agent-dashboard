---
session: 019ec015
week: 2026/W24
type: planning
model: "@fast"
premium: true
premium_reason: "heavy steering (5 user prompts)"
upgrade_status: pending
openspec_changes: [docker-test-harness, docker-packaging]
proposal_excerpt: "Testing pi-dashboard on the host collides with the real, running dashboard four ways:"
---

# How we did it: an isolated Docker test harness for pi-dashboard — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened in **explore mode** (`openspec-explore` skill) — "think, don't
implement." The real objective, once it surfaced in conversation: *testing the
pi-dashboard on the host machine collides with the developer's own running dashboard
in four ways* (the single-dashboard-per-home lock, `~/.pi` pollution, port clashes,
mDNS discovery noise). The operator wanted a **disposable, fully-isolated dashboard**
to do manual browser QA against — without a VM, and without fighting the live
instance. The design also had to reconcile against an existing, substantial
`docker-packaging` change proposal already in the repo.

## 2. TL;DR playbook

1. Enter explore mode: invoke the `openspec-explore` skill. State up front it is a
   *thinking* stance — capture design in OpenSpec artifacts, write **no** code.
2. Find prior art first: scan `openspec/changes/` for an existing docker proposal —
   here `docker-packaging` already existed and covered ~80% of the base image.
3. Ground the pain in real code: read the server's mDNS advertise path and the
   home-lock chain (`home-lock.d.ts` → `home-lock-release.ts` → `server-pid.ts`).
4. Find the structural insight: the lock is keyed off `os.homedir()` → `~/.pi/dashboard`,
   so an **isolated container `$HOME`** dissolves three of four pains *for free*, the
   fourth via the existing `PI_DASHBOARD_NO_MDNS=1` flag.
5. Surface the real design fork with a diagram (baked-in image vs bind-mounted source)
   and let the human pick — they chose **baked-in** ("test what ships") + subsystems off.
6. Fold in each steering turn as a design decision: **path-identical mounts** (host CWD →
   same absolute path in container) and **RW tmpfs overlay** (host files provably untouched).
7. Scaffold `docker-test-harness` as a thin overlay change: `proposal.md` + `design.md` +
   `tasks.md` + `specs/<cap>/spec.md`. Validate with `openspec validate --strict`.
8. Reconcile the two changes so they don't contradict, then `git commit` the artifacts only.

## 3. How the collaboration unfolded

**Discovery — map the prior art (10:29–10:31).** The AI scanned `openspec/changes/`,
found `docker-packaging` (a strong, well-designed base-image proposal), and read its
proposal/design in full. It also read the *real* server code to confirm the collision
source — the dashboard advertises over mDNS and holds a per-`$HOME` pidfile/lockfile.
*Why it worked:* grounding the abstract "four pains" in exact code lines
(`home-lock.d.ts`, the mDNS advertise call) turned a vague complaint into a precise,
solvable model.

**The reframe — isolation is structural (10:36).** The key discovery: the lock is
keyed entirely off `os.homedir()`, with no port- or LAN-based component. An isolated
container `$HOME=/home/pi` therefore gives a *separate lock namespace* — three of the
four pains dissolve with zero code change, the fourth via an existing flag. The AI drew
a host-vs-container ASCII diagram showing the two `dashboard.pid` files never sharing an
inode. *Decision point:* this reframed the whole problem from "build isolation" to
"inherit isolation, wire the knobs."

**The design fork (10:40–10:55).** The AI presented the one decision that drives
everything — **baked-in image** (test released code, slow rebuild loop, true clean-install
QA) vs **bind-mounted source** (fast dev loop) — as a side-by-side diagram, and let the
human choose. Baked-in won. Then two steering turns (below) added path-identical mounting
and the RW-overlay isolation mechanism, each folded in with its own diagram and a note on
where it *intentionally diverges* from `docker-packaging`.

**Generate + reconcile (10:56–11:34).** The AI confirmed OpenSpec conventions
(`## ADDED Requirements` → `### Requirement:` SHALL → `#### Scenario:` WHEN/THEN),
scaffolded the four `docker-test-harness` artifacts, and validated `--strict` (exit 0).
When steering #2 changed `docker-packaging` too, it edited all four of *that* change's
artifacts and then **corrected a contradiction** it had itself introduced (the harness
claimed path-parity "diverges" from packaging — but packaging now also used path-parity).

**Land it (11:42–11:47).** Added reference `up.sh` + seeder sketches to the design,
flagged a subtle first-run-gate correctness bug (`length === 0` can't tell "never seeded"
from "user unpinned all" → persist a `pinSeeded` marker), re-validated, and committed the
OpenSpec artifacts only (`c971edf4` on `develop`) — no source touched, consistent with
explore mode.

## 4. Prompts that worked

- **The goal prompt** — invoking `openspec-explore` set the *stance* (think, capture in
  artifacts, never implement). Effective because it kept a 1h+ design session from
  prematurely writing Dockerfiles; the output is reviewable spec, not half-built code.
- **"same directory structure as in host machine … mounted as /Users/robson/Project/…"**
  (steering #1) — a short, concrete instruction that unlocked the entire **path-parity**
  design. The reason given ("keep log messages clean") was the real requirement.
- **"yes"** (steering #3) — a high-leverage one-word unlock: it accepted the AI's proposed
  RW-overlay mechanism, letting the design converge without re-litigating.
- **"commit"** (steering #4) — closed the loop. Because the AI had stayed in explore mode,
  this safely committed *artifacts only*.

*Stronger rewrite of the goal:* pair the `openspec-explore` invocation with the concrete
pain up front — "I can't run a second dashboard on my host because of the per-`$HOME` lock,
port clashes, `~/.pi` pollution, and mDNS noise; design an isolated container QA harness"
— to reach the structural insight faster.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume the deployment mount convention (`/workspaces/<name>`) | "mount CWD to the *same* absolute path as on the host" (steering #1) | State the **path-parity** requirement in the goal prompt — it changes the mount + working_dir + log semantics |
| Scope the design to the *test* harness only | "the standalone `docker-packaging` image should also mount *multiple* host dirs and auto-pin them" (steering #2) | Name both the test AND deploy image up front if both need the mount change |
| Let the two changes silently contradict (harness said path-parity "diverges" from packaging, after packaging adopted it too) | (self-caught after re-validation) | Re-read cross-references between sibling changes after any shared-decision edit |
| Leave a naive first-run gate implicit | (AI flagged it proactively) | Persist a `pinSeeded: true` marker — `pinnedDirectories.length === 0` can't distinguish "never seeded" from "user unpinned everything" |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was a pure explore/design pass.
The reusable asset is the **pattern itself**, worth capturing:

- **Structural-isolation-via-container-`$HOME`** — before building isolation machinery,
  check whether the resource under contention is keyed off `os.homedir()` / a per-`$HOME`
  pidfile. If so, an isolated container home *inherits* isolation for free. This turned a
  large task into a small one.
- **Diagram-driven design forks** — presenting a binary decision (baked-in vs bind-mount,
  path-parity vs `/workspaces/`) as a side-by-side ASCII/Mermaid diagram and letting the
  human pick one word ("baked-in", "yes") is a high-throughput way to converge a design.
- If this workflow recurs, a `docker-isolated-qa-harness` skill capturing the
  `PI_DASHBOARD_NO_MDNS=1` + `18000/18999` ports + `127.0.0.1` bind + tmpfs-overlay recipe
  would be worth creating.

## 7. Pitfalls & dead ends

- **`ctx_batch_execute` tool-call format errors (3×)** — early tool calls failed on format;
  the AI retried correctly. If a batch tool errors on shape, re-issue rather than debugging.
- **Stray `items` field in `edit` calls (2×)** — two edits failed by including an extraneous
  `items` field; retrying without it worked. Keep edit payloads minimal.
- **Self-introduced contradiction between sibling changes** — editing `docker-packaging` to
  adopt path-parity broke a "diverges from packaging" note in `docker-test-harness`. Always
  re-scan cross-references after a shared-decision edit; `openspec validate` won't catch a
  *semantic* contradiction, only structural.
- **Naive first-run pin gate** — `pinnedDirectories.length === 0` is ambiguous; use a
  persisted `pinSeeded` marker instead.

## 8. Reproduce it faster — checklist

- [ ] Invoke `openspec-explore`; state the stance (think, capture artifacts, no code).
- [ ] `grep` `openspec/changes/` for an existing docker proposal — reuse, don't duplicate.
- [ ] Confirm the collision is per-`$HOME` (read the home-lock chain + mDNS advertise path).
- [ ] Choose baked-in image (test-what-ships) + subsystems off (`PI_DASHBOARD_NO_MDNS=1`,
      ports `18000/18999`, `PI_GATEWAY_BIND=127.0.0.1`, `TUNNEL_ENABLED=false`, tmpfs state).
- [ ] Specify **path-identical mount** (`${HOST_CWD}:${HOST_CWD}`, `working_dir=${HOST_CWD}`)
      + **RW tmpfs overlay** (`cap_add: SYS_ADMIN`, plus a `TEST_COPY_MODE=1` no-cap fallback).
- [ ] Scaffold `proposal.md` + `design.md` + `tasks.md` + `specs/<cap>/spec.md`.
- [ ] `openspec validate <change> --strict` (expect exit 0) for **every** touched change.
- [ ] Re-check cross-references between sibling changes; commit artifacts only.

**Inputs needed:** the existing `docker-packaging` change; read access to the server's
home-lock + mDNS code; `openspec` CLI (1.3.1). **Artifacts produced:**
`openspec/changes/docker-test-harness/{proposal,design,tasks}.md` +
`specs/docker-test-harness/spec.md`; edits across all four `docker-packaging` artifacts;
commit `c971edf4` on `develop`.

---

_Generated from session `019ec015-e84f-7384-a25c-20bb9e867cf0` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-13. Source extract: deterministic facts sheet (session-to-guideline)._
