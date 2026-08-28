## Why

We have no in-repo path for producing release videos, README hero clips, or CHANGELOG animations. HyperFrames (heygen-com/hyperframes, Apache-2.0) is an HTML→MP4 framework whose 20-skill bundle teaches an agent the full production loop (plan → author HTML → wire seekable animations → add media → lint → preview → render), including `/pr-to-video`, which turns a GitHub PR into a changelog clip.

HyperFrames supports pi as a first-class install target and ships its own installer. This change therefore does **not** vendor anything — it documents the supported setup so any contributor (or pi session) can reach the toolchain, and records the prerequisites the follow-on `add-release-video-pipeline` change will have to satisfy in CI.

## What Changes

- Add `docs/hyperframes.md` (delegated to DocScribe, caveman style) covering: what HyperFrames is; the one-command skill install; the prerequisites; the local render loop; the version-pinning caveat; and the licensing posture.
- Document the install command as `npx hyperframes skills update`, which installs the **core set** (`hyperframes`, `hyperframes-{animation,audio,cli,core,creative,keyframes,registry}`, `media-use`) into the universal skill store `~/.agents/skills`. pi already reads that directory, so no `.pi/settings.json` change is required.
- Document that the `/hyperframes` router lazily installs each creation workflow on demand via `npx hyperframes skills update <workflow>` — this is expected behaviour, not a fault, and it requires network access at author time.
- Document the prerequisites explicitly: **Node.js 22+** (satisfied by this repo's `engines.node` of `>=22.19.0 <27`) and **FFmpeg**, which is a system binary this repo does not currently require or install.
- Record per-file rows in the directory `AGENTS.md` tree: a `docs/AGENTS.md` row for `hyperframes.md` (delegated to DocScribe). No root `AGENTS.md` change.
- **Non-goals**: no vendored copy of upstream, no update script, no `.pi/settings.json` change, no CI step, no rendered video assets, no template compositions, no root `package.json` dependency. Rendering is invoked ad-hoc via `npx hyperframes`.

## Discipline Skills

- `security-hardening` — the documented workflow runs unpinned third-party code from npm and GitHub (`npx hyperframes`, `npx skills add`) and grants it write access to the user's global skill store. The doc must state that trust decision plainly rather than bury it.

No other discipline skill applies: this change ships no executable artifact, no endpoint, no latency budget, and no irreversible step. `review-code`, `performance-optimization`, and `observability-instrumentation` are explicitly not triggered.

## Capabilities

### New Capabilities

- `hyperframes-skills`: contributors can install the HyperFrames skill bundle through the upstream-supported path in one documented command; pi discovers the installed skills without repo configuration; the prerequisites and the version-pinning caveat are documented rather than discovered at render time.

### Modified Capabilities

(none)

## Impact

- **New docs**: `docs/hyperframes.md`.
- **Modified**: `docs/AGENTS.md` (one row).
- **No new tree, no new script, no settings change, no repo size increase.** The installed skills live in `~/.agents/skills`, outside the repo and outside version control.
- **No runtime dependency added** to `package.json`. Cold-cache cost at author time is the published `hyperframes` package (~32 MB unpacked) fetched by `npx`, plus whatever the router lazily installs.
- **Unmet prerequisite**: FFmpeg is not installed by this repo's setup and is not present in the `docker/` image. Rendering will fail without it. Provisioning it is deferred to `add-release-video-pipeline`, which is where a CI render step would need it.
- **Version drift is accepted, not solved**: `npx hyperframes skills update` tracks upstream `main` and there is no supported pin. Upstream moves fast (392 tags; `v0.6.48` → `v0.8.15` restructured the tree and renamed skills). Renders are therefore not reproducible across time. Accepted for author-time use; `add-release-video-pipeline` must revisit this before any CI render is trusted.
- **Licensing**: nothing is redistributed, so Apache-2.0 §4 imposes no obligation on this repo. The bundled Pixabay SFX (under the installed `media-use` skill) never enter version control.
- **Unblocks**: `add-release-video-pipeline`, which inherits two open problems from here — FFmpeg provisioning and version pinning.
