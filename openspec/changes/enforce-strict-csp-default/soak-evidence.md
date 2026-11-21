# Soak evidence — enforce-strict-csp-default

Evidence for tasks 1.1–1.7. Fill each section, then tick the task in `tasks.md`.
Gate rules: proposal.md § Soak gate. Helper: `soak/csp-soak.mjs` (snapshots land beside it in `soak/`). Commands below assume the repo root and:

```bash
SOAK=openspec/changes/enforce-strict-csp-default/soak/csp-soak.mjs
node --test openspec/changes/enforce-strict-csp-default/soak/csp-soak.test.mjs   # helper self-test
```

Status: **1.1 done; window NOT opened — blocking finding 2026-11-21** (see § Blocking finding: report delivery). 1.2 must wait for a release that fixes browser report delivery.

**Gate override (2026-11-16, operator "go on"):** groups 2–5 code was written on this branch BEFORE 1.7. The soak gate still governs: do NOT merge / ship until 1.2–1.7 are recorded here and pass. If the soak finds a blocking violation, its fix lands first and this branch rebases.

---

## 1.1 Release precondition

```bash
git tag --contains f426a45b5
```

| Field | Value |
|---|---|
| Open tag | `v0.11.0` (only tag; `git tag --contains f426a45b5` checked 2026-11-16) |
| Tag date | 2026-10-26 19:00:29 +0100 |

## 1.2 Window open (canary, reset)

Install runs the open tag, `PI_DASHBOARD_CSP` unset (`report` mode).

```bash
node $SOAK snapshot canary-open        # baseline before the canary
# pi-dashboard open → DevTools console:
#   document.body.append(Object.assign(document.createElement("script"), { textContent: "void 0" }))
# wait >= 5 s
node $SOAK canary canary-open          # must print "OK: report pipeline delivers"
node $SOAK reset                       # writes soak/open.json, must print "OK: window open"
```

| Field | Value |
|---|---|
| Install (host, tunnel-exposed?) | |
| `serverVersion` (= open tag without `v`) | |
| CSP mode (DevTools on `/`: two `…-Report-Only` headers = `report`) | |
| TT mode (`<meta name="pi-trusted-types">`) | |
| Canary delta (`canary` output) | |
| Reset time / `since` | |
| Counts after reset all zero | |

## 1.3 Exercise checklist

Each run: load the dashboard and open a session; render a runtime plugin claim; open a diagram / editor surface; load the passkey login page.

| When | Date | Browsers | All four done? | Notes |
|---|---|---|---|---|
| Open | | | | |
| Mid-window (~day 7) | | | | |
| Close | | | | |

Mid-window peek (optional, any day): `node $SOAK snapshot day-NN`

## 1.4 Window close

Install upgraded during the window to a later tag containing `f426a45b5`. ≥14 consecutive days since 1.2.

```bash
node $SOAK snapshot close              # BEFORE the closing canary
node $SOAK check --open-tag <open tag> --close-tag <close tag> [--exclusions openspec/changes/enforce-strict-csp-default/soak/exclusions.json]
node $SOAK snapshot canary-close
# DevTools inline script as in 1.2, wait >= 5 s
node $SOAK canary canary-close
```

`soak/exclusions.json` (only for triaged, signed-off violations; reason mandatory):

```json
[
  { "directive": "connect-src", "count": 2, "reason": "switcher flow: known-server switch from / (path /)" },
  { "directive": "script-src-elem", "count": 1, "reason": "extension-only: <extension>, absent in clean profile (path /settings)" }
]
```

| Field | Value |
|---|---|
| Close tag / date | |
| `serverVersion` (= close tag without `v`) | |
| Days in window | |
| TT mode (unchanged from 1.2?) | |
| `check` verdict (PASS / BLOCKED + failures) | |
| Per-document breakdown reviewed (`soak/close.json` → `documents.strict`) | |
| Exclusions applied (with triage notes) | |
| Closing canary delta | |

## 1.5 Enforce-lane E2E (from a checkout of the close tag)

```bash
git worktree add /tmp/escd-close <close tag> && cd /tmp/escd-close && pnpm install
PI_DASHBOARD_CSP=enforce PI_E2E_SEED=1 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/escd-enforce.json \
  npx playwright test --reporter=blob,json
```

| Spec | Failure | Classification (expected report-lane / blocking) |
|---|---|---|
| | | |

Summary (passed / failed / skipped):

## 1.6 Operator sign-off

- Contributing installs (sample accepted):
- Cross-origin switcher breakage accepted (WS ticket, pairing, rotation, known-server switch, REST incl. plugin fetches, images, dashboard-served `VITE_API_URL` builds): yes / no
- Exclusions from 1.4:
- Expected report-lane failures from 1.5:
- Signed: <name>, <date>

## 1.7 Doubt-driven review of this evidence

- Verdict:
- Accepted findings:
- Date:

---

## Blocking finding: report delivery (2026-11-21)

Opening canary on this Mac (`v0.11.0`, `report`, `http://localhost:8000`, tunnel configured but `zrok share` failing) **failed**: no browser report ever reaches the server.

- Baseline snapshot `soak/canary-open.json`: `since` 2026-10-25T13:27:14Z, counts `baseline` / `strict` / `trusted-types` all `{}` — zero browser reports in ~4 weeks of daily use, while the in-page TT shadow counted `would-alter-html` 34346.
- Canary from an authorized headless Chromium (Playwright 151) and Google Chrome 157 (headless): console shows the violation; CDP `Network.reportingApiReportUpdated` → `csp-strict` `Pending` → `Queued`, never sent (watched 75 s / 131 s). Strict count +0.
- Endpoint itself works: direct `POST /__pi/csp-report/strict` (`application/reports+json`) → 204, counted (+1 — synthetic, NOT a canary; cleared by the eventual reset).
- Isolation (Chrome 157, local test server): header shape `report-uri` + `report-to` + `Reporting-Endpoints` → nothing delivered in 90 s (Chrome uses `report-to`, ignores `report-uri`); `report-uri` only → delivered immediately as `application/csp-report`.

Consequence: on plain-`http` installs Chromium never delivers, so a soak would read zero regardless of breakage — the gate cannot produce evidence. Fix (separate change, lands on develop first): make violation reports actually arrive (e.g. drop `report-to` / `Reporting-Endpoints`, or emit them only on `https`), keep both endpoints counted. Then cut a release containing `f426a45b5` + the fix, open the window on it (1.1 re-recorded with that tag), and rebase this branch.

## Window restarts

A changed `since`, a changed TT mode, a silent canary, or any blocking non-zero restarts the window from 1.2. Log each restart:

| Date | Reason | Fix / change |
|---|---|---|
| | | |
