## 1. Pre-merge verification gates

- [ ] 1.1 Verify upstream `agent-browser` package license — fetch its `LICENSE` or `package.json` `license` field. Confirm it permits vendoring with attribution (MIT/BSD/Apache-2 expected). If non-permissive, halt and re-design Part 2 as docs-pointer only.
- [ ] 1.2 Verify `pi install npm:pi-agent-browser` is the correct install target for Step 0. Confirm the `pi-agent-browser` npm package exists, that installing it registers a `browser` tool in pi sessions, and that this is the user-facing surface we want the skill to recommend. If the published name differs or the integration is broken, fall back to recommending raw `npm install -g agent-browser`.
- [ ] 1.3 Confirm the exact upstream commit/version of `agent-browser` whose `core` and `electron` skill text we will vendor. Record SHA + version + extraction date as the seed for `UPSTREAM.md`.

## 2. Electron CDP debug switch (Part 1)

- [ ] 2.1 Write failing tests for the activation logic. Test matrix: no flag/env → no append; `--debug-cdp` → append with `9222`; `--debug-cdp=9333` → append with `9333`; `PI_DEBUG_CDP=1` → append with `9222`; `PI_DEBUG_CDP=9444` → append with `9444`; both flag + env → flag wins; activation logs `[debug-cdp]` warning to stderr; never appends `remote-debugging-address`.
- [ ] 2.2 Extract a pure helper `resolveCdpActivation(argv, env): { enabled: boolean, port?: number }` so the parse logic is testable in isolation. Place under `packages/electron/src/lib/` per repo convention.
- [ ] 2.3 Wire `resolveCdpActivation` into `packages/electron/src/main.ts` at the top of the file, before `app.requestSingleInstanceLock()` and before any `app.whenReady()`-dependent code. If enabled, call `app.commandLine.appendSwitch('remote-debugging-port', String(port))` and emit the stderr warning.
- [ ] 2.4 Handle the second-instance hook case: when the first instance's `second-instance` listener fires and the second-instance argv contains `--debug-cdp`, log a one-line warning to stderr explaining that CDP enablement requires fully quitting and relaunching.
- [ ] 2.5 Add a repo-lint test that fails the build if `packages/electron/src/**` ever calls `app.commandLine.appendSwitch('remote-debugging-address', ...)`. The promiscuous-bind escape hatch must not exist.
- [ ] 2.6 Add `dev:cdp` npm script to `packages/electron/package.json` invoking the existing dev entry with `--debug-cdp` (exact command depends on existing `start`/`dev` script shape).
- [ ] 2.7 Run the test suite; confirm new tests pass and no existing tests regress.

## 3. Universal `browser` skill (Part 2)

- [ ] 3.1 Create directory `packages/extension/.pi/skills/browser/`.
- [ ] 3.2 Write `packages/extension/.pi/skills/browser/SKILL.md` with frontmatter (`name: browser`, descriptive `description:` covering both web and Electron trigger phrases, `allowed-tools: Bash(agent-browser:*), Bash(npx agent-browser:*)`). Body covers: Step 0 preflight (`command -v agent-browser`) with halt-and-instruct on failure; Step 1 recipe routing (web → references/web.md, Electron → references/electron.md).
- [ ] 3.3 Vendor upstream `agent-browser` `core` skill content into `packages/extension/.pi/skills/browser/references/web.md`. Adapt frontmatter (drop standalone-skill frontmatter; this is a reference file, not a standalone skill).
- [ ] 3.4 Vendor upstream `agent-browser` `electron` skill content into `packages/extension/.pi/skills/browser/references/electron.md`. Adapt the same way as web.md.
- [ ] 3.5 Append a "Worked example: Pi Dashboard" section to `references/electron.md` showing: `open -a "PI Dashboard" --args --debug-cdp` (or env-var equivalent), `agent-browser connect 9222`, `agent-browser tab` listing main/wizard/doctor windows, and `agent-browser screenshot pi-dashboard.png`.
- [ ] 3.6 Write `packages/extension/.pi/skills/browser/UPSTREAM.md` recording source repo URL, commit SHA, `agent-browser` CLI version, refresh date (today).
- [ ] 3.7 Write `packages/extension/.pi/skills/browser/LICENSE` reproducing the upstream `agent-browser` license notice as required by attribution.
- [ ] 3.8 Update `packages/extension/package.json`:
  - Add `.pi/skills/browser` to `pi.skills[]` array.
  - Add `.pi/skills/browser/` to `files[]` array.
- [ ] 3.9 Write a test under `packages/extension/__tests__/` (or wherever extension tests live) asserting the skill files exist and that `package.json` declares the skill in both `pi.skills` and `files`.
- [ ] 3.10 Verify by building the extension package locally (`npm run build -w @blackbelt-technology/pi-dashboard-extension` or equivalent) that the skill directory appears in the resulting tarball — run `npm pack` and inspect.

## 4. Repo-local skill removal (Part 3)

- [ ] 4.1 Migrate `.pi/skills/browser-visual-debug/scripts/detect-dashboard.sh` into `packages/extension/.pi/skills/browser/scripts/detect-dashboard.sh` (or merge its content into a reference doc, whichever fits the universal skill's structure better). Update `references/web.md` to document the script's invocation.
- [ ] 4.2 Migrate `.pi/skills/browser-visual-debug/references/dashboard-recipes.md` content into the universal skill's references (web.md or a dedicated dashboard.md). Avoid duplicating content already covered by vendored `core` material.
- [ ] 4.3 Migrate `.pi/skills/browser-visual-debug/references/responsive-testing.md` content into the universal skill's references (append to web.md or as `references/responsive.md`).
- [ ] 4.4 Migrate any unique content from `.pi/skills/browser-visual-debug/references/commands-cheatsheet.md` into the universal skill — merge with vendored `core` content rather than duplicating.
- [ ] 4.5 Delete `.pi/skills/browser-visual-debug/` entirely.
- [ ] 4.6 Remove `"npm:pi-agent-browser"` from this repo's `.pi/settings.json` `packages` array if present. (Verify no other code path depends on it being pre-installed in this repo's session.)
- [ ] 4.7 Search the repo for any remaining references to `browser-visual-debug` — README, AGENTS.md, docs/, file-index splits — and either update to point at the new universal skill or remove. Use `grep -rn "browser-visual-debug" --include='*.md' --include='*.json' --include='*.ts'`.

## 5. Documentation updates

- [ ] 5.1 Per AGENTS.md "Documentation Update Protocol", route per-file additions for the new skill files into the appropriate `docs/file-index-<area>.md` split (likely `docs/file-index-extension.md` for `packages/extension/.pi/skills/browser/**`, and `docs/file-index-electron.md` for the new `packages/electron/src/lib/resolve-cdp-activation.ts` helper). Delegate to a subagent per the protocol.
- [ ] 5.2 Add a one-line entry to AGENTS.md "Key Files" backbone if (and only if) the new files qualify as architectural backbone. Otherwise leave AGENTS.md unchanged.
- [ ] 5.3 If `.pi/skills/browser-visual-debug/` was referenced in `docs/file-index-skills-misc.md` (or equivalent split), remove those rows. Delegate per protocol.
- [ ] 5.4 Update `packages/electron/README.md` (or repo README if there's no per-package README) with a short section documenting `--debug-cdp` / `PI_DEBUG_CDP` and the `dev:cdp` script — including the single-instance-lock contract ("must fully quit and relaunch to enable CDP").

## 6. Build and verification

- [ ] 6.1 Run `npm test` repo-wide; tee to `/tmp/pi-test.log`; grep for failures per AGENTS.md conventions. All tests SHALL pass.
- [ ] 6.2 Build the client (`npm run build`) and restart the dashboard server (`curl -X POST http://localhost:8000/api/restart`). Confirm no startup errors in `~/.pi/dashboard/server.log`.
- [ ] 6.3 Reload all connected pi sessions (`npm run reload`). In a fresh session, verify `pi.getCommands()` (or `/skill:` autocomplete) shows the `browser` skill.
- [ ] 6.4 Open the Electron app via `npm run dev:cdp` in `packages/electron`. Confirm the stderr warning line appears; from a separate shell run `agent-browser connect 9222` and `agent-browser tab`; verify the list includes the main dashboard window.
- [ ] 6.5 Run `openspec validate ship-browser-skill-and-electron-cdp` — passes cleanly.

## 7. Manual sanity gates before archive

- [ ] 7.1 Launch the production-built Electron app (not the `dev:cdp` script) and confirm CDP is NOT enabled (no `[debug-cdp]` line in stderr, port 9222 not listening).
- [ ] 7.2 Confirm the `browser` skill's Step-0 preflight behaves correctly in a session where `agent-browser` is NOT installed — the skill emits the install instruction and halts, no side effects.
- [ ] 7.3 Confirm the universal skill's electron-recipe worked example, when executed against a CDP-enabled Pi Dashboard app, produces a valid screenshot.
