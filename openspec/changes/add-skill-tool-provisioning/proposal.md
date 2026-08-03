## Why

Many skills in this monorepo shell out to external binaries (libreoffice, ffmpeg,
mmdc, tesseract/OCR, playwright chromium, python+gradio, zrok) or to bundled
CLIs, but there is **no coherent, cross-platform way for a *skill* to declare,
deliver, or verify those tools**. Each skill improvises: some ship a JS CLI via
npm `bin`, one quarantines its toolchain in Docker (`document-converter` →
`pi-doc-engine`), the rest embed ad-hoc prose ("`command -v agent-browser`",
"`npx playwright install chromium`", "`brew install …`"). Skills fail opaquely on
machines missing a tool, install guidance drifts per-OS, and there is no single
place to answer "what does this skill need and is it present here?"

**The dashboard already solved this for its OWN dependencies.**
`packages/shared/src/tool-registry/` ships a `ToolRegistry` (ordered strategy-chain
resolver → `Resolution { ok, path, source, tried }`), a per-OS `installHints`
catalog keyed by tool id (`{ commands:{brew,apt,winget,choco,scoop}, manual, url,
docsAnchor }`), a shell-callable CLI (`pi-dashboard-resolve-tool.cjs`), a
Settings→Tools `[Install ▾]` recommend UI, and `MissingToolError` deep-links —
all governed by `openspec/specs/tool-registry/spec.md` and a
`no-hardcoded-node-modules-paths` lint. **Skills cannot use any of it**: the
registry's tool set is hardcoded in `definitions.ts`, resolves only
binaries/modules by *path* (no credential / docker-image / browser probes), and
never auto-installs. This change extends that registry to skills rather than
building a parallel system.

## What Changes

- **Skill-package tool manifest → registry ingestion.** A skill package MAY
  declare a `pi.tools` array in its `package.json` (additive sibling to the
  existing `pi.skills`/`pi.extensions`). Each entry names a tool `id`, a probe
  `kind`, and an `optional` flag. On load the registry ingests these into its
  tool set (today hardcoded in `definitions.ts`), so a skill's tools resolve
  through the SAME `ToolRegistry` + `installHints` catalog + CLI the dashboard
  already uses. **The manifest carries no shell strings** — install recipes stay
  first-party in the registry's `installHints`; the manifest supplies only a
  validated tool id + probe kind.
- **New probe kinds** the current path-only registry lacks, added as strategies:
  `env:` (credential presence — boolean, never reads the value), `docker-image:`
  (a built/available image), `pw-browser:` (a Playwright-managed browser). Binary
  and module tools keep resolving by path via the existing strategy chain.
- **Register media tools** (`ffmpeg`, `ffprobe`, `imagemagick`, `chromium`) with
  static-npm strategies + per-OS `installHints`. `ffmpeg` resolves via a
  new `static-npm` strategy against `ffmpeg-static` (returns a *path*),
  so `registry.resolve("ffmpeg")` — not a bare PATH probe — reports presence.
  `ffprobe` gets its own strategy (ffmpeg-static ships no ffprobe).
- **Opt-in auto-run of first-party hints.** The registry today only *recommends*
  (`installHints` in the Install dropdown). This adds an explicit-opt-in path to
  RUN a resolved `installHints.commands` entry, never a manifest-supplied string;
  network+exec hints (docker build, download) require confirmation. Default stays
  recommend-only, matching the current behavior and the `browser` skill's stance.
- **Doctor reporting** (in scope): ingested skill tools surface through the
  EXISTING registry surfaces (`list()`, `GET /api/tools`, Settings→Tools
  `[Install ▾]`) with no new reporting path — a skill tool IS a registry tool
  once ingested.
- **Migrate binary-heavy skills** to declare manifests instead of prose,
  incrementally; unmanifested skills are unaffected.

## Capabilities

### New Capabilities
<!-- None. The reviewers (doubt-driven-review, both models) confirmed the
     resolver + catalog + CLI already exist as `tool-registry`; this is an
     extension of that capability, not a new one. -->

### Modified Capabilities
- `tool-registry`: extend the existing registry to (a) ingest skill-package
  `pi.tools` manifests into its tool set, (b) support non-path probe kinds
  (`env:`/`docker-image:`/`pw-browser:`) as strategies, (c) register the media
  tools (`ffmpeg`/`ffprobe`/`imagemagick`/`chromium`) with static-npm strategies
  + `installHints`, and (d) add an explicit-opt-in auto-run of first-party
  `installHints` commands with a confirm gate for network+exec.
<!-- No `doctor-diagnostic` delta: decided that ingested skill tools ride the
     existing tool-registry surfaces (list()/api-tools/Settings→Tools). The
     flow-through is asserted by an ADDED tool-registry requirement, not a doctor
     delta. -->

## Impact

- **`packages/shared/src/tool-registry/`**: `definitions.ts` (media-tool defs +
  new strategies), `types.ts` (probe `kind` extension), manifest-ingestion
  entry point, opt-in auto-run path. Reuses `Resolution`/`installHints`/the CLI.
- **Skill packages** (`packages/*/.pi/skills/*`, their `package.json`): add
  `pi.tools`; remove superseded SKILL.md install prose. `video-transcription`
  gains `ffmpeg-static` (+ ffprobe provider) as `optionalDependencies`.
- **`no-hardcoded-node-modules-paths` lint / `install-hints.test.ts`**: extend
  coverage to the new media tools + manifest ingestion.
- **Doctor** (`/api/tools`, Settings→Tools, `doctor-core.ts`): read skill tools.
- **Docs**: `docs/architecture.md` tool-provisioning section; affected skills'
  directory `AGENTS.md` rows; `docs/faq.md` anchors for any new `docsAnchor`.
- **Out of scope**: native-Node addon prebuild build-farm (Class B is empty for
  skills); a `pi-media-engine` Docker image (see design D3).
- **Non-breaking**: unmanifested skills keep working; migration is incremental.

## Discipline Skills

- `security-hardening`: the resolver may execute install commands / download
  artifacts and reads package-declared recipes — untrusted-input + command-exec
  surface.
- `observability-instrumentation`: doctor reporting and resolver probe outcomes
  need to be legible at runtime (which tool, which platform, present/missing/why).
- `doubt-driven-review`: the manifest schema is a semi-public contract every
  skill package depends on — review before it stands.
