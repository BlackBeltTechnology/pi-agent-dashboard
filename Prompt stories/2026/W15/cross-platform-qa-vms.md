---
session: f0bd58b1
week: 2026/W15
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (14 user prompts)"
upgrade_status: pending
openspec_changes: [cross-platform-qa-vms]
proposal_excerpt: "pi-dashboard has platform-specific behavior (node-pty compilation, PTY spawning, path handling, native dependencies) that can only be validated on real operating systems. Currently there is no systematic way to verify…"
---

# How we did it: Cross-platform QA VMs — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened in explore mode with:

> `/skill:openspec-explore` — "I would like to make QA tests for MacOS / Linux / Windows
> platform. I would like use vm-s to achive that. I would like that be able to test
> reproducable in vms to install from a clean state."

The *real* objective, once steering clarified it: build a **rebuildable, clean-state,
true-OS QA harness** for pi-dashboard — reproducible VMs (not containers) that a human
can also drive by hand, covering the platform-specific surfaces (node-pty compilation,
PTY spawning, path handling, native deps) that can only be validated on real operating
systems. The result: a Packer + VMware Fusion image-building + clone-test-discard
system under `qa/`, delivered through the full OpenSpec change lifecycle.

## 2. TL;DR playbook

1. Start in **explore mode** (`/skill:openspec-explore`) — do NOT jump to a proposal.
   Let the AI surface the decision space (containers vs true-OS, snapshots, arch split).
2. Answer the AI's framing questions tersely and concretely: hardware inventory
   (`x86 desktop + M1 laptop`), tool choice (`VMware`), scope (`Ubuntu`, `prior is enough`).
   Each short answer collapses a whole branch of the design.
3. Say **"create proposal, it is local now"** once the shape is settled — this locks the
   explore output into `openspec/changes/<name>/proposal.md`.
4. `/opsx:ff` (fast-forward) to generate design → specs → tasks in one pass, ready to apply.
5. `/opsx:apply` and let the AI work the task list top-to-bottom; it scaffolds `qa/`,
   Packer templates (5 targets), provision scripts, lifecycle scripts, and a test suite.
6. `commit changes` — tell it to stage ONLY the change's files (there were unrelated
   staged changes; it correctly isolated `qa/` + the openspec change + AGENTS.md).
7. `/opsx:verify` — this is where the real bugs surfaced (stdout pollution breaking
   `$(...)` capture, missing Windows test scripts). Say **"fix"** and let it resolve them.
8. `/opsx:archive` — syncs the 3 delta specs into main specs and moves the change to
   `archive/`, then `commit changes`.

## 3. How the collaboration unfolded

**Phase A — Explore / Discovery (prompts 1–6).** The AI drew ASCII decision maps
(image lifecycle, hardware-to-VM matrix) and asked pointed questions one thread at a
time: what exactly is under test, is the Mac Apple Silicon, which hypervisor. The human
fed back short facts across several turns (`x86 desktop and M1 laptop` → then corrected
`the x86 also macOS` → `both real Macs`). *Why it worked:* the AI treated each answer as
a constraint that pruned the matrix, converging on "5 images, all VMware Fusion, all
Packer-built" without over-designing.

**Phase B — Proposal (prompt 7).** "create proposal, it is local now" turned the
explore consensus into `proposal.md` — platform matrix, directory layout, Linux-first
build order.

**Phase C — Fast-forward artifacts (prompt 8).** `/opsx:ff` generated `design.md`
(7 decisions), 3 delta specs (`vm-image-building`, `vm-lifecycle`, `test-execution`),
and `tasks.md` (10 groups / ~44 tasks) — apply-ready.

**Phase D — Apply / Generate (prompt 9).** `/opsx:apply` walked the tasks: 42 `write`
+ 26 `edit` calls produced the whole `qa/` tree — Makefile, README, Packer HCL for 5
targets, cloud-init/autounattend configs, provision scripts (bash + PowerShell), and
lifecycle + test scripts. Verification-only tasks (needing a real ISO + VMware) were
marked as manual steps rather than faked.

**Phase E — Commit hygiene (prompt 10).** Told to commit, the AI noticed unrelated
staged changes (docker-packaging, editor, provider-auth) and `git reset` + re-added only
`qa/` + the openspec change + AGENTS.md — one clean commit `a80a720`.

**Phase F — Verify + fix (prompts 11–12).** `/opsx:verify` did a systematic pass and
found real defects (see §7). "fix" resolved all criticals; commit `3aab66e`.

**Phase G — Archive (prompts 13–14).** `/opsx:archive` synced the 3 delta specs into
`openspec/specs/` and moved the change under `archive/2026-04-20-…`; commit `9510702`.

## 4. Prompts that worked

- **Goal prompt** (`/skill:openspec-explore` + the plain-language ask). Effective
  because it entered *explore* first — deferring the proposal until the design space
  was mapped, instead of committing to an architecture blind.
- **High-leverage terse answers:** `"1. Option B  2. Ubuntu  3. Prior is enough"` and
  `"both real Macs"`. Each one-liner eliminated an entire hypervisor/arch branch. When
  the AI lays out numbered options, answering by number is the fastest possible steering.
- **"create proposal, it is local now"** — a clear commit-point signal that the
  exploration was done and the output should be persisted.
- **"fix"** after `/opsx:verify` — trusting the verify report as the work list. The
  report *was* the spec for the fix pass, so no elaboration was needed.
- **Weak-prompt rewrite:** the mid-explore hardware clarifications came in as three
  separate corrections (`the x86 also macOS`, `x86 macOS is running on intel hardware
  and M1 laptop`, `both real Macs`). Next time state the full inventory once:
  *"Two real Macs: an Intel Mac desktop and an M1 laptop; no non-Apple x86 hardware."*

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume a single machine / one arch | "I have x86 desktop machine and M1 laptop" | State the full hardware inventory in prompt 1 |
| Read "x86 desktop" as non-Apple x86 (unlocker territory) | "the x86 also macOS" → "both real Macs" | Say "both are genuine Macs" up front — avoids the hackintosh detour |
| Consider containers/generic snapshots | "I would like true OS testing" + "snapshot rebuildable" | State "true-OS VMs, rebuildable from ISO" as a hard constraint |
| Over-scope OS/version coverage | "Ubuntu", "Prior is enough" | Name the exact distro + "one version is enough" early |
| Mark manual-only verify tasks vaguely | (AI self-corrected) explicitly labeled them "manual verification needed" | Ask it to tag hardware-dependent tasks as manual in tasks.md |
| Stage unrelated pending changes on commit | "commit changes" (AI isolated qa/ itself) | Say "commit ONLY this change's files" to be safe |

## 6. Skills, tools & memory created — and why they're effective

No new pi skill or memory was created this session — the work rode entirely on the
existing **OpenSpec lifecycle skills** (`openspec-explore` → `-ff` → `-apply` →
`-verify` → `-archive`). That chain *is* the reusable asset here:

- **`openspec-explore`** — front-loads the design-space mapping so the proposal isn't
  guesswork. Invoke it whenever the "how" is genuinely open (infra choices, tool
  selection), not just the "what".
- **`/opsx:ff`** — collapses design+specs+tasks generation into one apply-ready pass;
  use it once the proposal shape is agreed and you don't need to review each artifact
  interactively.
- **`/opsx:verify`** — the highest-value step: it caught contract bugs (stdout
  pollution, missing test scripts) that "44/44 tasks complete" hid. Always run it before
  archive; treat its report as the fix work list.

*Worth creating:* a small **project skill for the `qa/` harness** ("how to build a base
image and run the clone-test-discard cycle") would make the Packer/VMware workflow
reproducible for the next operator without re-reading `qa/README.md`.

## 7. Pitfalls & dead ends

- **stdout pollution breaks `$(...)` capture.** `vm-clone.sh` / `vm-wait-ssh.sh`
  `echo`'d status lines to stdout while also returning the vmx path / IP. Consumed via
  command substitution in `run-test.sh`, the captured value became multi-line garbage.
  *Fix:* send ALL log output to stderr; put only the single return value on stdout.
- **"All tasks complete" ≠ correct.** 44/44 tasks were checked, yet verify found the
  Windows PowerShell suite had only `01-install.ps1` (02–05 missing → silent passes) and
  a nonsense placeholder password hash in `user-data`. *Lesson:* run `/opsx:verify`; a
  checkbox is not coverage.
- **Placeholder `REPLACE_WITH_*` var values give cryptic Packer errors.** Fixed by a
  Makefile preflight that greps the target's var file (and `user-data`) and fails fast
  with line numbers.
- **`openspec change new` is the wrong invocation.** The first attempt failed; the
  correct command is `openspec new change <name>`.
- **Unrelated changes were already staged.** On commit, `git add -A` would have swept in
  docker-packaging/editor/provider-auth work; a `git reset` + targeted `git add qa/
  openspec/… AGENTS.md` kept the commit clean.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** hardware inventory (which real machines / arches), chosen
hypervisor (VMware Fusion here), target OS list + versions, the ISOs (builds need them),
`openspec` CLI on PATH.

**Steps:**
1. `/skill:openspec-explore` + one-paragraph ask stating *true-OS VMs, rebuildable,
   hand-drivable*.
2. Answer framing questions by number / with terse facts; give the full hardware
   inventory once.
3. "create proposal, it is local now".
4. `/opsx:ff <change-name>` → design + specs + tasks.
5. `/opsx:apply <change-name>` → let it scaffold `qa/`.
6. `commit changes` (only this change's files).
7. `/opsx:verify <change-name>` → "fix" → `commit changes`.
8. `/opsx:archive <change-name>` (syncs delta specs) → `commit changes`.

**Artifacts produced:** `openspec/changes/cross-platform-qa-vms/` (proposal, design,
3 delta specs, tasks) → archived to `openspec/changes/archive/2026-04-20-cross-platform-qa-vms/`;
`qa/` harness (Makefile, README, 5 Packer templates, provision + lifecycle + test
scripts, cloud-init/autounattend configs); 3 new main specs under `openspec/specs/`.
Commits: `a80a720` (feat), `3aab66e` (fix), `9510702` (archive/sync).

---

_Generated from session `f0bd58b1` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-11. Source extract: session-to-guideline facts sheet._
