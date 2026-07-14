## Why

The archived change `2026-06-23-distill-session-knowledge` shipped a genuine, portable meta-discipline: mine pi session JSONL logs, anchor every lesson to an objective signal (`isError` flip, tests-pass, user-confirm), promote only patterns recurring across sessions, and route distilled artifacts into `skill_manage` / memory / docs. It works for **any** pi project, not just this repo.

But it ships as two repo-internal pieces that never publish:
- the **skill** `.pi/skills/distill-session-knowledge/` (the pi-loaded surface), and
- the **engine** `packages/session-distiller/` (`private: true`, no `pi` field, `bin: distill-session-knowledge`) — a plain CLI/TS library, 46 vitest tests.

Because the engine is `private: true` and the skill lives in the root tree, no one outside this checkout can install the discipline. Extracting it into published npm packages (part of this monorepo) makes it reusable across every pi install while keeping the engine's tests and CLI intact.

Decision (from exploration): **two packages** — publish the engine as-is, and add a **thin skill package** that depends on it. This keeps the engine independently consumable (it has a real CLI + test suite) and lets the skill package stay a light SKILL.md + manifest.

## What Changes

- **Publish the engine** `@blackbelt-technology/pi-dashboard-session-distiller`:
  - drop `private: true`; add `publishConfig.access = public`, `license: MIT`, `repository.directory`, `keywords`, and a real starting `version` (currently `0.0.0`).
  - add a `files[]` allowlist (`src/`, `bin/`) and a `README` + `NOTICE` if third-party research/code attribution applies.
  - no source/behaviour change to the miner; the 46 vitest tests stay green.
- **New thin skill package** (e.g. `packages/distill-session-knowledge/`):
  - `package.json` with `pi.skills: [".pi/skills/distill-session-knowledge"]`, `publishConfig.access = public`, `license: MIT`, and a runtime `dependencies` entry on `@blackbelt-technology/pi-dashboard-session-distiller` (workspace-linked in-repo, real semver on publish).
  - move `.pi/skills/distill-session-knowledge/` (SKILL.md + support files) into this package; update the skill body so it invokes the engine via the package's published `distill-session-knowledge` bin / exported API rather than a repo-relative path.
  - `files[]` ships `.pi/skills/`, README, NOTICE.
- **Delete** the root `.pi/skills/distill-session-knowledge/` copy — exactly one source.
- **Release wiring**: add both packages to the `release-cut` published workspace set (root + shared/extension/server/web/image-fit/kb/kb-extension → grows to include these two); note in `release-cut` skill's package tally.
- **Docs**: AGENTS.md/DOX rows for the two package dirs; if a top-level pointer is warranted, one line only.
- **Non-goals**: no change to the mining algorithm, watermark logic, or the five signal classes; no dashboard-server change; no Electron bundling (dev/meta skill, not an app-shipped surface); no rename of the engine package or the `distill-session-knowledge` bin.

## Capabilities

### New Capabilities

- `distill-session-knowledge-package`: the session-knowledge distillation discipline installs as published npm packages from this monorepo — a public `session-distiller` engine (CLI + library, tests intact) plus a thin pi-skill package that depends on it and loads by NL trigger in any pi session.

### Modified Capabilities

(none — the miner's behaviour is preserved; only its packaging/publish surface changes.)

## Impact

- **Modified**: `packages/session-distiller/package.json` (un-private, publish flags, version, files, keywords, repository.directory).
- **New package**: `packages/distill-session-knowledge/` (thin: SKILL.md + package.json + README + NOTICE), depends on the engine.
- **Moved**: `.pi/skills/distill-session-knowledge/` → the new package's `.pi/skills/`.
- **Deleted**: root `.pi/skills/distill-session-knowledge/`.
- **Published workspace set grows by two**; `release-cut` publishes them on the next version bump. Engine goes `0.0.0` → a real initial version.
- **Cross-package dep**: skill → engine; must resolve as a workspace link in-repo and as a real dependency once published (version-skew risk if released independently — mitigate by releasing them together in the same `release-cut`).
- **Tests**: engine's 46 vitest tests unchanged and must stay green post-move.

## Discipline Skills

- `security-hardening` — the engine reads pi session JSONL that can contain secrets/PII/absolute paths; before publishing publicly, verify the miner + any bundled fixtures/README examples scrub or never emit sensitive session content (a published package widens the blast radius vs a repo-internal tool).
