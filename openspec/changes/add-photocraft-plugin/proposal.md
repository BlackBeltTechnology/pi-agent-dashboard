## Why

Agents in pi can generate and edit whole images through `packages/nano-banana`, but they cannot do precise, local, pixel-exact edits: select a subject, crop, resize, colour-grade, mask, composite, or batch-convert. Gemini regenerates the entire input image (it has no mask/inpaint input — `packages/nano-banana/.pi/skills/nano-banana-imagegen/SKILL.md` documents only `--file`), so "replace just this part" drifts outside the target and changes resolution.

PhotoCraft (github.com/storytold/photocraft, MIT/Apache-2.0, Rust) ships a headless `photocraft-cli` with an 858-command self-describing registry, `run`/`batch`/`info`/`convert` subcommands, a JSON-lines `serve` mode and a stdio MCP server. A spike against v0.7.0 on macOS confirmed: SHA256 matches `SHA256SUMS.txt`, binary notarized, `run` edits in ~70 ms, clear non-zero-exit errors, MCP `initialize`/`tools/list`/`doc_open`/`command_run`/`doc_save` work, and a crop → regenerate → place-back → feathered-mask composite leaves pixels outside the region untouched (rect and `select.object` semantic masks both). The CLI binary is present in every platform bundle (macOS cli zip, Linux/FreeBSD tarball `bin/photocraft-cli`, Windows portable zip `photocraft-cli.exe`).

Pairing the two gives agents deterministic local edits plus generative fills.

## What Changes

- New package `packages/photocraft` → `@blackbelt-technology/pi-dashboard-photocraft` (standalone pi package, like `nano-banana`; no dashboard client/server plugin code).
- **Binary provisioning**: resolve the **latest** PhotoCraft GitHub release (overridable pin `PHOTOCRAFT_VERSION`), pick the asset for the host OS/arch, verify SHA256 against the release's `SHA256SUMS.txt`, extract only the CLI binary into a versioned cache, reuse the cache offline, cache the "latest" lookup for 24 h, honour `GITHUB_TOKEN`. Headless only — the desktop app is never installed or launched.
- **`pi-photocraft` CLI** (bin):
  - `ensure` / `path` — provision and print the binary path;
  - `exec <args…>` — pass-through to `photocraft-cli` (bash route);
  - `mcp` — provision then run `photocraft-cli mcp` with both automation roots set to the cwd (or explicit `--root`), serializing `tools/call` requests because the upstream server handles requests concurrently;
  - `mcp --register` — opt-in: write a `photocraft` entry (absolute paths) into project `.pi/mcp.json` (merge, never clobber other servers);
  - `replace-region` — deterministic generative part-replacement: region (rect or `subject`/`sky`/`object:<rect>` selection) → padded crop → `nano-banana` edit of the crop (library call to `generateImage`) → resize + place back at the exact box → feathered mask → flattened output (+ optional layered `.psd`); pixels outside the crop stay identical.
- **Skill** `.pi/skills/photocraft`: discovery-first usage (`commands --filter`, `info`, `run`, `batch`), bash vs MCP route, the MCP sequential-call rule, path-root rule, and recipes (replace part, remove object via `edit.contentAwareFill`, insert generated asset, background swap, finishing/batch export) combining with `pi-nano-banana`.
- Recommended-extensions manifest entry (`status: "optional"`) and repo registrations (publish allowlist, vitest project, knip workspace) mirroring `nano-banana`.

## Capabilities

### New Capabilities
- `photocraft-binary-provisioning`: release resolution (latest + pin), host→asset mapping, checksum verification, extraction, versioned cache, offline reuse, rate-limit-aware lookup cache, failure reporting.
- `photocraft-cli-entrypoint`: `pi-photocraft` subcommands (`ensure`, `path`, `exec`, `mcp`, `mcp --register`), the shipped skill, and the recommended-extensions manifest entry.
- `photocraft-region-replace`: the `replace-region` crop → nano-banana → composite pipeline, region selectors, padding/min-size rules, mask/feather, outputs and failure semantics.

### Modified Capabilities
- (none) — `nano-banana` is consumed through its existing exported `generateImage` contract (`nano-banana-image-generation-client`), unchanged.

## Impact

- Code: new `packages/photocraft/` (`src/provision.ts`, `src/region-replace.ts`, `src/mcp-proxy.ts`, `src/mcp-register.ts`, `src/bin/photocraft.ts`, skill, README, AGENTS.md); `packages/shared/src/recommended-extensions.ts` (one entry); `.github/workflows/publish.yml`, root `vitest.config.ts`, `knip.json`, `pnpm-lock.yaml`.
- Dependencies: `@blackbelt-technology/pi-dashboard-nano-banana` (workspace dep, as `video-production` does); `@blackbelt-technology/pi-dashboard-shared` for `spawn` (streaming) and `execFileAsync` (short captures) from `platform/exec` (no-direct-child-process invariant). Archive extraction uses system tools (`ditto` on macOS, `tar` elsewhere — Windows 10+ ships bsdtar, which reads zip) — no new npm dependency.
- Network: GitHub API + release-asset downloads (~65–77 MB per platform bundle) on first use and on version change only.
- Security: downloaded executable — integrity via SHA256SUMS (same-origin: corruption check, not authenticity); macOS `spctl` assessment logged; MCP/serve path access confined to cwd roots.
- Compatibility: "latest" can change command ids between releases → skill is discovery-first; `PHOTOCRAFT_VERSION` pins for rollback. No migration; no persisted dashboard state.
- Rollback: unpublish/deprecate the package and remove the manifest entry; cache dir is user-deletable.

## Discipline Skills

- `security-hardening` — downloads and executes a third-party binary; untrusted archive extraction (path traversal), checksum verification, `.pi/mcp.json` write, MCP automation roots.
- `observability-instrumentation` — new external calls (GitHub API, asset download, Gemini via nano-banana); `ensure`/`replace-region` report version, asset, cache hit/miss, step timings and the failing step.
- `doubt-driven-review` — "latest" auto-update is a supply-chain decision that is hard to walk back once users depend on it.
- `review-code` — before commit.
