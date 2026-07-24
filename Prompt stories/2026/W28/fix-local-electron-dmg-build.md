---
session: 019f5458
week: 2026/W28
type: development
model: "@fast"
premium: true
premium_reason: "development session — created 0 skills / 1 memory; end-to-end apply→build→test→ship with real DMG validation"
upgrade_status: pending
openspec_changes: [fix-local-electron-dmg-build]
proposal_excerpt: "`npm run electron:build` (= `packages/electron/scripts/build-installer.sh`) cannot produce a macOS DMG on darwin. It fails hard."
---

# How we did it: Fix the local Electron DMG build — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The user kicked off with a single skill invocation: **`/skill:openspec-apply-change fix-local-electron-dmg-build`**. The real objective, once the spec delta was read, was concrete: `npm run electron:build` (`packages/electron/scripts/build-installer.sh`) **hard-fails on darwin** because `electron-forge make` has no DMG target. The task was to rewire the native build to mirror the CI workflow (`.github/workflows/_electron-build.yml`) so a local Intel Mac can produce a runnable, correctly-tagged DMG with valid electron-updater metadata — then remove the now-obsolete `macos-alias` plumbing, and finally *prove* it works with a real build and durable tests before shipping.

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — let the apply skill read the spec delta + `tasks.md`.
2. **Read CI first, then mirror it.** Open `.github/workflows/_electron-build.yml` and make the local script produce byte-identical outputs (artifact basename, `latest-*.yml`, `app-update.yml`).
3. Rewire `build_native_one_arch()`: darwin → `electron-forge package --platform=darwin --arch=<a>` then `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac dmg --prepackaged "<.app>"`; linux → `forge make` (.deb) then `electron-builder --linux AppImage --prepackaged`.
4. Delete dead code the fix orphans (`macos-alias` gate, its test, its `postinstall` hook, its devDependency) — verify with `tsc --noEmit` for orphaned imports.
5. **Prove tests in isolation before trusting the full suite:** run each directly-affected test with `HOME=$(mktemp -d) npx vitest run <file>`. Confirm any full-suite failures reproduce on a *stashed* tree = pre-existing.
6. **Actually build it:** `npm ci` (worktrees often lack `.bin/` symlinks) → `npm run electron:build -- --arch x64` → mount the DMG, check the inner Mach-O arch matches the basename, verify `latest-mac.yml` + `app-update.yml`.
7. Add a durable Playwright `_electron` spec that mounts the DMG and launches the real app — use a **free ephemeral port** and **force-kill teardown** (don't collide with the live `:8000` dashboard; `app.close()` hangs).
8. `/skill:ship-change` — flip deferred manual QA tasks, `openspec archive` (syncs specs + moves), commit, PR against `develop`, watch CI, confirm CodeRabbit is a real review with 0 threads, squash-merge, clean up worktree.

## 3. How the collaboration unfolded

**Discovery → Design.** The AI read the spec delta, `tasks.md`, and immediately pulled the CI workflow as the source of truth. Key move: it treated `_electron-build.yml` as the spec for what "correct" output looks like, so the local script became a faithful mirror rather than an independent invention. It also decided (per design D3) to *remove* the obsolete `macos-alias` plumbing rather than leave dead code.

**Implement.** `build_native_one_arch()` was rewired for darwin and linux; the `macos-alias` gate, its test, script, `postinstall` hook, and devDependency were deleted across 4 sites in `doctor-core.ts` and `package.json`. A `tsc --noEmit` caught orphaned imports. Net diff was surgical: **+73 / −268** (mostly dead-code removal).

**Verify (unit).** The full `npm test` showed 28 failures — the AI *did not panic*. It isolated each directly-affected test (`doctor-core` 17/17, `build-config-parity` 5/5, `doctor-route` 14/14 alone) and proved the 28 failures were pre-existing (image-fit jimp/sharp env issues + timing/port flakes) by reproducing them on an untouched tree.

**Verify (real build) — the decision point.** The AI flagged that tasks 5.2–5.6 were heavy manual builds and paused to check with the human. Once cleared, it ran `npm ci` (the worktree lacked `.bin/` symlinks), built the x64 DMG end-to-end (208M), mounted it, and confirmed the inner Mach-O was `x86_64`, matching the `-x64` basename — the exact silent-failure the smoke check guards against.

**Test (durable) + steering.** Prompt 2 redirected: *make local-runnable tests, use docker + playwright with system browser.* The AI discovered the repo already had two Playwright layers (web-E2E on Docker `:18000` and Electron-E2E via `_electron`), wrote a DMG-launch spec, hit a port collision + `app.close()` hang, and fixed both with an ephemeral port + force-kill.

**Ship.** Prompt 3 (*I'll test later, ship-change*) triggered the ship pipeline: archive+sync specs, PR #277 against `develop`, CI green, CodeRabbit 0 actionable threads, squash-merge, worktree cleanup.

## 4. Prompts that worked

- **The goal prompt** — `/skill:openspec-apply-change fix-local-electron-dmg-build`. Effective because the change already had a spec + `tasks.md`; the skill gave the AI a task ledger to work and check off. *Stronger version:* pair it with one line of intent, e.g. "apply this; mirror `_electron-build.yml` exactly and prove the DMG builds locally before shipping."
- **High-leverage follow-up** — *"make the test which can be done in local and uncheck remain tasks. Use docker test and playwright with system browser."* Short but it unlocked the whole durable-test phase and named the exact tooling (Docker + Playwright + system Chrome), saving a discovery round-trip.
- **The ship trigger** — *"I will test later, ship-change."* Cleanly delegated the deferred-QA decision so the AI could flip the remaining arm64-only task and run the full ship pipeline.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Stop at unit tests + a manual local build | "make the test which can be done in local" | Ask for durable automated tests up front, not just a one-off build proof |
| Leave test tooling implicit | "Use docker test and playwright with system browser" | Name the exact test layers (`PW_CHANNEL=chrome`, Docker `:18000`, `_electron`) in the goal prompt |
| Hold heavy build/QA tasks open | "I will test later, ship-change" | State the defer-vs-block policy for arch-specific QA (arm64/Linux → CI) in the change's tasks.md |

## 6. Skills, tools & memory created — and why they're effective

- **Memory saved (project):** `build-installer.sh build_native() mirrors _electron-build.yml — darwin uses electron-forge package + electron-builder --mac dmg --prepackaged`. *Why effective:* it pins the non-obvious CI↔local parity contract so a future change to either side knows to keep them in lockstep. Invoke-context: any Electron packaging or maker change.
- **Subagent spawned:** `general-purpose` → *Update `docs/faq.md` for the electron-builder DMG flow.* Correct routing per the repo's Rule 6 (all `docs/` prose writes go through a subagent with the caveman-style rule verbatim). *Why effective:* keeps the main agent orchestrating while docs style stays consistent.
- **Skill worth creating:** none was created, but the *"mirror CI, build for real, prove the artifact"* loop for Electron packaging fixes is repeatable — a `verify-electron-build-parity` skill (read `_electron-build.yml` → diff against `build-installer.sh` → build + mount + check arch/metadata) would remove the manual re-derivation each time.

## 7. Pitfalls & dead ends

- **Worktree `node_modules` has no `.bin/` symlinks** — a real `electron:build` can't run until `npm ci`. If the forge/builder binary "isn't found", run `npm ci` first.
- **Full `npm test` shows unrelated failures** — image-fit (jimp/sharp env) + server timing/port flakes. Don't chase them; reproduce on a *stashed* tree to prove pre-existing, and trust CI on Node 22 as the authoritative gate.
- **Electron-E2E port collision** — the live dashboard on `:8000` binds an interface `isPortInUse` misses. Use a **free ephemeral port** in the spec.
- **`app.close()` hangs on the packaged app** — use a **force-kill teardown** instead.
- **Docker harness health budget (180s) < first-build time (~260s)** — the `packages/` edit invalidated the cached image layer. Don't rebuild; attach to the already-healthy container with `PW_E2E_USE_RUNNING=1` on `:18000`.
- **Atomic multi-edit failures** — an `edit` with box-drawing/em-dash chars or a `- [ ]`-vs-`- [x]` mismatch fails the *whole* edit. Re-read the exact current text and redo.
- **Removing your own session's worktree** kills the Bash tool's cwd — expected; verify final state from a sandbox with an explicit `cwd`. Remote branch delete may not run if the local `--delete-branch` step aborts; delete it explicitly.
- **`job-object-windows` CI leg** failed with `INFRA: app never brought a server up on :8000` — it fails on `develop` too (pre-existing flake), and `develop` is unprotected, so it doesn't block. Confirm against `develop` before treating a red leg as your regression.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change with `tasks.md`, an Intel Mac (x64 DMG builds natively; arm64/Linux → CI), Docker + system Chrome for the E2E layers, `gh` auth for the PR.

- [ ] `/skill:openspec-apply-change <change>`
- [ ] Read `.github/workflows/_electron-build.yml`; make `build-installer.sh` mirror it exactly
- [ ] Rewire `build_native_one_arch()` (darwin: forge package → electron-builder --mac dmg --prepackaged; linux: forge make → electron-builder --linux AppImage)
- [ ] Delete orphaned dead code; `tsc --noEmit` to catch broken imports
- [ ] Isolate-test each touched file with `HOME=$(mktemp -d) npx vitest run <file>`; prove full-suite failures are pre-existing on a stashed tree
- [ ] `npm ci` → `npm run electron:build -- --arch x64` → mount DMG, check inner Mach-O arch == basename, verify `latest-mac.yml` + `app-update.yml`
- [ ] Add Playwright `_electron` DMG-launch spec (ephemeral port + force-kill teardown); run web-E2E smoke with `PW_CHANNEL=chrome` against `:18000`
- [ ] `/skill:ship-change` → archive+sync, PR vs `develop`, CI green, CodeRabbit 0 threads, squash-merge, clean up worktree

**Artifacts produced:** `packages/electron/scripts/build-installer.sh` (rewired), `tests/e2e-electron/dmg-build-launch.electron.spec.ts` (new), `packages/shared/src/doctor-core.ts` + `packages/electron/package.json` (dead-code removal), `docs/faq.md` (DMG flow), PR #277 merged to `develop` as `78a5bc201`.

---

_Generated from session `019f5458-380b-7d7e-8aa7-7019693aec51` · `/Users/robson/Project/pi-agent-dashboard` · 2026-07-12. Source extract: `/tmp/facts-XXXXXX.md`._
