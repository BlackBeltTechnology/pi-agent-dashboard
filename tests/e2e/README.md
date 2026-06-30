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

## Run

```bash
npm run test:e2e        # boot container, run specs, tear down
npm run test:e2e:ui     # same, Playwright UI mode
```

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

## Not run by `npm test`

E2E is opt-in and needs Docker. `npm test` (vitest) does not pick up
`tests/e2e/` — it is outside every vitest project glob.
