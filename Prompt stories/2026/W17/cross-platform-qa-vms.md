---
session: 019da8c3
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

The user opened in explore mode with:

> `/skill:openspec-explore`
> "I would like to make QA tests for MacOS / Linux / Windows platform. I would like use vm-s to achive that. I would like that be able to test reproducable in vms to install from a clean state."

The *real* objective, once the steering turns clarified it: build a **rebuildable,
snapshot-based VM test harness** that installs pi-dashboard from a genuinely clean
OS state on **five real targets** (Ubuntu x86/ARM, Windows x86, macOS x86/ARM), can
be **driven by hand or automated**, uses **true OS installs** (not containers), and
runs on the user's own hardware — an Intel Mac desktop and an M1 Mac laptop, both
with VMware Fusion. The deliverable is a self-contained `qa/` directory plus a
complete OpenSpec change (proposal → design → specs → tasks → archive).

## 2. TL;DR playbook

1. **Kick off in explore mode** with the raw goal: `/skill:openspec-explore` + one
   sentence of intent. Let the AI ask the constraint questions.
2. **Answer the three foundational axes fast**: snapshot vs. fresh (→ rebuildable
   snapshots), manual + automated (→ both), containers vs. true OS (→ true OS).
3. **State your exact hardware** (arch matters most): "x86 Intel Mac desktop + M1
   Mac laptop, both real Macs, VMware Fusion." This collapses the design instantly —
   no unlocker hacks, native-speed guests everywhere.
4. **Pick the toolchain the AI proposes**: Packer `vmware-iso`/`vmware-vmx` builders,
   clone → boot → SSH → `npm install -g` → report, discard.
5. **Say "create proposal, it is local now"** to freeze the plan into
   `openspec/changes/cross-platform-qa-vms/proposal.md`.
6. **Fast-forward the artifacts**: `/opsx:ff` → design.md + 3 delta specs + tasks.md
   in one pass.
7. **Apply**: `/opsx:apply cross-platform-qa-vms` — the AI writes all ~32 files
   (Packer templates, provision scripts, autoinstall configs, lifecycle scripts, test
   suite in bash + PowerShell).
8. **Commit only the change** — tell it to stage `qa/` + the openspec change, not the
   unrelated staged work.
9. **Verify then fix**: `/opsx:verify` surfaces real contract bugs → say `fix` → the
   AI patches them → commit.
10. **Archive + sync**: `/opsx:archive` promotes the 3 delta specs into main specs in
    one atomic step.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (explore mode).** The AI mapped pi-dashboard's install
surfaces (npm global, node-pty native compile, zrok/code-server binaries, Electron,
Docker, runtime behavior) and pulled on threads via ASCII diagrams. *Why it worked:*
it refused to design before pinning the three constraint axes and the hardware arch.
**Decision points:** rebuildable snapshots; manual + automated; true OS; both Macs
real (no hackintosh unlocker path).

**Phase 2 — Design convergence.** Once "both real Macs, VMware Fusion" landed, the
matrix collapsed to 5 images across 2 machines with one toolchain. The AI drew the
final hardware map and the `qa/` tree. *Why it worked:* arch + hypervisor were fixed
before any file was written, so no rework.

**Phase 3 — Proposal + artifacts.** "create proposal, it is local now" froze the
plan. `/opsx:ff` generated design.md (7 decisions), 3 delta specs (18 requirements),
and tasks.md (10 groups / 44 tasks). *Decision point:* Linux-first build order
(easiest → Windows → macOS hardest).

**Phase 4 — Implementation.** `/opsx:apply` walked all 44 tasks, writing 32 files:
Packer templates, provision scripts (nvm/Node, apt/brew/choco, VS Build Tools/Xcode
CLI), cloud-init + autounattend configs, `vmrun` lifecycle scripts, and a 5-test
suite in both bash and PowerShell. Build-dependent tasks were marked "manual
verification needed" honestly rather than faked.

**Phase 5 — Commit hygiene.** The tree had unrelated staged work. The AI reset and
re-staged only `qa/` + the openspec change → clean commit `a80a720` (39 files).

**Phase 6 — Verify → fix → archive.** `/opsx:verify` found genuine bugs (see §7).
`fix` patched them → commit `144301c`. `/opsx:archive` synced 3 delta specs into main
specs atomically → commit `9510702`.

## 4. Prompts that worked

- **The goal prompt** (`/skill:openspec-explore` + one sentence). Effective because
  it entered a thinking-partner mode instead of demanding a plan cold. A stronger
  version would front-load the hardware: *"QA-test pi-dashboard install-from-clean on
  macOS/Linux/Windows using rebuildable VM snapshots; I have an Intel Mac desktop + M1
  laptop, both VMware Fusion; want manual + automated, true OS."* — that one sentence
  would have saved the five hardware-clarification round-trips.
- **"1. … 2. … 3. …" constraint answers.** Terse numbered replies to the AI's numbered
  questions kept momentum and removed ambiguity per-axis.
- **"create proposal, it is local now"** — high-leverage: it ended exploration and
  committed to an artifact without over-negotiating.
- **`fix`** (one word after the verify report) — unlocked all four remediations because
  the verification report had already enumerated them precisely.
- **"commit changes"** — trusted the AI to scope the commit, which it did correctly by
  excluding unrelated staged work.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|---|---|---|
| Ask hardware arch across several turns (Apple Silicon? x86 too? hackintosh?) | Volunteering "x86 is also macOS", "x86 macOS on Intel hardware + M1 laptop", "both real Macs" | Stating exact hardware (arch + hypervisor + real-vs-emulated) in the *first* prompt |
| Keep exploring after the design was clear | "create proposal, it is local now" | Naming the stop condition early ("once the matrix is fixed, write the proposal") |
| Leave build-order/OS choice open | "Option B / Ubuntu / Prior is enough" | Stating distro + build-order preference up front |
| Stage everything for commit | "commit changes" (AI self-corrected to scope) | Asking explicitly for a scoped commit ("only qa/ and the openspec change") |

Scope was true-OS, five targets, both manual + automated — the user held that quality
bar throughout and the AI matched it (real password hash, real preflight checks, no
faked tests).

## 6. Skills, tools & memory created — and why they're effective

No new skill or memory was created this session — the workflow rode entirely on the
existing OpenSpec skill chain (`openspec-explore` → `openspec-ff` → `openspec-apply`
→ `openspec-verify` → `openspec-archive`). That chain *is* the reusable asset: it took
a vague explore-mode ask to a 39-file committed, verified, archived, spec-synced
change.

**Recommended skill to create:** a project-scoped **`qa-vm-harness`** skill capturing
the Packer + VMware Fusion + `vmrun` clone-boot-SSH-test-discard pattern, the 5-target
matrix, and the stdout-hygiene contract for scripts consumed via `$(...)`. Invoke it
next time cross-platform install testing is needed, so the design phase is skipped
entirely.

## 7. Pitfalls & dead ends

- **`openspec change new` failed** — the correct verb is `openspec new change`. If
  `change new` errors, run `openspec --help` / `openspec new --help` and use
  `openspec new change <name>`.
- **Scripts polluting stdout (C1).** `vm-clone.sh` / `vm-wait-ssh.sh` echoed status
  ("Cloning…", "VM IP:") to stdout, but they're captured via `CLONE_VMX=$(...)` /
  `VM_IP=$(...)` in `run-test.sh`. Multi-line garbage broke SSH/Packer. **Fix:** send
  all log output to **stderr**; keep only the vmx path / IP on stdout. If a script's
  output is captured by command substitution, log to stderr — always.
- **Silent-pass test suite (C2).** Windows had only `01-install.ps1`; 02–05 were
  missing, so the runner passed without testing. **Fix:** author all five PS scripts
  and make `run-all.ps1` exit non-zero on SKIP.
- **Placeholder var values (W1).** `REPLACE_WITH_*` in Packer var files gave cryptic
  build errors. **Fix:** a Makefile preflight greps the target's var file (and Linux
  `user-data`) for placeholders and fails fast with line numbers.
- **Nonsense password hash (S2).** `user-data` shipped a placeholder string. **Fix:**
  `openssl passwd -6 -salt <salt> qa` for a real SHA-512 crypt.
- **Unrelated staged files.** The working tree had other staged changes; committing
  blindly would have mixed them in. **Fix:** `git reset HEAD` then stage only the
  intended paths.
- **Proposal schema warning (non-blocking).** Archive flagged `proposal.md` missing
  `## Why` / `## What Changes`. Harmless here, but include those sections when using
  the newer proposal schema.

## 8. Reproduce it faster — checklist

**Inputs to have ready:**
- Hardware inventory with **arch + hypervisor** per machine (e.g. Intel Mac + M1 Mac,
  both VMware Fusion).
- OS ISOs (Ubuntu 24.04 x86/ARM, Windows 11) and macOS installer access.
- VMware Fusion (free for personal use) + Packer + `vmrun` on PATH.

**Steps:**
1. `/skill:openspec-explore` with goal **and** hardware in the first prompt.
2. Confirm the 3 axes (snapshot-rebuildable / manual+auto / true OS) and build order.
3. "create proposal, it is local now" → `/opsx:ff` for design + specs + tasks.
4. `/opsx:apply <change>` → let it write the `qa/` tree.
5. Stage only `qa/` + the openspec change → commit.
6. `/opsx:verify <change>` → `fix` → commit.
7. `/opsx:archive <change>` → syncs delta specs into main specs.

**Final artifacts produced:**
- `qa/` — Makefile, README, Packer templates (5), provision scripts, autoinstall
  configs, `vmrun` lifecycle scripts, 5-test suite (bash + PowerShell).
- `openspec/specs/{vm-image-building,vm-lifecycle,test-execution}/spec.md` (18 new
  requirements).
- Commits: `a80a720` (feat), `144301c` (fix), `9510702` (archive+sync).

---

_Generated from session `019da8c3-50f9-7596-8e75-81e1a874eed6` · `/Users/robson/Project/pi-agent-dashboard` · 2026-04-20. Source extract: `/tmp/facts-1784850653N.md`._
