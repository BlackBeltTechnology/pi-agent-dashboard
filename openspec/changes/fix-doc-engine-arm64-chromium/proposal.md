## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/508

`engine/Dockerfile:40-44` installs the browser with
`npx @puppeteer/browsers install chrome-headless-shell@stable`, unconditionally,
with no architecture branch. Chrome for Testing published no `linux-arm64`
headless-shell build when that line was written, so on Apple Silicon the image
builds as `arm64` while the baked shell is the `linux-x64` binary. Every
`mmdc` invocation then dies in qemu:

```
qemu-x86_64: Could not open '/lib64/ld-linux-x86-64.so.2': No such file or directory
```

The failure is a hard failure, not a soft fallback:
`mermaid_renderer.render_diagram` raises `RuntimeError` on a non-zero `mmdc`
(`document_converter/mermaid_renderer.py:299-301`), which the engine surfaces as
`PRODUCE_FAILED` (`engine_cli.py:229`), so `renderDocx`/`renderPdf` fail for
*any* document containing a ```` ```mermaid ```` block. The raw puppeteer stack
trace reaches the caller unclassified — `MMDC_FAILED` and `PRODUCE_FAILED` both
map to `PRODUCE_FAILED` (`src/engine.ts:306-322`), so "browser cannot launch"
is indistinguishable from "diagram source is invalid".

On arm64 the whole mermaid-bearing produce path is unusable.

## What Changes

- **Arch-native browser provisioning in `engine/Dockerfile`.** The browser is
  selected from the *build host* architecture: amd64 keeps the
  `chrome-headless-shell` mechanism, now pinned to an explicit build id instead
  of `@stable` (D7); arm64 installs the Debian `chromium` package (own
  `apt-get update` in the arm64 arm — the earlier apt layer deletes its lists,
  `Dockerfile:37`) and
  symlinks it at the existing `PUPPETEER_EXECUTABLE_PATH`
  (`/opt/chrome-headless-shell/chrome-headless-shell`), so `/opt/puppeteer.json`
  and the `mmdc` shim stay byte-identical on both arches.
- **Build-time render smoke.** A `RUN` step placed after the `mmdc` shim and
  `/opt/puppeteer.json` (`Dockerfile:62-66`) renders one trivial mermaid diagram
  with *both* argv shapes the engine uses (the default
  `mermaid_renderer.render_diagram` SVG + PNG calls and the `_mmdc` fallback
  call); an image whose browser cannot launch fails to build instead of failing
  at a user's first produce call.
- **Distinct `MMDC_UNAVAILABLE` diagnostic.** Classified only when a diagram
  render was actually attempted in the failing call (the `mmdc` shim touches a
  per-call marker file; `_mmdc` is itself an attempt) **and** a deterministic
  headless launch probe fails (launch the binary at `PUPPETEER_EXECUTABLE_PATH`
  with the same flags as `/opt/puppeteer.json` and `--dump-dom about:blank`;
  no stderr string matching). Then → `MMDC_UNAVAILABLE` with a message containing
  the probed executable path and `platform.machine()`; otherwise today's code. Produce calls with no
  diagram never get the code (design D6). The facade surfaces it as its own
  error code rather than folding it into `PRODUCE_FAILED`.
- **`IMAGE_VERSION` 0.1.0 → 0.2.0**, plus the doc references that pin the tag,
  plus a `:latest` tag from `engine/build-image.sh` (only when `IMAGE_TAG` is
  unset or empty — any explicit `IMAGE_TAG` builds just that tag, D8). Today the script tags only
  `pi-doc-engine:<IMAGE_VERSION>` while the server's default image name is the
  untagged `pi-doc-engine` (`packages/server/src/lib/office-preview.ts:125`),
  i.e. `:latest` — a tag the script never produces. Without the `:latest` tag
  the version bump cannot reach the default runtime path at all.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec/specs/document-converter/spec.md`
  - MODIFIED `Requirement: Python engine runs inside a Docker image` — image
    must be buildable and functional on both amd64 and arm64 hosts.
  - MODIFIED `Requirement: Diagram rendering with mmdc default` — the bundled
    browser must be native to the image architecture, and an unlaunchable
    browser must surface as a distinct diagnostic.
  - MODIFIED `Requirement: Styled diagram rendering via nano-banana with cache
    and fallback` — two parts. (a) Clarification, no code change: the styled
    render is generated from the Mermaid source and needs no mmdc, refuting the
    issue's claim. (b) **Contract change, not a wording fix:** the existing "fall
    back to mmdc and never hard-fail the document" clause is *weakened* to "the
    document still produces whenever mmdc can render; when mmdc itself cannot
    render, the produce call fails". Reason: the unconditional guarantee was
    never implemented — `_mmdc` raises and the produce call fails today
    (`engine_cli.py:163`, `:217`) — so the spec asserted behaviour the code does
    not provide. Any caller relying on the written guarantee loses it; no
    repo-internal caller does (`office-preview.ts` collapses every failure to
    `{success:false}`).

  **Semver:** weakening a published SHALL plus a new union member is a breaking
  contract change. The package is pre-1.0 (`package.json:3` `0.9.0`); under
  SemVer §4 0.x carries no stability promise, and this repo's convention uses the
  minor component as the breaking channel in 0.x — so 0.9.0 → **0.10.0**, with an
  explicit **breaking** note in the package README and root `CHANGELOG.md`
  `[Unreleased]`.

## Discipline Skills

- `review-code` — before commit (non-trivial change, tests green).
- `systematic-debugging` — only if the arm64 smoke render fails for a reason
  other than the arch mismatch during implementation.

No other `eng-disciplines` checkpoint applies: no auth/untrusted-input/PII
surface, no latency budget, no new endpoint or job, no irreversible migration.

## Non-goals

- Changing the nano-banana styled path's code. Its spec text is corrected (see
  Capabilities), but the behaviour already satisfies the issue's ask:
  `_render_styled_diagrams` generates straight from the mermaid *source* text
  via the nano-banana CLI and only calls `_mmdc` as a fallback
  (`engine_cli.py:152-163`). The issue's "renders a base PNG with mmdc first"
  claim is refuted — see design D4.
- Multi-arch publishing of `pi-doc-engine` (buildx `--platform`, a registry,
  manifest lists). The image is built locally per host by
  `engine/build-image.sh`; no CI workflow builds or publishes it.
- Changing the amd64 browser *mechanism* (it stays CfT `chrome-headless-shell`)
  or any mmdc render parameters. amd64 *provisioning* does change deliberately:
  `@stable` → pinned build id, mermaid-cli unpinned → pinned, base tag →
  explicit suite (D7). The concrete pins (suite, CfT build id, mermaid-cli
  version) are not chosen in this proposal; task 2.0 resolves them against
  today's upstream state and records them in `engine/VENDOR.md`. The suite pin
  is set to whatever suite the floating tag resolves to *at task 2.0*, so it is
  a no-op for the amd64 package set by construction; the browser and
  mermaid-cli pins are the only intended amd64 runtime delta.
- Soft-failing a document whose diagram cannot render (a failed diagram still
  fails the produce call).

## Impact

- `packages/document-converter/engine/Dockerfile` (base-suite pin, browser
  provisioning, version pins, smoke).
- `packages/document-converter/engine/build-image.sh` (also tag `:latest`).
- `packages/document-converter/engine/engine_cli.py` (`MMDC_UNAVAILABLE`
  classification, scoped to calls that attempted a diagram render).
- `packages/document-converter/engine/Dockerfile:64-65` `mmdc` shim gains one
  line touching `$PI_DOC_MMDC_MARKER` when set (render-attempt marker, D6).
- `packages/document-converter/engine/tests/` (three new pytest files: Dockerfile
  text guard, browser-launch-probe/gating unit tests, contract-restatement scan)
  and `src/__tests__/` (new `build-image.test.ts`, `release-notes.test.ts`).
- `.github/workflows/ci.yml` `music-pytest` job also runs
  `packages/document-converter/engine/tests` (design D9), pinned by
  `packages/shared/src/__tests__/ci-music-pytest.test.ts`.
- `packages/document-converter/src/errors.ts`, `src/engine.ts` (new code in the
  `DocConverterErrorCode` union + mapping) and `src/__tests__/engine.test.ts`.
- `packages/document-converter/engine/IMAGE_VERSION`, `engine/README.md`,
  `README.md`, `engine/VENDOR.md`, `packages/document-converter/AGENTS.md`,
  `packages/document-converter/package.json` (minor bump 0.9.0 → 0.10.0).
- `packages/document-converter/.pi/skills/document-converter/SKILL.md:34` and
  `packages/document-converter/.pi/skills/doc-summarizer/SKILL.md:28` (both pin
  `pi-doc-engine:0.1.0`; the first also carries the error-code list, and its
  line 25 states styled rendering "never hard-fails" — the clause this change
  weakens, so it is rewritten).
- Further restatements of the withdrawn contract / old tag:
  `packages/document-converter/src/schema.ts:24` ("Any failure falls back to
  mmdc"), `src/index.ts:31` and `src/engine.ts:58` (doc-comment examples
  `pi-doc-engine:0.1.0`), `src/__tests__/integration.test.ts:3,8,18` (header
  comment), `engine/README.md:25`. Comment/doc text only; completeness checked
  by `grep -rn 'pi-doc-engine:0.1.0\|falls back to mmdc'
  packages/document-converter` (task 4.16).
- Root `CHANGELOG.md` `[Unreleased]` (breaking note for the facade package).
- **Migration:** users rebuild the image (`npm run build:image -w
  @blackbelt-technology/pi-dashboard-document-converter`). An existing
  `pi-doc-engine:0.1.0` keeps working on amd64; arm64 users were already broken.
- **Compatibility:** `DocConverterErrorCode` gains one member — additive and
  runtime-compatible; a TypeScript consumer doing an *exhaustive* switch over
  the union must add a case; together with the weakened styled-fallback SHALL
  this is breaking — `package.json` 0.9.0 → 0.10.0 (0.x breaking channel, see
  Capabilities → Semver) plus README + CHANGELOG breaking notes, all tasked.
  amd64 image: same browser mechanism and render args, but the browser and
  mermaid-cli move from floating to pinned versions, so runtime output is
  expected unchanged *modulo the version pin*. The base-suite pin is a no-op by
  construction (it pins the suite `python:3.12-slim` resolves to at task 2.0,
  expected trixie). The amd64 *build* gains the smoke
  `RUN` and can newly fail there.
- **Rollback:** revert the Dockerfile + `IMAGE_VERSION` and rebuild; the facade
  change is inert without the engine change (the engine simply never emits
  `MMDC_UNAVAILABLE`).
