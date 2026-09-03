## Context

Skills reach external tools three uncoordinated ways (see `proposal.md`): npm-bin
JS CLIs, a Docker-quarantined engine (`document-converter` → `pi-doc-engine`), and
ad-hoc SKILL.md prose. 11 SKILL.md files carry install prose.

**The dashboard already has a tool-resolution system — this design extends it.**
`packages/shared/src/tool-registry/` (governed by `openspec/specs/tool-registry/`)
provides:
- `ToolRegistry`: ordered strategy-chain resolver → `Resolution { name, ok, path,
  source, tried, resolvedAt }`; ops `resolve/resolveModule/resolveExecutor/list/
  rescan/setOverride/clearOverride`; `getDefaultRegistry()` singleton.
- `ToolDefinition.installHints?: InstallHints` — per-OS
  `{ commands: Record<pkgmgr,string>, manual, url }` + `docsAnchor` → `docs/faq.md`.
  **This is the per-OS recipe catalog keyed by tool id.** Opaque to resolution;
  surfaced by `list()` + `GET /api/tools`.
- `pi-dashboard-resolve-tool.cjs` — self-contained shell-callable resolver CLI.
- Settings→Tools `[Install ▾]` dropdown on missing rows; `MissingToolError`
  chat deep-link. Both are the recommend surface.
- `no-hardcoded-node-modules-paths` + `install-hints.test.ts` lints.

**This design was initially drafted as two NEW capabilities** (a manifest schema
+ a resolver + a catalog + a CLI). A doubt-driven-review pass — primary reviewer
plus cross-model (`@propose-review-1`, glm-5.2) — independently found that all of
that already exists as `tool-registry`. This design is the corrected version:
**MODIFY `tool-registry`** to serve skills, rather than build a parallel system.

**What the registry does NOT yet do (the genuine delta):**
1. Ingest tools declared by a *skill package* (today the tool set is hardcoded in
   `definitions.ts`).
2. Probe anything other than a resolvable **path** (binary/module). No credential,
   docker-image, or browser-presence probes.
3. Auto-run an install (it only recommends via `installHints`).
4. Report per-skill tool status in doctor.

## Goals / Non-Goals

**Goals:**
- Let a skill package declare `pi.tools`; ingest into the existing `ToolRegistry`.
- Add non-path probe kinds (`env:`/`docker-image:`/`pw-browser:`) as strategies.
- Register media tools (`ffmpeg`/`ffprobe`/`imagemagick`/`chromium`) with
  static-npm strategies + `installHints`, reusing path resolution.
- Add an explicit-opt-in auto-run of first-party `installHints` commands.
- Surface ingested skill tools through the EXISTING registry surfaces (`list()`,
  `GET /api/tools`, Settings→Tools) — a skill tool IS a registry tool once
  ingested, so doctor reporting needs no new path (decided: full scope).
- Incremental, reversible migration — no flag-day.

**Non-Goals:**
- **Class B (native addons)** — empty for skills; the `os×cpu` prebuild build-farm
  is OUT (the registry already resolves `node-pty`/`electron` as build-time
  *modules*; no skill needs a new native addon).
- **A `pi-media-engine` Docker image** — rejected (D3).
- **True API-key validation** — presence ≠ validity; deferred to first real use.
- **A new resolver / catalog / CLI** — they exist; do not duplicate them.
- Changing how any skill functionally works.

## Decisions

### D1 — Skill manifest is an ingestion source, not a schema-island

A skill package declares an additive `pi.tools` array in `package.json`, sibling
to the existing `pi.skills`/`pi.extensions` (no collision — new key):

```jsonc
"pi": {
  "skills": [".pi/skills/video-transcription"],
  "tools": [
    { "id": "ffmpeg",         "probe": "resolve", "optional": true },
    { "id": "ffprobe",        "probe": "resolve", "optional": true },
    { "id": "SONIOX_API_KEY", "probe": "env"                      }
  ]
}
```

A manifest entry carries **only** `{ id, probe, optional? }` — **no `provide`, no
shell string**. The install recipe lives in the registry's `installHints` for
that `id` (first-party, code-reviewed, lint-checked). On skill load the registry
ingests each entry: if `id` is already a registered `ToolDefinition`, it is
referenced; if not, a definition is synthesized from the probe kind + a catalog
`installHints` lookup. **Alternative rejected:** a manifest that embeds its own
`provide`/recipe strings — rejected because it duplicates `installHints` and
reintroduces the untrusted-shell-string surface the doubt-review flagged.

`id` is validated `^[A-Za-z0-9_][A-Za-z0-9._-]*$` (a tool id, NOT an npm spec —
scoped package names like `@scope/pkg` are the registry strategy's internal
detail, not the manifest token). The charset permits uppercase + underscore so
that an `env`-kind id IS the environment-variable name (`SONIOX_API_KEY`) with no
extra manifest field. This resolves the earlier charset self-contradiction
(`npm:@scope/pkg` never appears in a manifest; env var names now validate).

### D2 — Probe kinds map to strategies / resolution, reusing `Resolution`

`ToolDefinition` gains a probe classification. Existing binary/module tools keep
`probe: "resolve"` (the strategy chain → a path). New kinds:

| manifest `probe` | how presence is determined | `Resolution.path` meaning |
|---|---|---|
| `resolve` (default) | existing strategy chain | absolute path to binary/module |
| `env` | env var is set (boolean) | n/a (`ok` only) |
| `docker-image` | image built/available (`docker image inspect`) | image ref |
| `pw-browser` | Playwright browser present in its cache dir | browser dir |

All four still return the registry's `Resolution { ok, path, source, tried }` —
one report shape. `env`/`docker-image`/`pw-browser` are implemented as strategies
so they slot into the existing chain + `tried[]` diagnostic trail.

**Two existing invariants must be relaxed for non-path kinds (doubt-review
B3/S1), so the delta MODIFIES them:**
- The existing "path SHALL be absolute when `ok`" invariant is scoped to path
  kinds (`binary`/`module`/`directory`). For `env` `path` MAY be `null` when
  `ok`; for `docker-image` `path` MAY be a non-filesystem image ref; for
  `pw-browser` `path` is the browser dir.
- The closed `Source` union gains `"probe"` (env/docker-image/pw-browser
  strategies) and `"static-npm"` (the ffmpeg-static path strategy) so
  `classify()` no longer mislabels them as `"system"`.

### D3 — ffmpeg → static-npm strategy, NOT Docker; probe is `resolve`, not PATH

`document-converter`'s Docker choice is earned by properties ffmpeg lacks
(7 entangled tools · GB-scale + models · python runtime · batch service ·
portability already abandoned). ffmpeg is one self-contained binary consumed by
portable npm-bin CLIs; a container would regress that.

**Critical fix (doubt-review B2/S5):** `ffmpeg-static` does NOT put `ffmpeg` on
PATH — it exports a resolvable path string. A `cmd:ffmpeg` PATH probe would report
"missing" forever. So ffmpeg is registered with `probe: "resolve"` and a
strategy chain `override → static-npm(ffmpeg-static) → where`. The **`static-npm`
strategy is NEW** (doubt-review S3): the existing `bare-import` returns a package
dir / JS entry, but media packages export a *binary path*. `static-npm` reads
that export in either shape — a **bare string** (`require("ffmpeg-static")`) or the
**`.path` of an object** (`require("@ffprobe-installer/ffprobe").path`). It returns
the path when present, else the chain falls to a PATH ffmpeg, else fails with
`installHints`. `video-transcription/src/ffmpeg.ts` runs the resolved path via
`execFile`, replacing today's bare `execFile("ffmpeg")`.

- `ffprobe` — `ffmpeg-static` ships NO ffprobe. Register separately via the
  `static-npm` strategy against `@ffprobe-installer/ffprobe` (object export →
  read `.path`; NOT `@ffmpeg-installer/ffmpeg`, which ships ffmpeg only) in its
  own chain. (Open question below: confirm its triples match ffmpeg-static.)
- `imagemagick` (`convert`) — `probe: "resolve"`, `optional`, host `installHints`
  only (no reliable static npm); graceful-degrade (thumbnails are cosmetic).
- `chromium` — `probe: "pw-browser"`, resolution reuses Playwright's own
  browsers-cache probe; `installHints.manual = "npx playwright install chromium"`.

**Docker-quarantine rule (recorded):** reserve for heavy · multi-tool ·
runtime+models · batch-service cases; static-npm for single portable binaries.

### D4 — Consent: recommend stays default; opt-in auto-runs FIRST-PARTY hints only

The registry already recommends (Install dropdown renders `installHints.commands`).
This adds an explicit-opt-in path to RUN a resolved hint:

- **Default = recommend** (unchanged; matches the `browser` skill's stance).
- **Opt-in auto-run** executes only a `installHints.commands[pkgmgr]` value —
  a **first-party, code-reviewed, lint-checked** string from `definitions.ts`.
  A skill manifest can NEVER contribute the executed string (D1). This is the
  answer to the doubt-review's provenance concern: provenance is structural —
  the only runnable strings are first-party hints.
- **Network+exec hints** (docker build, `npx … install`, downloads) require a
  per-invocation confirmation even under opt-in. **Data hook (doubt-review S4):**
  `PlatformInstallHint` gains an optional `requiresConfirm?: boolean` set on the
  first-party hint — the registry does NOT regex-sniff command strings.
- **Non-interactive (no TTY) auto-deny (decided):** under `ensure --install` on a
  headless host, a `requiresConfirm` hint is NOT run — the tool reports
  `blocked` (required) / `degraded` (optional) and the CLI exits non-zero when the
  tool was required. Safest default; no silent network install.
- **Surface:** opt-in is an explicit flag on the two faces — the `ensure` CLI
  `--install` and `ensureTools(manifest, { autoInstall: true })` (library).
  Absent the flag → recommend-only.

### D5 — Two faces, both over `getDefaultRegistry()`

- **Library:** `ensureTools(tools, opts): Promise<EnsureReport>` where
  `EnsureReport = { ok: boolean, tools: Array<Resolution & { optional, action }> }`
  (`action` ∈ `present|recommended|installed|degraded|blocked`). Facade code
  (`video-*`, `document-converter`) imports it. Hard-stop for a required-missing
  tool is a **returned `ok:false` + `action:"blocked"`**, NOT a throw (facades
  decide; matches the registry's non-throwing `resolve`).
- **CLI:** a **TS-backed skill CLI** exposes an `ensure` verb that reads a
  package's `pi.tools` and prints the report; exit `0` when all required tools
  present/installed, non-zero when a required tool is missing; `--json` always
  exits 0 with the outcome in the payload. **This is NOT the existing
  `pi-dashboard-resolve-tool.cjs`** (doubt-review S2): that `.cjs` is a
  self-contained, no-transpiler, build-time mirror with a hardcoded path-only
  tool set — it cannot run the `env`/`docker-image`/`pw-browser` strategies,
  which are TS registry code. The build-time `.cjs` stays as-is (path-only); the
  skill-facing `ensure` CLI is a separate TS bin resolved through the built
  shared package.

**Bootstrap:** SKILL.md prose shells to the TS `ensure` CLI, which ships in
`packages/shared` `bin` (already a dependency of the extension + server) — so it
is present wherever a skill runs through the dashboard. Facade-backed skills need
no CLI (they import the library) → migrate them first.

### D6 — Version checks: advisory, opt-in, catalog-owned

Presence (a successful `resolve`) is the required gate. An optional
`installHints`-adjacent `version: { args, parse, min }` MAY be declared **in the
registry definition** (not the skill manifest), defaults OFF, and is **advisory
(warn/degrade), not blocking**, unless a definition marks a known breaking floor
required. Rationale: version-output regexes rot across releases and a too-strict
`min` can hard-stop a working host.

## Risks / Trade-offs

- **[Ingestion trust]** a skill package injects tool ids into a shared registry →
  Mitigation: manifest carries no shell strings (D1); `id` charset-validated;
  runnable strings are first-party `installHints` only (D4).
- **[ffmpeg-static platform gap]** a missing triple → Mitigation: chain falls
  through to `where` (PATH) then `installHints`; optional tools degrade.
- **[Docker not universal]** `docker-image` probe on Windows-without-WSL / CI →
  Mitigation: the strategy returns `ok:false` with a reason and the definition's
  `installHints` recommend; never assume docker.
- **[pw-browser coupling]** reusing Playwright's cache-dir layout couples to its
  internals → Mitigation: probe reads the documented `PLAYWRIGHT_BROWSERS_PATH`
  / default cache dir; on mismatch it degrades to `installHints.manual`.
- **[API-key presence ≠ validity]** → resolver reports presence only; validity
  deferred to first real use (already fails loudly in `config.ts`).
- **[Registry surface growth]** more tool defs + strategies in `definitions.ts` →
  Mitigation: reuse `installHints` shape + existing lints; no new subsystem.
- **[Version-regex rot]** → mitigated by advisory + opt-in (D6).

## Migration Plan

Load-bearing: **an unmanifested skill is untouched** (no `pi.tools` → no
ingestion). The resolver defaults to *recommend*, so a bad manifest is a doc bug,
never a host mutation.

- **Phase 0 — extend the registry, zero behavior change.** Add probe-kind
  strategies (`env`/`docker-image`/`pw-browser`), the `pi.tools` ingestion entry
  point, the media-tool definitions + `installHints`, the `ensure` CLI verb, and
  `ensureTools()`. No skill declares `pi.tools` yet. Extend `install-hints.test.ts`.
- **Phase 1 — one exemplar per probe kind** (battle-test against reality):
  - `resolve`/static-npm (facade, no bootstrap): `video-transcription` ffmpeg +
    ffprobe — route `isFfmpegAvailable` through `registry.resolve`; add
    `ffmpeg-static` + ffprobe provider to `optionalDependencies`; ffmpeg-absent
    still degrades (audio-only).
  - `pw-browser` + CLI (bootstrap): `browser` skill — replace Step 0a prose with
    the `ensure` CLI verb for `agent-browser` + `chromium`; keep recommend-only.
  - `docker-image`: `document-converter` — map `DOCKER_UNAVAILABLE` to a
    `docker-image` probe; recommend `npm run build:image`.
  - `env`: `nano-banana` (`GEMINI_API_KEY`), `video-transcription`
    (`SONIOX_API_KEY`) — boolean probe, name-only recommend.
- **Phase 2 — roll remaining skills** (`veo-*`, `mockup-loop`, `doc-summarizer`,
  the rest of the 11), one PR each.
- **Phase 3 — doctor reporting (additive):** per-skill/per-platform status from
  the registry `Resolution`; confirm whether `/api/tools` + Settings→Tools
  already covers it or a `doctor-diagnostic` delta is warranted.

Rollback: Phase 0 is inert; Phases 1–2 are per-skill; Phase 3 is additive. Order
rule: facade-backed (`resolve`) first (no bootstrap), CLI-dependent second.

## Open Questions

- **`pw-browser` reuse**: read Playwright's cache dir directly (via
  `PLAYWRIGHT_BROWSERS_PATH` / default), or shell `npx playwright install
  --dry-run`? Affects the `browser`/`mockup-loop` probe.
- **ffprobe provider**: confirm `@ffprobe-installer/ffprobe` prebuilt triples
  match `ffmpeg-static` coverage; else `ffprobe-static`.
- **`ToolKind` for synthesized non-path defs**: reuse an existing kind or add a
  `probe` kind? (Resolved-leaning: the probe *kind* on the manifest maps to a
  strategy; the `ToolDefinition.kind` for synthesized env/docker/pw defs is
  `probe`.) Confirm in Phase 0.

**Resolved during doubt-review (previously open):** CLI shape — skill-facing
`ensure` is a TS bin, the build-time `.cjs` stays path-only (D5).
