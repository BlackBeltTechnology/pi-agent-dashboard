## Context

The dashboard ships as an Electron app (`packages/electron`) which embeds the dashboard web client and orchestrates the dashboard server. Today the Electron shell exposes no Chrome DevTools Protocol (CDP) port, so neither QA automation nor agent-driven debugging can attach to the *installed app* — they can only point a separate Chrome at `http://localhost:8000`, which tests the web UI but not the Electron-specific surfaces (tray, native menus, IPC, wizard window, doctor window).

Separately, the repo carries a `.pi/skills/browser-visual-debug/` skill that teaches agents how to use the `agent-browser` CLI for visual verification. Because it lives at the repo root, only sessions inside this repo see it. Every other pi-dashboard user has to discover the CLI on their own and figure out the workflow from scratch.

Upstream `agent-browser` ships well-crafted skills (`core`, `electron`) inside its npm package, but those skills are only visible to pi sessions that have installed the CLI — a chicken-and-egg problem when the agent first encounters a task that needs them.

The pi extension API already supports bundled skills: a pi extension's `package.json` declares `pi.skills[]` and pi auto-registers everything at session start. The dashboard's bridge extension (`packages/extension`) already uses this for the `pi-dashboard` skill. Adding another skill is mechanically a drop-in.

## Goals / Non-Goals

**Goals:**
- Allow attaching `agent-browser` (or any CDP-speaking client) to the running Pi Dashboard Electron app, by explicit developer opt-in only.
- Surface a single universal `browser` skill to every dashboard session that teaches agents both web automation and Electron-app automation via `agent-browser`.
- Avoid bundling the `agent-browser` CLI (or its 181 MB Chromium download) inside the dashboard installer. Skill self-bootstraps with install instructions when the CLI is missing.
- Replace the repo-local `browser-visual-debug` skill with the universal one. Migrate its valuable recipes; remove the spec.
- Keep CDP off for end users. No production-mode CDP. No promiscuous binding.

**Non-Goals:**
- Bundling `agent-browser`, `pi-agent-browser`, or Chromium inside the Electron installer.
- Triggering `agent-browser install` (Chrome download) automatically. Lazy on-demand only.
- Driving the Electron app via anything other than its existing Chromium CDP surface (no Playwright Electron driver, no custom IPC RPC for automation).
- Auto-installing `pi-agent-browser` into user pi sessions. The skill instructs the user; the user decides.
- Building a QA test harness around the CDP surface. (Possible follow-up, deliberately out of scope here.)
- Shipping the niche agent-browser skills (`slack`, `exploratory`, `cloud`). Out of scope.

## Decisions

### Decision 1 — Activation surface for the CDP debug switch

**Choice**: Two equivalent activation paths, both opt-in:
- CLI flag: `--debug-cdp` (default port 9222) or `--debug-cdp=<port>`
- Env var: `PI_DEBUG_CDP=1` (port 9222) or `PI_DEBUG_CDP=<port>`

Precedence: CLI flag wins if both present.

**Why not `--remote-debugging-port` directly**: that's Chromium's flag name and implies "this is a Chromium thing, always available." Our flag name surfaces *intent* ("this is a debug-only opt-in for Pi Dashboard") and lets us add policy (loopback enforcement, warning log, single-instance handling) without confusing flag semantics.

**Alternative considered**: env-only. Rejected because CLI flag is easier to discover from `--help` and easier to wire into the `dev:cdp` npm script.

### Decision 2 — Where in main.ts the switch is appended

**Choice**: At top of `main.ts`, before any other Electron API call that materializes Chromium state. Specifically, before the single-instance lock acquisition and before `app.whenReady()`.

**Why**: Chromium reads `remote-debugging-port` during browser initialization. Setting it after `app.whenReady()` resolves is a no-op. The single-instance lock contract (Decision 4) reinforces this — the second instance's argv handoff happens after the first instance is already past initialization.

### Decision 3 — Loopback-only, never promiscuous

**Choice**: Append only `remote-debugging-port`. Never `remote-debugging-address`. Chromium defaults the address to `127.0.0.1`, which is what we want.

**Why**: Exposing CDP on `0.0.0.0` turns local-debug into a remote RCE on any LAN. We never want a flag that does that. If a user wants remote CDP, they can SSH-tunnel localhost:9222 — that's their explicit decision, not ours by default.

### Decision 4 — Single-instance-lock contract

**Choice**: Document and enforce: "to enable CDP, you must fully quit the running app and relaunch with the flag." When the second-instance hook fires with `--debug-cdp` in argv but the first instance was launched without it, log a one-line warning to the first instance's stderr explaining the contract. Do not attempt to enable CDP retroactively.

**Why**: Chromium stands up its CDP HTTP server during browser-process initialization. There is no Electron API to enable it later. Pretending we can would silently fail. Surfacing a clear warning is the honest path.

**Alternative considered**: making `--debug-cdp` skip the single-instance lock (start a fresh process). Rejected — that breaks the dashboard's session-singleton invariant.

### Decision 5 — Skill name `browser` (composite, single entry)

**Choice**: One skill directory `packages/extension/.pi/skills/browser/`, frontmatter `name: browser`, with internal recipes in `references/web.md` and `references/electron.md`.

**Why**:
- One entry in `/skill:` autocomplete keeps the user-facing surface tight.
- `browser` matches the tool name registered by `pi-agent-browser` extension — consistent vocabulary.
- The composite shape lets us include common preflight (Step 0: `command -v agent-browser`) without repeating it.

**Alternative considered**: separate `browser-web` and `browser-electron` skills. Rejected — more autocomplete noise, duplicated preflight, no real benefit since recipes share 90% of their mechanics.

**Collision risk**: a user with their own `.pi/skills/browser/` in their project would shadow this one. That's pi's local > extension precedence behavior, and is correct: user choice wins.

### Decision 6 — Vendor the skill markdown, do not link

**Choice**: Copy `agent-browser`'s `core` and `electron` skill text into `packages/extension/.pi/skills/browser/references/`, adapt for the composite shape, and record provenance in `UPSTREAM.md`.

**Why**:
- Linking (depending on the `agent-browser` npm package and pointing `pi.skills[]` into `node_modules/`) is uncertain — pi's resource scanner may not resolve node_modules-relative skill paths. Verifying that and adopting a less-tested pattern is more work than vendoring a few markdown files.
- Vendoring decouples skill content from CLI version. Upstream CLI updates don't silently change what every dashboard user sees in their skill list.
- Drift is mitigated by `UPSTREAM.md` (records source repo + commit + CLI version + refresh date), making "is this stale?" a mechanical check.

**Alternative considered**: hybrid (vendor markdown, depend on package for the CLI). Rejected — we explicitly do NOT bundle the CLI (Decision 8), so there's no benefit to taking the dep.

### Decision 7 — License & attribution

**Choice**: Verify `agent-browser`'s upstream license before merging. If MIT or similar permissive, reproduce the upstream copyright notice in `packages/extension/.pi/skills/browser/LICENSE`. If non-permissive (unexpected), vendoring is blocked and we redesign as either a link or a docs-only pointer.

**Why**: vendoring third-party content without attribution is sloppy regardless of license; a permissive license still requires the notice. This is a pre-merge gate, not a runtime concern.

### Decision 8 — No CLI bundling; skill self-bootstraps

**Choice**: The skill's `SKILL.md` performs `command -v agent-browser` as Step 0. If missing, the skill stops and instructs the user to run `pi install npm:pi-agent-browser`. No automatic install.

**Why**:
- Bundling adds install footprint for users who never invoke the skill.
- Auto-install would trigger network access from the bridge extension's startup path — not something the bridge should do unsolicited.
- `pi install npm:pi-agent-browser` is the right install target (not raw `agent-browser`) because the `pi-agent-browser` extension registers the `browser` tool with pi's tool registry, integrating cleanly with the rest of the agent's toolset.

### Decision 9 — Replace, don't keep, the repo-local skill

**Choice**: Delete `.pi/skills/browser-visual-debug/` entirely. Migrate dashboard-specific recipes (responsive testing, command cheatsheet, dashboard URL detection script) into the new universal skill where they benefit all users.

**Why**:
- Keeping both means two overlapping entries in `/skill:` autocomplete in this repo, which is confusing.
- The repo-local skill's `.pi/settings.json` `pi-agent-browser` pre-install requirement (forcing every developer of this repo to install the package even if they never use it) is replaced by on-demand install via the new skill's Step 0 — strictly better.
- Removing the `browser-visual-debug` capability spec keeps the spec set lean.

**Alternative considered**: keep repo-local as a "deep" variant. Rejected — the universal skill should be at least as useful as the repo-local one was. If we keep both, the universal one will atrophy.

### Decision 10 — Worked example in `electron.md` references Pi Dashboard

**Choice**: The Electron recipe doc includes a concrete worked example of attaching to `Pi Dashboard.app` via `--debug-cdp`. This is the narrative link that justifies bundling Parts 1 + 2 in one proposal.

**Why**: Every other Electron app's CDP workflow is the same flag mechanic, but using *our own app* as the worked example dogfoods the skill against the binary the user is most likely to actually have installed.

## Risks / Trade-offs

[Risk] CDP flag accidentally left on in a release build → user-installed Pi Dashboard ships with a CDP port open by default, gigantic security hole.
→ Mitigation: default is OFF. Activation requires explicit flag or env. Add a build-time test that asserts `app.commandLine.appendSwitch('remote-debugging-port', ...)` is not unconditionally called. Add a startup log line whenever CDP is enabled, so the user can see it.

[Risk] Single-instance-lock UX surprise — user passes `--debug-cdp` to an already-running app, nothing happens, they're confused.
→ Mitigation: second-instance hook logs a warning explaining "fully quit and relaunch to enable CDP." Documented in skill's `electron.md` recipe.

[Risk] Vendored skill drifts from upstream `agent-browser` behavior, agent gets wrong instructions.
→ Mitigation: `UPSTREAM.md` records the exact commit + version + date. Skill content is small (a few dozen lines per recipe) and the upstream API surface is stable. Refresh is a manual periodic task; no automation needed.

[Risk] Defaulting a `browser` skill to every dashboard user creates noise for users who never automate browsers.
→ Mitigation: explicitly accepted during exploration. Skill is one entry in `/skill:` autocomplete, opt-in to use. Reversible by removing one entry from `pi.skills[]`.

[Risk] Pre-merge license verification finds `agent-browser` is not permissively licensed.
→ Mitigation: gate is in tasks.md. If verification fails, the proposal is paused and we fall back to a docs-only pointer (cite the upstream skill, do not reproduce it) — degraded but not blocked.

[Risk] `pi-agent-browser` install target turns out wrong (e.g., the published name differs, or it doesn't actually register the `browser` tool the way we expect).
→ Mitigation: verification is in tasks.md. If wrong, Step 0 of the skill instructs the user to install raw `agent-browser` instead.

[Risk] `/skill:browser` collides with a user's own local skill named `browser`.
→ Mitigation: pi's local > extension precedence handles this correctly (user wins). No code change needed; documented as expected behavior in the skill.

[Risk] Removing `browser-visual-debug` skill breaks any external doc or agent prompt that references the path `.pi/skills/browser-visual-debug/`.
→ Mitigation: this repo is the only place that references it (verified). External docs (README, file-index) updated as part of tasks. The new skill description carries the same trigger phrases, so agent skill-auto-loading continues to work.

## Migration Plan

1. Land Part 2 (bridge ships `browser` skill) first — additive, low risk.
2. Land Part 1 (`--debug-cdp` in main.ts) in the same change but as a separable commit — easy rollback.
3. Land Part 3 (delete repo-local skill, remove its spec) last — it's the destructive step and only safe once the replacement is in place.

Rollback: if the universal skill is wrong, remove its path from `packages/extension/.pi/skills/` and `pi.skills[]`. If `--debug-cdp` causes problems, revert the main.ts hunk.

## Open Questions

- **`pi-agent-browser` vs `agent-browser` as install target**: pre-merge verification (tasks.md item).
- **Skill description phrasing for auto-trigger heuristic**: needs at least one round of tuning against real agent usage. Initial draft will use the trigger phrases from upstream's `electron` skill plus general web-automation phrases.
- **Where the warning log goes when single-instance second-instance hook sees `--debug-cdp` on argv**: currently planned for the first instance's stderr. Open question: does that surface anywhere visible to the user, or do we also need a system notification? Decision deferred until tasks reveal whether stderr is plausibly seen.
