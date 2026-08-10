---
session: 019f065b
week: 2026/W26
type: development
model: "@fast"
premium: false
premium_reason: ""
upgrade_status: n/a
openspec_changes: [add-e2e-faux-model-roundtrip]
proposal_excerpt: "`add-playwright-e2e` and `add-e2e-spawn-scenarios` (both archived 2026-06-23) landed the browser-E2E harness and the spawn-dependent scenarios — but neither drives a **model round-trip in the browser**. By design:"
---

# How we did it: add-e2e-faux-model-roundtrip — an AI collaboration guideline

> A reusable playbook reconstructed from a real pi session. It explains **what was
> asked, how it was built with the AI, what had to be steered, and how to reproduce
> the result faster next time.** Write for a future operator who has the same goal.

---

## 1. Goal (the ask)

The operator opened with a single skill invocation:

```
/skill:openspec-apply-change add-e2e-faux-model-roundtrip
```

The real objective: implement a **key-free, deterministic browser E2E round-trip** —
`prompt → faux model → streamed events → rendered DOM` — with per-session scenario
routing, then take it all the way through CI and merge. Prior changes had landed the
Playwright harness and spawn scenarios, but nothing had ever driven a real model
turn *in the browser*. This change closes that gap using a scripted "faux" provider so
CI needs no API key. Eighteen tasks, spec-driven, executed in an OpenSpec worktree,
finished with `ship-change` (PR #172 → squash-merge → worktree cleanup).

## 2. TL;DR playbook

1. `/skill:openspec-apply-change <change>` — let the apply skill read context files and
   drive the tasks.md checklist. Don't hand-manage task order.
2. **Learn the faux mechanics from source first.** Read
   `node_modules/@earendil-works/pi-ai/dist/providers/faux.js` and the existing
   `faux-provider.ext.ts` before writing the router — the sentinel/step-counting
   contract is not obvious.
3. Build the **fixture router** (`resolveActiveStep(context)` + a self-perpetuating
   router factory replacing static `setResponses`); keep `FAUX_SCRIPT` as a fallback.
   Add a unit test.
4. **Verify the integration test against a real pi subprocess.** The worktree has no
   `node_modules` — symlink the pi bin in so the router is actually exercised.
5. Stage the fixture into the container **two ways**: a Dockerfile `COPY qa/fixtures`
   for the baked image AND a `compose.test.yml` bind-mount, because `compose up`
   (warm) reuses a stale image and the COPY never lands.
6. Seed `defaultModel: faux/faux-1` into **both** pi `~/.pi/agent/settings.json` and the
   dashboard `~/.pi/dashboard/config.json` under `PI_E2E_SEED` — the bridge and pi read
   different config files.
7. In `test-entrypoint.sh`, **symlink `node_modules` into the staged extension dir** so
   `~/.pi/agent/extensions/faux-provider/` can resolve `@earendil-works/pi-ai`.
8. Give every faux spec an **isolated session** (`spawnFreshGitSession`, resolve by a
   never-seen `data-session-id`, settle on a card before branching) so a pending
   `ask_user` in one spec can't block siblings sharing a session.
9. Run the specs three ways: fast path against a running container, the managed
   lifecycle on a fresh empty container, and a `PI_E2E_SEED`-off run to prove the
   harness stays UI-only.
10. `/skill:ship-change` — archive+sync specs, commit, PR to `develop`, watch CI, fix,
    re-push, merge, remove worktree.

## 3. How the collaboration unfolded

**Phase 1 — Discovery (read before write).** The AI read the change context, the
Dockerfile, e2e helpers, client renderers, and — critically — the compiled faux
provider in `node_modules`. It discovered renderers assert on **visible text, not
testids**, and reverse-engineered the faux sentinel + assistant-turn step-counting
contract. *Why it worked:* the router design flows directly from the provider's real
contract, not a guess.

**Phase 2 — Implement the router.** Added exported `resolveActiveStep(context)` and
replaced static `setResponses` with a router factory, keeping `FAUX_SCRIPT` as a
fallback. Unit test written; integration test run against a **real pi subprocess** by
symlinking the pi bin into the `node_modules`-less worktree. Decision point: prove the
router against a live subprocess, not just a mock.

**Phase 3 — Stage into the container (the hard part).** Three environmental failures
surfaced in sequence, each debugged in-container:
1. `/app/qa/fixtures` missing → the 2-day-old image was reused by warm `compose up`;
   the Dockerfile COPY never rebuilt. Fix: **bind-mount** `qa/fixtures` in
   `compose.test.yml` (keep the COPY for the baked image).
2. `pi --list-models` showed no faux → the staged extension couldn't resolve
   `@earendil-works/pi-ai` from `~/.pi/agent/extensions/` (no local `node_modules`).
   Fix: **symlink `node_modules`** into the staged dir in the entrypoint.
3. Which `pi` binary spawns sessions? The container's global `pi` is
   `@mariozechner/pi-coding-agent@0.73.1`; `/app` is `@earendil-works`. Empirically the
   dashboard spawns via tmux → the global `pi`, which auto-discovers the extension. The
   symlink fix made faux load and stream.

**Phase 4 — Session isolation.** faux-ask passed but faux-text/faux-tool failed:
Playwright runs specs alphabetically, and faux-ask's pending `ask_user` blocked the
**shared** session. Added `spawnFreshGitSession` (new session per spec, resolved by an
unseen `data-session-id`), then fixed a follow-on **hydration race** by settling on a
card before branching off the onboarding CTA.

**Phase 5 — Verify + ship.** Ran the specs fast-path, managed-lifecycle, and
`PI_E2E_SEED`-off (proving UI-only stays UI-only). Type-check confirmed the new files
added **zero** errors. `ship-change` archived specs, opened PR #172, and hit a CI lint
failure (below), which was fixed and re-pushed to green, then squash-merged.

## 4. Prompts that worked

- **Goal prompt** — `/skill:openspec-apply-change add-e2e-faux-model-roundtrip`. A skill
  invocation with the change name is a strong kickoff: it hands the AI the tasks.md
  contract and context files, so it self-drives instead of asking what to do.
- **`Maybe newer pi has other module structure?`** — a short, high-leverage nudge at
  the exact moment the AI was stuck on module resolution. It reframed the problem from
  "my code is wrong" to "the runtime layout changed," unlocking the
  `@mariozechner` vs `@earendil-works` scope discovery.
- **`Use skill ship-change`** (×2) — once implementation verified, naming the ship skill
  cleanly handed off to the archive→PR→merge pipeline. The repeat simply re-entered the
  skill after CI's first round.

Rewrite tip: the goal prompt could pre-state the known constraints — e.g. *"faux must
work key-free in the docker harness; the worktree has no node_modules; specs must be
session-isolated"* — to front-load the three lessons this session learned the hard way.

## 5. Steering & corrections (what to watch for)

| The AI tended to… | The human had to steer by… | Bake this in next time by… |
|-------------------|----------------------------|----------------------------|
| Assume its extension code was the fault when faux wouldn't load | "Maybe newer pi has other module structure?" | Check the runtime pi package **scope/version** before debugging your own code |
| Stop after implementation ("18/18 tasks complete") | "Use skill ship-change" | Chain apply → ship in the plan; don't wait to be told to ship |
| Trust `compose up` to reflect a Dockerfile change | (self-corrected in-container) | Bind-mount fixtures for the test image; never assume warm `compose up` rebuilds |
| Share one session across specs | (self-corrected via failing specs) | Isolate every spec's session up front (`spawnFreshGitSession`) |

## 6. Skills, tools & memory created — and why they're effective

No new skills or memories were saved. The session was pure application of existing
skills (`openspec-apply-change`, `ship-change`) plus two `general-purpose` subagents to
update file-index rows (keeping doc bookkeeping out of the main context).

**What *should* be memory:** the three container-staging lessons are durable and
non-obvious — (1) warm `compose up` reuses a stale image so bind-mount test fixtures;
(2) globally-installed `pi` may be a different package scope than `/app`; (3) staged
`~/.pi/agent/extensions/` dirs need a `node_modules` symlink to resolve pi-ai. A
project memory or a short "faux e2e staging" skill would remove a multi-hour debug loop
next time.

## 7. Pitfalls & dead ends

- **`/app/qa/fixtures` absent despite a COPY** → the image is stale; warm `compose up`
  won't rebuild. Bind-mount the fixtures in `compose.test.yml`.
- **`pi --list-models` shows no faux** → the staged extension can't resolve pi-ai.
  Symlink `node_modules` into `~/.pi/agent/extensions/<ext>/`.
- **Wrong-scope pi confusion** → the container's global `pi` is `@mariozechner`, `/app`
  is `@earendil-works`. Determine empirically which binary the dashboard spawns (tmux →
  global pi) before assuming a symlink target.
- **Specs pass alone, fail together** → a pending `ask_user` blocks a shared session.
  Give each spec a fresh session.
- **Onboarding CTA detaches mid-click** → WS hydration flips the empty view; settle on
  a session card before branching.
- **CI lint (tsc) failed after a green local run** → the new unit test *imported*
  `resolveActiveStep`, pulling `faux-provider.ext.ts` into tsc's graph and surfacing
  latent **named** `@earendil-works/pi-ai` imports that don't resolve under `bundler`
  resolution. Fix: mirror `faux-scenarios.ts`'s namespace-import + cast pattern.
- **`gh --delete-branch` errors in a worktree** → it tries to switch the local checkout
  to `develop` (held by the parent worktree). The remote merge still completes; delete
  the branch and remove the worktree manually.
- **Local jimp `JimpMime` undefined test failures** → pre-existing `image-fit` env
  artifact, CI-clean. Not your breakage; don't chase it.

## 8. Reproduce it faster — checklist

**Inputs to have ready:** the OpenSpec change name; a running Docker daemon + Chromium;
awareness that the worktree has no `node_modules`.

**Checklist:**
- [ ] `/skill:openspec-apply-change <change>` — let apply drive tasks.md.
- [ ] Read the compiled faux provider before writing the router.
- [ ] Router: `resolveActiveStep` + router factory, keep `FAUX_SCRIPT` fallback, unit test.
- [ ] Integration test against a real pi subprocess (symlink the pi bin into the worktree).
- [ ] Stage fixtures **both** via Dockerfile COPY and `compose.test.yml` bind-mount.
- [ ] Seed `defaultModel: faux/faux-1` into pi settings.json AND dashboard config.json under `PI_E2E_SEED`.
- [ ] Symlink `node_modules` into the staged extension dir in `test-entrypoint.sh`.
- [ ] `spawnFreshGitSession` per spec; settle on a card before branching.
- [ ] Run specs fast-path, managed-lifecycle, and `PI_E2E_SEED`-off.
- [ ] Mirror `faux-scenarios.ts` namespace-import pattern to avoid the tsc/bundler lint trap.
- [ ] `/skill:ship-change` → PR to develop → CI green → squash-merge → remove worktree.

**Artifacts produced:**
- `packages/server/src/__tests__/faux-router.unit.test.ts`
- `tests/e2e/faux-text.spec.ts`, `faux-tool.spec.ts`, `faux-ask.spec.ts`
- edits to `qa/fixtures/faux-provider.ext.ts`, `docker/Dockerfile`,
  `docker/test-entrypoint.sh`, `docker/compose.test.yml`, `tests/e2e/helpers/index.ts`,
  `tests/e2e/README.md`
- PR [#172](https://github.com/BlackBeltTechnology/pi-agent-dashboard/pull/172) → `develop`, squash-merged (SHA `d6eb80fa`).

---

_Generated from session `019f065b-ba27-7ef8-b1b5-ad5ede43ca47` · `/Users/robson/Project/pi-agent-dashboard` · 2026-06-27. Source extract: deterministic facts sheet._
