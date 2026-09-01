---
session: 019e5bc0
week: 2026/W21
type: development
model: "@fast"
premium: true
premium_reason: "heavy steering (30 user prompts); large facts sheet (~16208 tok)"
upgrade_status: pending
openspec_changes: [add-startup-recovery-server]
proposal_excerpt: "The dashboard server crashes immediately when a top-level third-party dependency fails to resolve at module-load time. Real-world failures observed in `~/.pi/dashboard/server.log`:"
---

# How we did it: Eliminate the Electron runtime install — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened with a deceptively small prompt — `build and restart server` — but
the *real* objective emerged across 30 steering turns: **make local dashboard development
self-contained and resilient**, so a contributor can run this checkout instead of a stale
global npm install, so the server survives a broken dependency instead of crashing, and so
the Electron Windows build can actually be QA-tested in a VM. Three threads, one arc:
(1) a **startup-recovery server** that degrades gracefully on `ERR_MODULE_NOT_FOUND`;
(2) **switching `pi-dashboard` from the global install to the local checkout** via `npm link`;
(3) a marathon **Packer + VMware Fusion Windows-11 VM build** to run the Electron bootstrap
test. It was never one task — it was a working session that kept branching as reality pushed back.

## 2. TL;DR playbook

1. **Diagnose "frontend looks old" first, don't rebuild blindly.** Confirm *which* binary is
   serving — `pi-dashboard status` / `/api/health` reports the pid + source path. A fresh
   `npm run build` is useless if the running server is the global install.
2. **Make the server fault-tolerant with a dynamic-import boundary.** Static top-level imports
   throw during module *load* — no try/catch can catch them. Move third-party imports behind
   `await import()` inside `runForeground()`, catch `ERR_MODULE_NOT_FOUND`, and start a
   pure-`node:http` recovery server on the same port.
3. **Wrap it in an OpenSpec change** (`add-startup-recovery-server`): proposal → tasks → delta
   spec (7 requirements, 10 scenarios) → `openspec validate --strict` → archive + sync specs.
4. **Switch to local dev with `npm link`,** not by editing PATH by hand:
   `npm link --workspace=@blackbelt-technology/pi-dashboard-server`. Add `link:local` /
   `unlink:local` npm scripts + a README note so it's shareable and reversible.
5. **For the Windows Electron QA VM, expect a long failure chain** — build the Packer template
   incrementally, committing each fix. The blockers, in the order they surface: single-file
   `packer init`, TPM 2.0 + Secure Boot, `autounattend.xml` namespaces + `InstallFrom`,
   LabConfig hardware-check bypass, `lsisas1068` disk controller, OpenSSH `Add-WindowsCapability`,
   and a provisioner PATH refresh.
6. **Keep the human in the loop with screenshots** for anything visual (VM boot screens) —
   the operator's `[image]` prompts were the fastest diagnostic channel.
7. **Be honest about hard prerequisites** you can't satisfy autonomously (a 6.6 GB Windows ISO,
   an hour of interactive VM provisioning, a running Docker daemon). State them, don't fake progress.

## 3. How the collaboration unfolded

**Phase A — Diagnosis (the "old frontend" trap).** The build succeeded but the UI looked
stale. Instead of rebuilding again, the AI checked the running server's source path and found
the operator was running the *globally-installed* `@blackbelt-technology/pi-agent-dashboard`,
not the repo. `npm run build` only updates the checkout; the global CLI ignores it. **Why it
worked:** confirming *which binary serves* before touching code prevented a rebuild loop.

**Phase B — Fault tolerance → OpenSpec change.** The operator asked to make plugin loading
non-blocking. The AI first pushed back with a finding: the plugin loader was *already*
fault-tolerant (soft-fails, status store, Settings UI). The real crashes were a different
class — a missing top-level dependency throwing at module-load time. It proposed the
dynamic-import boundary + recovery server, confirmed the plan before writing, shipped
`recovery-server.ts` (zero third-party imports) + 19 tests, then formalized it as the
`add-startup-recovery-server` OpenSpec change, validated strict, committed, archived, and
synced the new capability spec. **Decision point:** the human said "make it fault tolerant";
the AI reframed the actual failure mode rather than patching the wrong layer.

**Phase C — Global → local dev.** The operator wanted to stop using the global install. The
AI inventoried both install locations, flagged the risk before running `rm`, and (after an
honest disclosure that `npm uninstall -g` swept more than the multiselect implied — it
honored npm's configured prefix) settled on `npm link` to point `pi-dashboard` at the checkout.
It then made this shareable: `link:local`/`unlink:local` scripts + README subsection.

**Phase D — The Windows VM marathon.** "Test electron windows with fuse" → VMware **Fusion**.
This became the bulk of the session: a Packer `vmware-iso` build that failed at nearly every
layer. Each failure was root-caused from a screenshot or log, fixed in `windows.pkr.hcl` /
`autounattend.xml` / `provision-windows.ps1`, and committed individually (`eedc1ac3`,
`7806f5e9`, `db3e3530`, `492b0caa`, `f9d1730d`). Attempt #4 finally got every layer right and
reached the provisioner. **Why it worked:** treating the VM build as an incremental,
commit-per-fix debugging loop — not one big config — meant every hard-won fix was preserved.

## 4. Prompts that worked

- **Goal prompt — `build and restart server`.** Weak as written (ambiguous), but it kicked off
  the diagnosis. **Stronger version:** *"The dashboard frontend looks stale after a build —
  confirm which binary is actually serving before rebuilding."*
- **`Is it possible to make more fault tolerant? If a plugin cannot load don't block the
  server…`** — high-leverage: it surfaced a whole design (recovery server + OpenSpec change).
- **`What is the best way to switch to local when doesn't wanna use the global installed?`** —
  open-ended "what's the best way" prompts let the AI enumerate options (npm link vs alias vs
  Makefile) and recommend, rather than guessing one.
- **`Is it a way to share this with other developers?`** — turned a one-off local fix into a
  documented, reversible `link:local` workflow. Great instinct: always ask "how do others reproduce this?"
- **`[image]` steering** (VM boot screens) — the single most effective debugging channel for
  the VM saga. A screenshot beat any log for "is it the boot menu or a BSOD?"

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Rebuild when the UI looked stale | "the frontend seems old" | Check the *running* server's source path (`pi-dashboard status`) before any rebuild |
| Assume a plugin fix was needed | "make it fault tolerant" (real bug was module-load crash) | Distinguish load-time throws from runtime plugin failures up front |
| Trust `npm uninstall -g`'s target | "uninstall all global packages" (it swept the managed prefix too) | Always pass `--prefix` explicitly; never trust the active npm config for destructive ops |
| Treat the VM build as one config | repeated "still rebooting" / `[image]` | Build Packer templates incrementally, commit each fix, expect a multi-layer failure chain |
| Risk overclaiming progress | "It seems stuck" / "It seems stopped" | Poll logs + port reachability honestly; say "blocked on X prerequisite" when true |

Corrections that mattered most: the **npm-prefix sweep** (a genuine destructive-op mistake the
AI disclosed honestly and learned from) and the repeated redirection to **keep going layer by
layer** on the VM instead of declaring victory early.

## 6. Skills, tools & memory created — and why they're effective

No reusable pi skill or memory was saved in-session — but two artifacts became durable assets:

- **The `add-startup-recovery-server` OpenSpec change** (archived, spec synced). Captures the
  dynamic-import-boundary pattern as 7 requirements + 10 scenarios. Reusable problem it solves:
  *a server that must survive its own missing dependencies.* Invoke the pattern any time a
  top-level import can fail at load time — move it behind `await import()` and catch `ERR_MODULE_NOT_FOUND`.
- **The `link:local` / `unlink:local` npm scripts + README workflow.** Removes the manual PATH
  surgery every contributor would otherwise reinvent; makes "run the checkout, not the global
  install" a one-liner. Invoke when a monorepo CLI ships globally but you want live-edit dev.

**Skill worth creating:** a *"packer-win11-fusion-bringup"* project skill capturing the exact
failure chain (single-file `packer init` → TPM/SecureBoot vmx_data → autounattend namespaces +
InstallFrom → LabConfig bypass → `lsisas1068` → OpenSSH `Add-WindowsCapability` → provisioner
`Update-Environment`). This session paid ~3h to discover that order; a skill would make the next
bringup minutes.

## 7. Pitfalls & dead ends

- **Rebuilding to fix a "stale" UI when the global install is what's serving** — build the repo,
  but verify the running pid's source path or you'll rebuild forever.
- **`npm install --no-save @rollup/rollup-linux-x64-gnu`** triggers npm-cli#4828 and *removes the
  host's darwin binaries*. It broke the host node_modules. Use `npm pack` + manual extract to
  side-load a native dep into a container without touching the host tree.
- **`npm uninstall -g` honors npm's configured prefix, not your listing** — it swept the managed
  `~/.pi-dashboard/node` location even though only nvm-global items were selected. Pass `--prefix`.
- **The Electron Windows Docker build silently exits 0 with no `out/`** — an esbuild 0.28 vs 0.25.12
  version conflict crashes the forge prePackage hook, but forge still returns 0. Don't trust the exit code; check the artifact exists.
- **VM reboot loop = a stack of separate blockers, not one bug** — Win 11 needs TPM+SecureBoot
  (vmx_data), the answer file needs `xmlns:wcm`/`xmlns:xsi` + `<InstallFrom>` with the exact WIM
  edition name ("Windows 11 Enterprise Evaluation"), the hardware check needs LabConfig
  `Bypass*` keys in the windowsPE pass, WinPE can't see the disk on `lsilogic` (use `lsisas1068`),
  and OpenSSH Server isn't preinstalled on 25H2 (`Add-WindowsCapability` first).
- **Chocolatey PATH doesn't propagate to the current PowerShell session** — refresh *all* machine+user
  env vars (an `Update-Environment` helper), not just the raw `Path` string (which contains
  unexpanded `%NVM_HOME%` literals).
- **Hard prerequisites you can't self-serve:** a ~6.6 GB Windows ISO (manual license download), a
  running Docker daemon, ~1h interactive VM provisioning. Name them; don't fake around them.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the repo checkout; a running dashboard to diagnose against; for the
VM path — the Win 11 Enterprise Eval ISO downloaded, Docker Desktop running, VMware Fusion 13+
with x86 emulation, `packer` + `vmrun` installed.

- [ ] `pi-dashboard status` — confirm which binary serves *before* rebuilding
- [ ] Move load-time third-party imports behind `await import()` in `runForeground()`; catch
      `ERR_MODULE_NOT_FOUND` → pure-`node:http` recovery server on the same port
- [ ] Formalize as an OpenSpec change; `openspec validate <name> --strict`; archive + sync specs
- [ ] `npm link --workspace=@blackbelt-technology/pi-dashboard-server`; add `link:local` /
      `unlink:local` scripts + README note
- [ ] Windows VM: fix Packer layers in order — single-file `packer init`, TPM+SecureBoot vmx_data,
      autounattend namespaces + `InstallFrom` (exact edition), LabConfig bypass, `lsisas1068`,
      OpenSSH `Add-WindowsCapability`, provisioner env refresh — **commit each fix**
- [ ] For destructive `npm uninstall -g`, pass `--prefix` explicitly
- [ ] Drive visual debugging with screenshots; state unmet prerequisites honestly

**Artifacts produced:** `packages/server/src/recovery-server.ts` (+ test),
`openspec/changes/archive/2026-05-24-add-startup-recovery-server/`,
`openspec/specs/server-startup-recovery/spec.md`,
`packages/flows-anthropic-bridge-plugin/src/server/index.ts` (defensive route guard + test),
`package.json` + `README.md` (link:local workflow), and the QA Packer stack
(`qa/packer/windows.pkr.hcl`, `qa/packer/http/autounattend.xml`,
`qa/packer/scripts/provision-windows.ps1`, `qa/Makefile`).

---

_Generated from session `019e5bc0` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-25. Source extract: deterministic facts sheet._
