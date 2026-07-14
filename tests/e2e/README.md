# Browser E2E (Playwright)

Browser-level end-to-end QA. Drives a real Chromium against the **Docker test
harness** (`docker/`) on `http://localhost:18000` — an isolated, ephemeral
dashboard that cannot collide with a host dashboard and discards all state each
run.

This layer is **additive** to the VM smoke tests in `qa/` (clean-install +
process runtime across OSes) and to the `site/` Playwright pipeline (marketing
screenshots). It owns rendered-UI behaviour assertions.

## Prerequisites

- **Docker** (running) — the suite boots the `docker/` test container.
- **Chromium for Playwright** — installed automatically. `npm run test:e2e` /
  `npm run test:e2e:ui` run a `playwright install chromium` step first (a
  sub-second no-op once installed). Browsers are NOT vendored.

  If you bypass the npm scripts (e.g. `npx playwright test`, IDE runners, or
  `PW_E2E_USE_RUNNING=1 playwright test`), `globalSetup` fails fast — before the
  container boots — when the browser is missing, with the exact fix:

  ```bash
  npx playwright install chromium
  ```

### Troubleshooting: bundled download fails (CDN timeout)

If `npx playwright install chromium` fails with `Download failure, code=1` /
`TLSSocket … emitRequestTimeout` (proxy, firewall, offline, or a flaky
Playwright CDN), do **not** keep retrying the bundled download. Two escapes:

- **Use the system browser** (preferred when Chrome/Edge is installed) — skips
  the download entirely: `npm run test:e2e:chrome` (= `PW_CHANNEL=chrome
  playwright test`). Same Blink engine, so CDP/WS routing specs still pass. See
  the `PW_CHANNEL` section below.
- **Point at a reachable mirror** when you genuinely need bundled Chromium (CI
  parity, WebKit/Firefox later): `PLAYWRIGHT_DOWNLOAD_HOST=<mirror> npx
  playwright install chromium`.

## Run

```bash
npm run test:e2e        # boot container, run specs, tear down
npm run test:e2e:ui     # same, Playwright UI mode
npm run test:e2e:chrome # same, but use the SYSTEM Google Chrome (no bundled download)
```

### System browser (skip the bundled Chromium download)

`PW_CHANNEL=<chrome|msedge|chromium>` launches the installed browser binary
instead of Playwright's bundled Chromium. `playwright.config.ts` wires the
channel from this env var, and `global-setup.ts` skips the bundled-Chromium
preflight when it is set. `npm run test:e2e:chrome` is the shorthand
(`PW_CHANNEL=chrome playwright test`, no `playwright install` step). CDP / WS
routing specs still work (Chrome is Chromium-based).

Default (managed) lifecycle:

1. `globalSetup` spawns `docker/test-up.sh` from a throwaway workspace dir
   (keeps the overlay off the repo) and waits for `/api/health` → 200
   (up to 180s; first run builds the image).
2. specs run against `:18000`.
3. `globalTeardown` runs `docker/test-down.sh` (`compose down -v`) — all
   ephemeral state discarded, host `~/.pi` byte-identical.

A marker (`test-results/.e2e-managed`) records that setup booted the container
so teardown knows to tear it down even across a crash/retry.

## Fast path — attach to a running container

Skip boot/teardown and target a container you started yourself:

```bash
docker/test-up.sh                       # start once, leave running
PW_E2E_USE_RUNNING=1 npm run test:e2e   # attach, assert :18000 healthy, no teardown
```

`globalSetup` only verifies health; `globalTeardown` is a no-op. You own the
container lifecycle.

## System browser (`PW_CHANNEL`)

By default the suite uses Playwright's **bundled Chromium** (downloaded by the
`pretest:e2e` step, hermetic — what CI runs). To drive a **system-installed**
browser instead, set `PW_CHANNEL` to a Chromium-family channel:

```bash
PW_CHANNEL=chrome  npm run test:e2e   # system Google Chrome
PW_CHANNEL=msedge  npm run test:e2e   # system Microsoft Edge
# also: chrome-beta, chrome-dev, chrome-canary, msedge-beta, ...
```

When `PW_CHANNEL` is set:

- `playwright.config.ts` swaps the single project to `{ channel: PW_CHANNEL }`
  and renames it to the channel (specs show as `[chrome]` instead of
  `[chromium]`).
- `pretest:e2e` self-skips `playwright install chromium` (no download needed).
- `global-setup.ts` skips the bundled-Chromium preflight — Playwright errors
  clearly itself if the named system browser is absent.

Caveats: requires that browser installed on the host; **Chromium-family only**
(WebKit/Firefox still need `playwright install`). Same Blink engine as bundled
Chromium, so rendering/pointer behaviour matches; use it to avoid the download
or to validate against a specific stable Chrome/Edge. Combine with the fast
path: `PW_CHANNEL=chrome PW_E2E_USE_RUNNING=1 npm run test:e2e`.

**Scenario specs need the seed flag in the fast path.** Specs that pin a folder
or spawn a session (e.g. `session-spawn.spec.ts`) require the onboarding gate
cleared and the network guard opened. Managed mode sets `PI_E2E_SEED=1`
automatically; for the fast path, boot the container with it yourself:

```bash
PI_E2E_SEED=1 docker/test-up.sh             # seed fake credential + trust
PW_E2E_USE_RUNNING=1 npm run test:e2e
```

`PI_E2E_SEED=1` makes `docker/test-entrypoint.sh` seed a fake (never-valid)
anthropic OAuth credential — flips `providersReady` so the LandingPage step
CTAs unlock — and seed `trustedNetworks` (RFC1918 private blocks) so the in-container
browser (docker-gateway source IP, non-loopback) clears the network guard for
directory listing / providers. A spawned session registers over the bridge
before any model call, so card-appearance does not depend on key validity.
Without the flag the harness stays UI-only and scenario specs fail at the pin
step.

## Layout

| Path | Purpose |
|------|---------|
| `playwright.config.ts` (repo root) | `testDir: tests/e2e`, `baseURL :18000`, bundled chromium (or `PW_CHANNEL` system browser), global setup/teardown |
| `tests/e2e/global-setup.ts` | Boot container (or verify health in fast path), poll `/api/health` |
| `tests/e2e/global-teardown.ts` | Tear down when managed; no-op in fast path |
| `tests/e2e/lifecycle.ts` | Shared paths, health poll, marker, `PW_E2E_USE_RUNNING` |
| `tests/e2e/smoke.spec.ts` | Wiring proof: shell renders + no disconnect banner |
| `tests/e2e/session-spawn.spec.ts` | Scenario 5.1: pin git fixture → spawn → card appears (authoritative WS round-trip). Needs `PI_E2E_SEED=1`. |
| `tests/e2e/faux-text.spec.ts` | Faux round-trip: `[[faux:plain-text]]` → scripted assistant text renders. Needs `PI_E2E_SEED=1`. |
| `tests/e2e/faux-tool.spec.ts` | Faux round-trip: `[[faux:tool-read]]` → read tool renderer mounts. Needs `PI_E2E_SEED=1`. |
| `tests/e2e/faux-ask.spec.ts` | Faux round-trip: `[[faux:ask-select]]` → interactive select widget mounts. Needs `PI_E2E_SEED=1`. |
| `tests/e2e/tool-output-links.spec.ts` | Faux round-trip: `[[faux:text-difflinks]]` → assistant diff header linkifies; clicking `a/src/ghost.ts` strips the diff prefix (previews `src/ghost.ts`) and FilePreviewOverlay shows the stale-file "no longer exists" message. Needs `PI_E2E_SEED=1`. |
| `tests/e2e/tool-output-selection.spec.ts` | Faux round-trip: `[[faux:text-linkrefs]]` → inline-code FileLink + UrlLink. Asserts `user-select:text` / `draggable=false`, a mouse drag crossing each link extends the selection (links don't hijack the drag), and a plain click still opens the preview. Task 3.2. Needs `PI_E2E_SEED=1`. |
| `tests/e2e/inline-screenshot.spec.ts` | Faux round-trip: `[[faux:tool-screenshot]]` → real `bash` writes a PNG + echoes `Screenshot saved: <path>`; the bridge's `inlineToolResultImages` inlines it as a `type:"image"` block. Asserts an inline `data:image/png` `<img>` is visible (auto-expanded) and the consumed path is NOT linkified (D5). Change: inline-agent-screenshot-artifacts (automates task 4.2). Needs `PI_E2E_SEED=1`. |
| `tests/e2e/editor-pane.spec.ts` | Faux round-trip: `[[faux:tool-read-fixture]]` reads the real fixture `README.md` → `OpenFileButton` body click navigates to `/session/:id/editor` → MarkdownViewer renders the heading; the tree opens `hello.txt` (Monaco text), `logo.png` (ImageViewer `<img>` over `/api/file/raw`), `doc.pdf` (PdfViewer `<object>`); asserts 4 tabs, a concrete (non-transparent) Monaco background (theme inheritance), back-to-chat, and tab restore on re-entry. Binary fixtures `logo.png`/`doc.pdf` live in `docker/fixtures/sample-git/`. Change: add-internal-monaco-editor-pane. Needs `PI_E2E_SEED=1`. |
| `tests/e2e/optimistic-prompt.spec.ts` | Change: optimistic-prompt-progress. (1) IDLE send → optimistic `pending-prompt-card` appears, then confirms with no leftover card. Widens the sub-second window by delaying server→client WS frames via `page.routeWebSocket` (CDP `emulateNetworkConditions` does NOT throttle an open WS). (2) MID-TURN send (during `[[faux:slow-stream]]`, sent with Alt+Enter = followUp) → no optimistic card; `queue-chip-followup` renders. Needs `PI_E2E_SEED=1`. |
| `tests/e2e/flow-roundtrip.spec.ts` | L3: real pi-flows engine + faux agents. Launches the synthetic 2-agent flow; asserts availability gate → `FlowAgentCard` renders → flow completes. Needs `PI_E2E_SEED=1` + `PI_TEST_PEERS=both`. |
| `tests/e2e/anthropic-bridge-activation.spec.ts` | L3: asserts the flows-anthropic-bridge state machine via `/api/health` + `/api/flows-anthropic-bridge/status`. `both` → `active` + `bridgeLoadedFrom: packages[]`; `no-am` (env-gated) → `waiting_peers`. Needs `PI_E2E_SEED=1`. |
| `tests/e2e/subagent-inspector.spec.ts` | L3: `[[faux:subagent-spawn]]` spawns a real subagent; asserts the subagents-plugin inspector surface mounts. Needs `PI_E2E_SEED=1`. |
| `tests/e2e/real-flow-regression.spec.ts` | L3 (opt-in, D5 follow-up): a real flow regression, skipped unless `PI_E2E_REAL_FLOW=<flow-name>` + the flow is baked into the harness. |
| `tests/e2e/helpers/` | `gotoDashboard(page)`, `ensureGitSession(page)`, `sendPrompt(page, text)` + testid→locator map |

## Conventions

- **Select on existing `data-testid`s** (693 already shipped) — never CSS
  classes, translated text, or DOM structure. The testid→locator map lives in
  `helpers/index.ts` so a renamed testid breaks in one place. Do NOT add app
  testids for E2E.
- **Fresh-container determinism**: the harness boots fixtures unpinned with
  ephemeral `~/.pi`. Any workspace-dependent spec must start with a pin-fixture
  arrange step and assume no pre-existing session/folder/VCS root.
- New browser-level scenarios go here as Playwright specs — NOT in
  `qa/tests/*.sh,*.ps1` (those stay CLI/process smoke).

### Faux model round-trip (key-free)

The faux specs drive a real `prompt → model → streamed events → rendered DOM`
round-trip with **no LLM credential**. Under `PI_E2E_SEED=1` the harness stages
pi-ai's scriptable faux provider as a global auto-discovered extension and seeds
`defaultModel: faux/faux-1`, so every UI-spawned session routes to it.

A spec selects its scripted scenario per prompt via a `[[faux:<scenario-id>]]`
**sentinel** prefix, e.g. `sendPrompt(page, "[[faux:tool-read]] go")`. The faux
fixture (`qa/fixtures/faux-provider.ext.ts`) reads the sentinel from the latest
user message and replays the matching scenario from the catalog
(`qa/fixtures/faux-scenarios.ts`); the step within a multi-step scenario is the
count of assistant turns since that message. No sentinel → the `FAUX_SCRIPT` env
fallback. The visible sentinel in the user bubble is inert — assertions select
on the scripted reply, never the echoed prompt.

### Flow-plugin L3 specs + peer-presence variants (`PI_TEST_PEERS`)

The flow / subagent / anthropic-bridge L3 specs need the pi-flows engine + the
anthropic-messages bridge peer present. `docker/test-entrypoint.sh` wires them
per the `PI_TEST_PEERS` selector (requires `PI_E2E_SEED=1`):

| `PI_TEST_PEERS` | Wiring | Bridge outcome |
|---|---|---|
| `both` | pi-flows in `packages[]` + scoped anthropic peer | `active`, `bridgeLoadedFrom: packages[]` |
| `no-am` | pi-flows only; anthropic peer absent | `waiting_peers` (names the missing scoped peer) |
| `legacy` | anthropic peer under the legacy `@pi/anthropic-messages` name only | `active` via legacy fallback (rename-skew guard) |
| `bad-registration` | bridge kept out of `packages[]` (`PI_DASHBOARD_DISABLE_PLUGIN_BRIDGE_PACKAGES_WRITE=1`) | not loaded from `packages[]` ("no sessions reporting") |

The **managed** run defaults to `both` (`global-setup.ts`), so `flow-roundtrip`,
`subagent-inspector`, and the `both` half of `anthropic-bridge-activation` run in
the standard `npm run test:e2e`. The other variants are **opt-in** against a
separately-booted container:

```bash
# Verify a variant's /api/health directly (fast, no browser):
PI_E2E_SEED=1 PI_TEST_PEERS=no-am docker/test-up.sh -d --build
curl -s http://localhost:<port>/api/flows-anthropic-bridge/status | jq

# Or run the env-gated no-am spec against it:
PW_E2E_USE_RUNNING=1 PI_TEST_PEERS=no-am npm run test:e2e -- anthropic-bridge-activation
```

The pi-flows engine + anthropic peer are BAKED into the image (Dockerfile
`npm install -g @blackbelt-technology/pi-flows @blackbelt-technology/pi-anthropic-messages`);
`PI_TEST_PEERS` only selects which get wired at boot. The faux role-preset
(`qa/fixtures/faux-roles.json`) is seeded to `providers.json` so flow agents
using `model: @role` resolve to `faux/faux-1`.

### L1 / L2 run in `npm test`

The L1 probe/reducer unit gaps and the hermetic L2 contract-pinned reducer test
(`packages/flows-anthropic-bridge-plugin/src/__tests__/peer-probe.test.ts`,
`packages/flows-plugin/src/__tests__/flow-reducer-*.test.ts`) are plain vitest —
they run in the standard `npm test` (ci.yml) with NO Docker, browser, or
pi-flows dependency (design D2). Only L3 needs the harness.

## Not run by `npm test`

E2E is opt-in and needs Docker. `npm test` (vitest) does not pick up
`tests/e2e/` — it is outside every vitest project glob.
