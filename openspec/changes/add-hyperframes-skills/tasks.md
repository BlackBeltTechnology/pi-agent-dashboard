## 1. Verify the documented path before writing it down

- [ ] 1.1 On a machine (or container) with no HyperFrames skills installed, run `npx hyperframes skills update` and record the exact output
- [ ] 1.2 Confirm the core set lands in `~/.agents/skills/` — expect `hyperframes`, `hyperframes-{animation,audio,cli,core,creative,keyframes,registry}`, `media-use`
- [ ] 1.3 Confirm nothing was written inside the repo checkout (`git status` clean, no `.pi/settings.json` change needed)
- [ ] 1.4 Start a pi session in this repo and confirm the installed skills appear in the available-skills listing with no repo configuration
- [ ] 1.5 Invoke `/hyperframes` and let it route to one workflow; confirm the lazy `npx hyperframes skills update <workflow>` runs and the workflow becomes available
- [ ] 1.6 Record the observed FFmpeg failure mode when it is absent (what the error looks like), so the doc can name it

## 2. Author the topic doc

- [ ] 2.1 Delegate `docs/hyperframes.md` to a DocScribe subagent with the caveman-style rule passed verbatim in the prompt
- [ ] 2.2 Doc covers: what HyperFrames is; `npx hyperframes skills update` as the install command; that skills land in `~/.agents/skills` (global, machine-wide, outside version control); that pi reads that store with no repo config
- [ ] 2.3 Doc covers prerequisites: Node.js 22+ (already satisfied by `engines.node`) and **FFmpeg** (NOT installed by this repo, NOT in the `docker/` image) — including the observed failure mode from 1.6
- [ ] 2.4 Doc covers the local render loop: `cd <composition-dir> && npx hyperframes preview` / `npx hyperframes render`
- [ ] 2.5 Doc covers the router's lazy workflow install as expected behaviour, and that it needs network access at author time
- [ ] 2.6 Doc states the security posture plainly: `npx hyperframes` runs unpinned third-party code and writes into the machine-global skill store, affecting every project on that machine
- [ ] 2.7 Doc states the version caveat: `skills update` tracks upstream `main`, there is no supported pin, so renders are not reproducible across time
- [ ] 2.8 Doc states the licensing posture: nothing is redistributed by this repo, so Apache-2.0 imposes no obligation here; link upstream rather than restating its licence

## 3. Documentation tree

- [ ] 3.1 Delegate the `docs/AGENTS.md` row for `hyperframes.md` to DocScribe (caveman style)
- [ ] 3.2 Do NOT touch the root `AGENTS.md`
- [ ] 3.3 Run `kb dox lint` and confirm no `missing`/`stale`/`over-threshold` findings

## 4. Verification

- [ ] 4.1 Have someone who has never installed HyperFrames follow `docs/hyperframes.md` start to finish and render one throwaway composition
- [ ] 4.2 Confirm the repo is unchanged by that exercise — no `vendor/`, no settings edit, `git status` clean
- [ ] 4.3 Run `openspec validate add-hyperframes-skills` and confirm zero errors
- [ ] 4.4 Confirm `.pi/skills/` is unchanged (no third-party contamination of the curated namespace)
- [ ] 4.5 Confirm no rendered video assets, compositions, or media were committed
