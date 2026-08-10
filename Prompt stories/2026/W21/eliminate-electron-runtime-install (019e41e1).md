---
session: 019e41e1
week: 2026/W21
type: planning
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [eliminate-electron-runtime-install]
proposal_excerpt: "The Electron arm of the dashboard currently does at runtime — inside a sandboxed home directory `~/.pi-dashboard/` — most of what `npm i -g` does natively on a developer machine. It ships an offline npm cache, extract…"
---

# How we did it: Eliminate the Electron runtime install (Phase 0 + build spike) — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The session opened by invoking the `openspec-apply-change` skill against the change
`eliminate-electron-runtime-install` — an 83-task, 10-phase monster that deletes ~3350
net LOC and reworks how the Electron app provisions its runtime (moving `pi`, `openspec`,
and `tsx` from a runtime `npm i -g`-style install inside `~/.pi-dashboard/` into a
**build-time bundle** shipped in the `.app`). The literal first prompt was the raw skill
text ("Implement tasks from an OpenSpec change"). The **real** objective, once steering
clarified it, was: *don't try to boil the ocean — ratify the Phase 0 pre-decisions, then
land task 1.1 (bundle the runtime deps) and prove it with a real native macOS x86_64 DMG
build under the Phase 1 GO/NO-GO size threshold.*

## 2. TL;DR playbook

1. Invoke `openspec-apply-change` for the change; **read proposal + design + tasks first**
   and report the shape (task count, phases, which phases need a human).
2. **Stop before touching code** and force a scope decision: "78 tasks is too much for one
   session — which slice?" Let the human pick (here: Phase 0, then task 1.1).
3. Phase 0 = ratify decisions: append a `## Decisions ratified` section to `design.md`
   (Q1/Q2/Q3 verdict + rationale), run `openspec validate <change>`, flip the 5 Phase 0
   checkboxes in `tasks.md`.
4. Task 1.1: edit `packages/electron/scripts/bundle-server.mjs` to read pins from
   `offline-packages.json` and inject `pi`/`openspec`/`tsx` as `dependencies` of the
   synthetic bundled `package.json`; rewrite the stale "intentionally NOT a dep" comment.
5. Verify cheaply: `node --check` then `node bundle-server.mjs --source-only` (exits before
   `npm install`, safe locally) — confirm the pins print and land in the synthetic
   `package.json`.
6. Build the real artifact: detect host arch (`uname -m` → native x86_64), **wipe
   `resources/server`** to force a re-bundle, then `./build-installer.sh`.
7. Expect native-dep breakage on the DMG maker (Node 24 prebuilds missing) — `npm rebuild
   macos-alias fs-xattr`, re-run just the `make` step (cache intact, no re-bundle).
8. Mount the DMG, verify `pi`/`openspec`/`tsx` resolve to the bundled copy + correct
   Mach-O arch, compare size vs baseline against the GO/NO-GO threshold, record the spike
   result in `design.md`.

## 3. How the collaboration unfolded

**Phase A — Recon & scope negotiation.** The AI read the proposal/design/tasks, correctly
sized the change as "very large — 83 tasks, 10 phases, multi-platform builds, a week of
dogfood, a release cut," and **refused to start coding** until the human chose a slice.
This is the single most valuable move in the session: picking the wrong slice of an 83-task
change would burn hours. The human answered by scoping to Phase 0, then (next prompt) to
task 1.1 only.

**Phase B — Phase 0 ratification (planning work).** The AI appended a `## Decisions
ratified` section to `design.md` recording Q1 (archive the prior bootstrap change; its
Failures 1 & 2 go vestigial), Q2 (wizard collapses to one welcome step with a
`~/.pi/dashboard/first-run-done` marker), and Q3 (bridge-arm parity is out of scope). Then
`openspec validate` (passes) → flip 5 checkboxes. Clean, low-risk, fully reversible.

**Phase C — Task 1.1 code change.** The AI located the synthetic `bundlePkg` in
`bundle-server.mjs`, added a `PINS_FILE` loader that reads `offline-packages.json` (fatal
if missing/malformed), injected those three packages as `dependencies`, and rewrote the
now-wrong comment that explained why `pi` *wasn't* bundled. It verified with the
`--source-only` dry-run before running anything expensive.

**Phase D — Real build spike & native-dep firefight.** The human steered "create macOS x86
(this platform) to make tests." The AI confirmed native x86_64, wiped the bundle cache to
force a real re-bundle, and kicked off `./build-installer.sh`. The `.app` packaged fine but
the **DMG step failed twice** on missing Node 24 native prebuilds (`macos-alias`'s
`volume.node`, then `fs-xattr`'s `xattr.node`). The AI diagnosed each from the build log,
`npm rebuild`-ed the offending module, and re-ran only the `make` step. Result: a **209.9 MB
DMG, 15 MB *smaller* than the 225 MB baseline** despite adding three packages — because
pre-installed `node_modules` compress better than the old gzipped offline cacache tarball.
Mounted, verified contents + arch, recorded the spike result in `design.md`.

## 4. Prompts that worked

- **The goal prompt** (the skill invocation) was fine as a kickoff *because* the AI treated
  it as "load the change and report," not "go do all 83 tasks." A stronger explicit version:
  *"Apply `eliminate-electron-runtime-install`, but first read all artifacts and propose a
  single-session scope — don't touch code until I confirm the slice."*
- **High-leverage follow-up: "create macOS x86 (this platform) to make tests."** Six words
  that unlocked the entire build spike. It told the AI (a) which platform, (b) that a real
  installer artifact was wanted, (c) that it was for verification. The AI correctly inferred
  native build, no cross-arch wrapper.
- The implicit steering "Phase 0" / "task 1.1 only" prompts were the highest-value moves:
  they converted an unboundable task into two shippable ones.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Face an 83-task change with no natural stopping point | Scope to "Phase 0", then "task 1.1 only" | State the slice in the kickoff prompt; treat multi-phase OpenSpec changes as one-phase-per-session by default |
| Not know which platform/artifact to build | "create macOS x86 (this platform) to make tests" | Name the target platform + "produce the real installer" up front |
| Re-bundle only when `resources/server/node_modules` is absent | (AI self-corrected) wipe `resources/server` before building | Remember: after editing `bundle-server.mjs`, **always** `rm -rf packages/electron/resources/server` or the build uses the stale bundle |

The human imposed a quality bar implicitly via the Phase 1 GO/NO-GO thresholds already in
the change (size delta ≤ +150 MB, pi/openspec/tsx resolve to bundled copies, correct
Mach-O arch, no leftover offline-packages). The AI checked every one before declaring done.

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were created this session — it was execution against an existing
OpenSpec change using the `openspec-apply-change` skill. The reusable asset that *should*
exist (and would have saved the two failed DMG builds) is a **build-host gotcha note**:

- **What it captures:** the Electron DMG maker's native sub-deps (`macos-alias`,
  `fs-xattr`) ship without Node 24 prebuilds, so the first DMG build fails until you
  `npm rebuild macos-alias fs-xattr` to materialize `volume.node` + `xattr.node`.
- **Why it's effective:** it turns a 2-cycle diagnose-from-log firefight into one
  pre-emptive command.
- **When to invoke:** before any local `.dmg` build on a fresh `node_modules`. (This session
  noted the separate change `fix-darwin-dmg-maker-macos-alias` already tracks it — so the
  fix has a home; reference it rather than rediscovering.)

## 7. Pitfalls & dead ends

- **DMG build fails on `macos-alias` / `volume.node` (Node 24).** Not a regression from your
  change — the `.app` packages fine; only the DMG step dies. Fix: `npm rebuild macos-alias
  fs-xattr`, then re-run just the `make` step.
- **A second native dep (`fs-xattr`/`xattr.node`) fails after the first is fixed.** Rebuild
  the whole `appdmg` native chain at once rather than one-at-a-time.
- **Stale bundle.** `bundle-server.mjs` only re-bundles when `resources/server/node_modules`
  is missing. After editing the bundler, wipe `resources/server` or you'll ship the old
  artifact and "prove" nothing.
- **`openspec status … --json | grep '"complete"'` returned no match** (the JSON shape
  differs) — use the `openspec instructions apply --json` progress fields or parse with
  `python3 -c`, not a raw grep.
- **Size intuition trap.** The new DMG being *smaller* despite adding 3 packages is real,
  not a measurement error: gzipped offline cacache tarball → pre-installed `node_modules`
  that the DMG's zlib compresses better. Don't "fix" it.

## 8. Reproduce it faster — checklist

- [ ] Invoke `openspec-apply-change` for `eliminate-electron-runtime-install`; read
      proposal + design + tasks before anything.
- [ ] Announce scope and **stop** — do one phase/task per session. Confirm the slice.
- [ ] Phase 0: append `## Decisions ratified` to `design.md`, `openspec validate`, flip
      the 5 checkboxes.
- [ ] Task 1.1: edit `packages/electron/scripts/bundle-server.mjs` — read pins from
      `offline-packages.json`, inject `pi`/`openspec`/`tsx` as `dependencies`, fix the
      stale comment.
- [ ] Verify cheap: `node --check` + `node bundle-server.mjs --source-only`.
- [ ] `rm -rf packages/electron/resources/server` (force re-bundle), then
      `./build-installer.sh`.
- [ ] On DMG failure: `npm rebuild macos-alias fs-xattr`, re-run the `make` step.
- [ ] Mount DMG, verify bundled `pi@0.74.0` / `openspec@1.3.0` / `tsx@4.21.0`, Mach-O
      `x86_64`, size vs baseline within the GO/NO-GO threshold; record in `design.md`.

**Key inputs:** a native build host of the target arch (here macOS Intel), a working
`node_modules`, `offline-packages.json` pins. **Artifacts produced:**
`packages/electron/out/make/PI-Dashboard-darwin-x64-0.5.3.dmg` (209.9 MB); edits to
`bundle-server.mjs`, `design.md`, `tasks.md`.

---

_Generated from session `019e41e1-036a-7389-a288-d30e441be1c5` · `/Users/robson/Project/pi-agent-dashboard` · 2026-05-19. Source extract: session facts sheet (mktemp)._
