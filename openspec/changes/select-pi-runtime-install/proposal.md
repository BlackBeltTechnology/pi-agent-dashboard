# Let users choose which pi install the dashboard spawns and imports

## Why

`pi` resolves from several independent locations that can each hold a different version — the Electron app bundle, the dashboard-managed install under `~/.pi-dashboard/`, a global npm/nvm install on `PATH`, and a workspace `node_modules/`. Today the dashboard picks one via a fixed strategy chain (`packages/shared/src/tool-registry/definitions.ts` → `piExecutorDef`) and the user has no visibility into what was chosen or why.

The escape hatch that does exist is unusable in practice. Settings → General → **Tools** exposes a free-text absolute-path input on a collapsed `pi` row. To use it you must already know:

1. that a better install exists,
2. its exact absolute path,
3. that `pi` (spawned as a process) and `pi-coding-agent` (imported as a library) are **two separate registry entries**, so overriding one and not the other silently splits the runtime in half.

That third point is the sharpest edge. The server loads `DefaultPackageManager` **from** the `pi-coding-agent` module (`package-manager-wrapper.ts`) to compute package installs, model lists and skill discovery, while sessions spawn the `pi` executor. Override only `pi` and the dashboard confidently reports capabilities its sessions do not have.

There is no discovery surface at all: nothing enumerates the candidate installs with their versions. The `doctor` skill's `pi-resolution` module specifies exactly this reporting (`openspec/specs/doctor-skill/spec.md`, Requirement "Multi-location pi resolution reporting") and `packages/extension/.pi/skills/doctor/_lib/checks.ts` already implements the version-reading half (`enumeratePiInstalls`, `piVersionDivergence`, `readPiFloor`) — but it lives in a skill directory, is shell-oriented, and is unreachable from the server.

A fourth problem is invisible until you look at how sessions actually start. `buildTmuxCommand` (`packages/server/src/spawn-process/process-manager.ts`) emits the literal shell string `cd <cwd> && pi`, so the binary is chosen by the shell's `PATH` inside tmux and the tool registry is never consulted. `selectMechanism` makes tmux the **default mechanism on macOS and Linux** for interactive sessions. Any runtime selection that only reaches the registry would therefore miss the most common interactive path entirely — and would misreport, because the dashboard would show a selection its own sessions ignore.

## What Changes

- **Promote the doctor's pi-resolution helpers into `packages/shared/`.** `enumeratePiInstalls`, `piVersionDivergence` and `readPiFloor` move from `packages/extension/.pi/skills/doctor/_lib/checks.ts` into a shared module. They are pure and filesystem-only (they read `package.json`, they do **not** spawn `pi --version`), so probing every candidate is cheap. The doctor skill re-imports them from shared so there is exactly one implementation.

- **New candidate enumerator.** The promoted helpers *read* a caller-supplied set of directories; nothing *discovers* them. A new enumerator SHALL produce the candidate set by walking the same locations the strategy chain walks — the `bare-import` anchor (the Electron app bundle in a packaged install), the managed install under `~/.pi-dashboard/node_modules/`, npm-global / `PATH`, and the repo-root `node_modules` in a dev checkout — plus the currently-active override.

- **Each candidate carries per-consumer entry paths, not a bare directory.** Every existing strategy returns a *file*: `resolveModule` imports `resolution.path` directly, and `resolveJsScript` expects a `.js` file or a symlink to one. A directory is not a legal override value for any tool. Each candidate therefore carries its package directory **plus** the spawn entry (the `dist/cli.js` or real binary) and the module entry (`dist/index.js`), and the picker writes the correct file for each consumer.

- **New endpoint `GET /api/pi/installs`.** Returns, per candidate: a stable key, a human label, the package directory, the spawn entry, the module entry, the version read from `package.json`, whether it satisfies `piCompatibility.minimum`, and which of the two consumers currently uses it. Cached; invalidated by the existing tool-registry rescan.

- **New Settings → General → "Pi runtime" section**, placed directly above the existing **Tools** section. Two consumer lanes (*Sessions spawn* / *Server imports*) over one candidate list rendered as a two-column selection matrix, with a **"Keep both in sync"** checkbox that is **checked by default**. Selecting a row while linked sets both consumers; unchecking is the deliberate act that permits a mismatch. `Automatic` is itself a selectable row that displays what it currently resolves to, so automatic resolution is never a black box and reverting is one click.

- **Deliberate mismatch is supported, never accidental.** When the two consumers resolve to different versions the section shows a persistent divergence banner naming both versions, explaining that package installs and model lists are computed from the *import* side, and offering a one-click re-link. The apply-confirmation dialog restates the mismatch before it is written.

- **Below-floor candidates render disabled with the reason** rather than being hidden, in both columns. A candidate below `piCompatibility.minimum` states that the bridge extension will not load and what to do about it.

- **Asymmetric apply semantics are stated in the UI.** A spawn change affects newly started sessions only — running sessions keep the binary they were spawned with, and a live strip counts how many are still on the old version. An import change requires a server restart, offered on apply.

- **Electron hosts may point outside the app bundle** but are warned: the desktop app ships a tested `pi`, and pointing outside it means app updates no longer update `pi`.

- **tmux spawns honour the selection.** `buildTmuxCommand` SHALL embed the registry-resolved absolute pi path, shell-escaped via the existing `shellEscape`, instead of the bare word `pi`. Without this the picker would not affect the default interactive mechanism on macOS and Linux. This is the one place the change touches a shell-string construction path, so it carries a dedicated command-injection test.

- **Writes are atomic across both consumers.** A new `POST /api/pi/runtime` accepts the spawn and import selections together and persists them in a single override-store transaction, so a partial write cannot produce the mismatch the spec forbids. It still writes only `~/.pi/dashboard/tool-overrides.json` — no new persistence format. `Automatic` for a consumer clears that consumer's override in the same transaction. The existing `PUT`/`DELETE /api/tools/:name` routes are unchanged in shape and remain the Advanced escape hatch, now validated.

- **The sync state is derived, never stored.** "Keep both in sync" renders checked exactly when both consumers resolve to the same entry, so there is no new persisted field and no state that can disagree with reality — including for pre-existing `pi`-only overrides, which correctly open unchecked and diverged.

## Capabilities

### Modified Capabilities

- `tool-settings-ui`: adds the Pi runtime picker Requirements (candidate list, dual-consumer selection, link default, divergence surfacing, floor gating, apply semantics).
- `doctor-skill`: modifies the `pi-resolution` module Requirement to derive from the shared helpers rather than a skill-local copy.
- `session-spawn`: modifies the tmux command construction so the resolved pi path is embedded rather than the bare word `pi`.

### Added Capabilities

- `pi-runtime-selection`: the discovery endpoint, the candidate enumeration contract, and the floor-gating rules.

## Discipline Skills

- `security-hardening` — the endpoint accepts a user-supplied absolute path that becomes an executed binary path, and that path is now also interpolated into a tmux **shell string**. Path validation, symlink resolution, directory rejection and shell-escaping need a deliberate pass; a permissive override is arbitrary code execution on every session spawn.
- `doubt-driven-review` — permitting a deliberate spawn/import mismatch is close to irreversible in support terms: it creates a supported configuration whose failure modes we must then diagnose forever. The decision to allow it (versus warn-and-forbid) should be stress-tested before the UI ships it.
- `observability-instrumentation` — a new endpoint plus a setting that changes which binary every session runs. The active selection and any divergence must be visible in `/api/health` and the doctor output, or bug reports become unreadable.
- `review-code` — non-trivial change touching shared, server and client before commit.

## Impact

- **Default behaviour is unchanged.** With no override set, both consumers report `Automatic` and the strategy chain runs exactly as it does today. The picker is purely additive until someone selects a row.
- **Split-brain becomes visible rather than silent.** Users who already have a stale `pi`-only override (set through the Tools row) will see the divergence banner on first open of the section. That is the point, but it will surface pre-existing misconfiguration as a new red banner — expect support questions on release.
- **Deliberate mismatch is now a supported configuration.** Chosen over forbidding it. Cost: every future bug report needs the spawn/import pair, not a single version string. Mitigated by surfacing both in `/api/health` and the doctor output.
- **Version probing adds no spawn cost**: candidate versions are `package.json` reads, never `pi --version`. Enumeration itself is not spawn-free in the general case — locating the npm-global prefix runs `npm root -g`, and a `PATH` lookup can fall back to a login shell. The registry's cache does not cover these (it holds one winning resolution per tool, not per-location intermediates), so this change adds its own enumeration cache invalidated by the same rescan.

- **The "default behaviour is unchanged" invariant is deliberately renegotiated for tmux.** It holds unconditionally for *resolution*: with no override set, the strategy chain returns exactly what it returns today. It does **not** hold for tmux *spawning*, which currently ignores resolution entirely and will start honouring it. Where the shell's first `PATH` pi differs from the registry's resolution, tmux sessions silently change which binary they run even for users who never open the picker. This is the price of making the feature true on the default macOS/Linux path; it aligns tmux with headless and Windows Terminal, and it belongs in the release notes rather than in a footnote.

- **Some installs have no readable version** (a Windows `.cmd` shim on `PATH` has no adjacent `package.json`). These are shown as active and remain selectable, but are labelled unknown-version and are not floor-gated — the alternative would be making a legitimate install permanently unpinnable, or spawning it to ask, which the no-spawn invariant forbids.
- **One implementation of pi enumeration**, shared by the doctor skill and the server, replacing today's skill-local copy.
- **Out of scope**: installing or updating a pi at a chosen location (that stays with the existing Packages section), per-project or per-session runtime selection (this is a global setting), and choosing the Node runtime that executes pi.
