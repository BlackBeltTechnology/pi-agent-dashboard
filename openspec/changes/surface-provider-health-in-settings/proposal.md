# Surface provider health (and its error) in Settings → Providers

## Why

Per-provider refresh/connection errors currently only surface inside the model **selector** footer
(`couldn't reach <provider> — showing last known list`). That is the wrong home: the selector is a
model **picker**, the refresh fires on every open, and a persistently-broken provider nags there
forever (which is why the model-selector spec already forbids raising it as a toast). The user
trying to *pick a model* is not the user trying to *fix a provider*.

Meanwhile Settings → Providers — the surface where a provider's key/baseUrl is actually edited —
shows no health at all unless the user clicks **Test**. A provider with a bad key or wrong baseUrl
looks fine until you probe it by hand. The building block already exists: `POST /api/providers/test`
returns `{ ok, status, error, modelCount }` (`packages/server/src/routes/provider-routes.ts`) via
`probeProvider`, and `settings-default-model-without-session` establishes the session-independent
catalogue posture (server-side truth, no live session required).

Sibling `open-empty-model-selector` moves the selector to a thin `⚠ N provider unavailable · ⚙ Providers`
hint (D1-B) that links here. This change builds the destination: a per-provider **health pill** plus
the **verbatim error text**.

## Design mockups

`mockups/selector-decisions.html` (served via `serve_mockup mockups/`, both `data-theme`s):

- **D2** — pill source options; chosen: **auto-probe on save + manual Test** (no panel-open probe,
  no background timer).
- **D3** — Test/pill outcomes: `● Connected · N models` / `⚠ 401` / `✕ Unreachable`, each with the
  raw `error` string rendered on a second line under the row.

## What Changes

- **Health pill per provider (D2).** Each provider row in Settings → Providers SHALL show a health
  pill with three registers: connected (green, with model count), auth/HTTP error (yellow, with the
  status code), unreachable (red). The pill SHALL be sourced from a server-side probe result cached
  per provider — **written on provider save** and **refreshed by the Test button**. There SHALL be
  no probe on panel open and no background polling timer. A provider that has never been probed
  SHALL show a neutral "not tested" register.
- **Verbatim error line (D3).** When a probe result is not `ok`, the row SHALL render the raw `error`
  string returned by `probeProvider` on a second line beneath the pill (monospace), so the actual
  cause (`invalid x-api-key`, `getaddrinfo ENOTFOUND …`) is visible, not just the status code.
- **Cache the last probe result.** The server SHALL persist/serve the last `{ ok, status, error,
  modelCount, testedAt }` per provider so the panel can render health without re-probing on open.
  Provider save SHALL trigger a probe and store its result; the existing `POST /api/providers/test`
  SHALL store its result too.

**Out of scope:**
- The selector-side thin footer + `⚙ Providers` link (owned by `open-empty-model-selector`).
- Changing `probeProvider` semantics or the `/api/providers/test` request contract (only its result
  is now cached).
- Background/periodic health polling (explicitly rejected — D2 option C).

## Capabilities

### Modified Capabilities

- `provider-connection-test`: the Test result is now cached per provider; a provider save auto-probes
  and caches; Settings → Providers renders a health pill (connected/error/unreachable/not-tested)
  from the cached result, with the verbatim `error` string shown on failure.

## Impact

- `packages/server/src/routes/provider-routes.ts` — on provider save (`PUT /api/providers`) run
  `probeProvider` and store the result; store the `POST /api/providers/test` result too; expose the
  cached results (extend the providers GET payload or a small `/api/providers/health` read).
- Server storage: a per-provider health cache `{ ok, status, error, modelCount, testedAt }` (in-memory
  is sufficient; no new persistence file unless one is already used for provider metadata).
- `packages/client/src/components/settings/*` — provider rows render the pill + error line; Test
  button updates the pill from its response; save reflects the new cached health.
- Tests: server route tests for save-probe + cache read (`provider-test-route.test.ts` neighbours);
  client tests for the four pill registers + the error line.
- Additive. No protocol/bridge change. Pairs with `open-empty-model-selector`, which links here.

## Discipline Skills

- `security-hardening` — provider save now triggers an outbound probe with stored credentials;
  confirm no credential/error leakage in the cached payload or logs, and that the health read is
  under the same auth posture as `/api/providers`.
- `review-code` — cross-layer change (server route + client settings) reviewed before commit.
