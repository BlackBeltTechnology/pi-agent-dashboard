## Why

Two related gaps make automating the dashboard's own Electron shell awkward today:

1. **No agent can drive the shipped Electron app.** The dashboard ships as an Electron application, but the app exposes no Chrome DevTools Protocol (CDP) surface, so neither QA automation, agent-driven visual debugging, nor manual `agent-browser`/Playwright workflows can attach to the *actual installed binary*. They can only drive a separate Chrome pointed at `http://localhost:8000`, which tests the web UI but not the Electron shell (tray, IPC, wizard window, doctor window, menus).
2. **The skill that knows how to do this only exists for one repo.** The `browser-visual-debug` skill lives at `.pi/skills/` in this repository, so only sessions opened inside this repo see it. Every other pi-dashboard user has to discover the `agent-browser` CLI on their own. Meanwhile the `agent-browser` CLI itself ships excellent skills (`core`, `electron`) — they just aren't surfaced to dashboard users.

Closing both gaps at once turns "drive the dashboard's Electron app" from a tribal-knowledge task into a one-skill, one-flag affair available to every dashboard user.

## What Changes

### Electron shell — CDP debug surface
- Add `--debug-cdp[=<port>]` CLI flag and `PI_DEBUG_CDP` env var to `packages/electron/src/main.ts`. Activation appends Chromium's `remote-debugging-port` switch *before* `app.whenReady()` resolves.
- Default OFF. Default port `9222`. Loopback-only — do not expose `remote-debugging-address`.
- Log a one-line warning at startup when CDP is enabled.
- Document the single-instance-lock contract: enabling CDP requires fully quitting and relaunching; the second-instance hook cannot retroactively enable it.
- Add `dev:cdp` npm script in `packages/electron/package.json` for one-shot dev use.

### Bridge extension — ship a universal `browser` skill
- Add a new skill directory `packages/extension/.pi/skills/browser/` with vendored content from upstream `agent-browser` skills (`core` + `electron` recipes). Composite single-skill shape with `references/web.md`, `references/electron.md`, `UPSTREAM.md` (provenance), and `LICENSE` (attribution).
- Register the new skill in `packages/extension/package.json` under `pi.skills[]` so every dashboard session sees it.
- Skill's `SKILL.md` performs a Step-0 preflight (`command -v agent-browser`); if the CLI is missing, the skill instructs the user to `pi install npm:pi-agent-browser` and stops. **No CLI is bundled** — install is on-demand.
- The Electron recipe in `references/electron.md` SHALL include a worked example of attaching to the Pi Dashboard app via `--debug-cdp` (closes the loop with Part 1).

### Repo-local skill cleanup
- Delete `.pi/skills/browser-visual-debug/` (skill files, references, scripts).
- Migrate its valuable content (responsive-testing recipes, command cheatsheet, dashboard-debug recipes) into the new universal `browser` skill so all dashboard users benefit, not just this repo's developers.
- Remove the `browser-visual-debug` capability spec.

### Pre-merge gates (not part of the spec'd behavior, but enforced by tasks)
- Verify `agent-browser`'s upstream license permits vendoring; reproduce notice in `LICENSE` alongside vendored content.
- Verify `pi-agent-browser` is the correct install target for the Step-0 preflight (vs. raw `agent-browser`); pick whichever integrates pi's `browser` tool registry cleanly.

## Capabilities

### New Capabilities
- `default-browser-skill`: a composite `browser` skill shipped to every dashboard session by the bridge extension, covering web automation and Electron-app automation, with self-bootstrapping preflight for the `agent-browser` CLI.

### Modified Capabilities
- `electron-shell`: adds opt-in CDP debug surface (`--debug-cdp` flag, `PI_DEBUG_CDP` env, loopback-only, default-off, single-instance-lock contract).
- `bridge-extension`: adds the new `browser` skill to its bundled `pi.skills[]` so every session receives it.
- `browser-visual-debug`: **REMOVED** — superseded by `default-browser-skill`. The repo-local skill and its `.pi/settings.json` `pi-agent-browser` pre-install requirement are deleted; equivalent functionality is delivered to all users on demand.

## Impact

- **Code touched**: `packages/electron/src/main.ts`, `packages/electron/package.json`, `packages/extension/package.json`, `packages/extension/.pi/skills/browser/**` (new), `.pi/skills/browser-visual-debug/**` (deleted), `.pi/settings.json` (remove `pi-agent-browser` requirement if it ends up unused after deletion).
- **Specs touched**: new `openspec/specs/default-browser-skill/spec.md`; delta files for `electron-shell`, `bridge-extension`, `browser-visual-debug` (removal).
- **Dependencies**: no new runtime deps. No new npm package created. Vendored content from `agent-browser` requires license-attribution housekeeping.
- **Installer size**: unchanged. Chrome download (181MB) is *not* triggered — CDP-into-Electron needs no Chrome; non-CDP browser use triggers `agent-browser install` lazily on first invocation.
- **Audience**: every pi-dashboard user worldwide. New `/skill:browser` entry appears in autocomplete. Explicitly chosen during exploration; reversible by removing one entry from `pi.skills[]`.
- **Security**: `--debug-cdp` defaults off, loopback-only, requires explicit opt-in via flag or env. Warning logged on activation. Documented as developer-only.
- **Breaking**: removal of repo-local `browser-visual-debug` skill is a breaking change for any agent or doc that hard-codes the path `.pi/skills/browser-visual-debug/`. Mitigation: the universal `browser` skill covers the same workflows.
