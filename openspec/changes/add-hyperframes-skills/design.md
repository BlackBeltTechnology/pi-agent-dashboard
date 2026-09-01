## Context

HyperFrames (heygen-com/hyperframes, Apache-2.0) turns HTML/CSS/media plus seekable animations into deterministic MP4. It ships 20 skills in standard `SKILL.md` format: a router (`/hyperframes`), ten creation workflows (`/pr-to-video`, `/product-launch-video`, `/motion-graphics`, `/music-to-video`, …), and domain skills loaded on demand.

Two facts, verified against tag `v0.8.15` and the published `hyperframes@0.8.15` package, drive every decision below.

**pi is a first-class install target.** The CLI's generated agent-directory table contains:

```js
{ agent: "pi", base: "home", sub: ".pi/agent/skills" }
UNIVERSAL_STORE_READERS = new Set(["pi"])
```

pi is in `UNIVERSAL_STORE_READERS`, so the installer leaves it to read the universal store `~/.agents/skills` directly rather than mirroring into a pi-specific directory. That store is already live in this environment — this repo's sessions load `find-skills` from `~/.agents/skills/find-skills/SKILL.md` today. No repo configuration is needed for discovery.

**The router lazily installs workflows at author time.** `skills/hyperframes/SKILL.md` runs `npx hyperframes skills update <workflow-name>` before entering any workflow, and its `references/skill-lifecycle.md` states: *"If the command fails, surface the error; do not reconstruct the workflow from memory."* The lazy install is a hard gate on the router path, not optional decoration.

## Goals / Non-Goals

**Goals:**
- A contributor can go from a clean machine to an authoring-capable pi session by following one documented page.
- The prerequisites that are *not* satisfied by this repo today (FFmpeg) are stated up front rather than discovered at render time.
- The version-reproducibility limitation is recorded as an inherited problem for `add-release-video-pipeline`, not silently assumed away.

**Non-Goals:**
- No vendored copy, no update script, no `.pi/settings.json` entry.
- No CI render step, no committed video assets, no template compositions. (Deferred to `add-release-video-pipeline`.)
- No root `package.json` dependency — `npx hyperframes` is invoked ad-hoc from a composition directory.
- No attempt to pin the skill bundle. Upstream provides no supported mechanism (see D3).

## Decisions

### D1. Use the upstream installer; do not vendor

**Choice**: Document `npx hyperframes skills update`. Ship no copy of upstream in this repo.

**Rationale**: An earlier revision of this change proposed vendoring the whole `skills/` tree at `vendor/hyperframes/` and wiring `.pi/settings.json#skills[]`. Investigation killed it:

- **The pin would not hold.** The router's lazy `skills update` writes to `~/.agents/skills` regardless of what is vendored. Any workflow the router touches would then exist twice — pinned in-repo and freshly downloaded globally — at different versions, both visible to the session, with pi's precedence between them unverified.
- **The vendored copy is invisible to the CLI.** `skills check` computes `missing`/`outdated`/`current` against the agent skill directories only. It would report every vendored workflow as `missing` and re-download it on every routing decision, forever.
- **There is no supported opt-out.** `HYPERFRAMES_SKIP_SKILLS=1` is read in exactly one place — the `init` command. It does not suppress the router's `skills update`.
- **The cost was real.** 18 MB and 904 files at `v0.8.15`, plus a bespoke update script to maintain, in exchange for a guarantee that does not hold.

**Alternatives considered:**
- *Vendor all 20 skills* — rejected above.
- *Vendor the core set only (9 skills)* — smaller, but still split-brain the moment the router installs a workflow, and still requires the script. Rejected: same defect, less payload.
- *Git submodule / subtree* — moot once vendoring is rejected.

### D2. No `.pi/settings.json` change

**Choice**: Leave `.pi/settings.json` untouched.

**Rationale**: pi already reads `~/.agents/skills`, which is where the installer puts the bundle for pi. Adding a `skills[]` entry would point at a directory this change never creates. The repo's existing `skills[]` array (currently one negation entry) is left exactly as-is.

### D3. Accept version drift; do not invent a pin

**Choice**: Document that `skills update` tracks upstream `main` and that renders are not reproducible across time.

**Rationale**: Upstream ships no pinning mechanism for the skill bundle. `npx skills add heygen-com/hyperframes` resolves a registry blob that lags `main` by hours; `npx hyperframes skills update` installs from current `main`. Neither takes a version. Inventing a pin means reintroducing the vendoring rejected in D1.

**Consequence**: this is a genuine limitation for a CI render step, where a bundle change could alter output between two runs of the same CHANGELOG entry. It is recorded as an inherited problem for `add-release-video-pipeline` rather than papered over here. Author-time use is unaffected in practice.

### D4. State the FFmpeg gap rather than close it

**Choice**: Document Node 22+ and FFmpeg as prerequisites; do not add FFmpeg to any setup path.

**Rationale**: Node is already satisfied (`engines.node` is `>=22.19.0 <27`). FFmpeg is a system binary the repo neither requires nor installs, and it is absent from the `docker/` image. Provisioning it belongs with the change that actually needs an unattended render — `add-release-video-pipeline`. Closing it here would be speculative work for a consumer that does not exist yet.

### D5. Docs land per the Documentation Update Protocol

- `docs/hyperframes.md` is written by a DocScribe subagent with the caveman-style rule passed verbatim.
- `docs/AGENTS.md` gains one row for it, also delegated.
- Root `AGENTS.md` gets nothing — the protocol's default is that an update does not belong there, and this is not a rule every agent needs every turn.

## Risks / Trade-offs

- **Network dependency at author time.** The router cannot enter a workflow without a successful `skills update`. Offline authoring of an uninstalled workflow is impossible. → Accepted; the core set persists once installed, so only first use of a given workflow needs the network.
- **Unpinned third-party code with write access to the global skill store.** `npx hyperframes` executes code fetched at run time and installs skills into `~/.agents/skills`, affecting every project on the machine, not just this repo. → The doc must state this plainly (see the `security-hardening` note in the proposal). Not mitigated technically — mitigating it means vendoring, which D1 rejected.
- **Global install, not per-repo.** A contributor who follows the doc changes their machine, not their checkout. Two contributors can be on different bundle versions with no signal in `git status`. → Inherent to D1; the doc names it.
- **Cold-cache weight.** `hyperframes@0.8.15` is ~32 MB unpacked, fetched by `npx` on first render. → One-time per machine, cached thereafter; nothing enters the repo.
- **This change is now documentation-only.** Its entire deliverable is one doc page. → That is the honest size of the problem once vendoring is rejected; the value is the recorded prerequisites and caveats that `add-release-video-pipeline` depends on.

## Migration Plan

**Forward:**
1. Delegate `docs/hyperframes.md` to DocScribe (caveman style).
2. Delegate the `docs/AGENTS.md` row.
3. Verify the documented install command end-to-end on a clean machine (or a container) — install, discover in a pi session, render one throwaway composition.
4. Commit; open PR.

**Rollback:** `git rm docs/hyperframes.md` and revert the `docs/AGENTS.md` row. Nothing else in the repo changed. Skills already installed into `~/.agents/skills` are unaffected and can be removed by the contributor at will.

## Open Questions

- **Should FFmpeg be added to the `docker/` image?** Deferred to `add-release-video-pipeline` per D4, but if release video work starts in the harness rather than on a laptop, that change lands first.
- **Is version drift tolerable for a CI render?** Unresolved by design; `add-release-video-pipeline` must answer it before any automated render output is trusted.
