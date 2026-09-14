# Test Plan — mcp-legacy-clients-and-token-issuance

Stage: design   Generated: 2026-08-20

Clarifications resolved before writing (folded into specs/design): label limit
= 64 UTF-8 bytes; `AmbiguousHeader` → `400`; `notifications/*` prefix wins over
a stray `id`.

Harness note: L1 rows for `/mcp` reuse the fastify-inject fixture in
`packages/mcp-server-plugin/src/server/__tests__/routes.test.ts` (real
`PairedDeviceRegistry` on a temp path where a device bearer is needed). L3 rows
read the docker harness port from `.pi-test-harness.json` (`dashboardPort`),
never `:18000`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Dual-era: version resolution | decision-table | L1 | automated | table over method ∈ {initialize, tools/list, subscriptions/listen} × header ∈ {absent, 2025-03-26, 2025-06-18, 2025-11-25, 2026-07-28, 1999-01-01, ["a","b"]} × `_meta` ∈ {absent, {progressToken}, {version:2026-07-28}, {version:2025-06-18}} | `resolveProtocolVersion(method, headers, params)` | every cell yields the D1-rule result: `{era,version}` or the named failure code; no cell throws; cells (absent, absent∣progressToken-only, non-initialize) → `{legacy, 2025-03-26}`; (["a","b"], any, any) → `AmbiguousHeader`; (absent, {version:2026-07-28}) → `MissingHeader`; (2026-07-28, absent) → `MissingMeta` |
| E2 | Legacy initialize answered | EP | L1 | automated | POST `/mcp`, valid device bearer, body `initialize` with `params.protocolVersion` ∈ {2025-03-26, 2025-06-18, 2025-11-25}, no version header | request | 200; `result.protocolVersion` equals the input; `result.capabilities` deep-equals `{tools:{listChanged:false}}` (no `subscriptions`/`resources` keys); `result.serverInfo.name` non-empty string; response header `mcp-session-id` matches `/^[0-9a-f]{32}$/` |
| E3 | Initialize negotiates down | BVA | L1 | automated | `initialize` with `params.protocolVersion: "2027-01-01"` | request | 200; `result.protocolVersion === "2025-11-25"`; body has no `error`; `mcp-session-id` header present |
| E4 | Initialize without version refused | EP | L1 | automated | `initialize` with `params: {}` and `initialize` with `params.protocolVersion: 42` | request | JSON-RPC error with `data.type === "UnsupportedProtocolVersion"`; `error.message` contains all four revision strings; no `mcp-session-id` header |
| E5 | Modern era refuses handshake | EP | L1 | automated | (a) `initialize` with `params.protocolVersion: "2026-07-28"`; (b) `ping` and (c) `notifications/initialized` each with header+`_meta` = 2026-07-28 | request | each → HTTP 404, `error.code === -32601`; no `mcp-session-id` header on any |
| E6 | Legacy notifications accepted | EP | L1 | automated | header 2025-06-18; methods `notifications/initialized`, `notifications/cancelled`, `notifications/zzz`; one variant carrying `"id": 7` | request | HTTP 202; response body length 0 for all four |
| E7 | Legacy ping | EP | L1 | automated | header 2025-06-18, `{"jsonrpc":"2.0","id":1,"method":"ping"}` | request | 200; `result` deep-equals `{}` |
| E8 | Legacy tools calls = modern | EP | L1 | automated | same `tools/list` and one `tools/call` (`server/discover`) sent twice: (a) header 2025-06-18 no `_meta`; (b) header+`_meta` 2026-07-28 | both requests | `result` bodies deep-equal after stripping nothing (identical); (a) carries no `mcp-session-id` header |
| E9 | Discover lists every served revision | EP | L1 | automated | `tools/call server/discover` (modern) | request | `result` protocol-versions array deep-equals `["2025-03-26","2025-06-18","2025-11-25","2026-07-28"]` (order as `SUPPORTED_PROTOCOL_VERSIONS`) |
| E10 | Unknown session id still works | EP | L1 | automated | header 2025-06-18, `Mcp-Session-Id: deadbeef`, `tools/list` | request | 200 with `result.tools` array; status is not 404 |
| E11 | Modern ignores session id | EP | L1 | automated | header+`_meta` 2026-07-28, `Mcp-Session-Id: deadbeef`, `tools/list` | request | 200; no `mcp-session-id` response header |
| E12 | Listen subject to version resolution | decision-table | L1 | automated | `subscriptions/listen` `sessionIds:["s1"]` with (a) header 2026-07-28 no `_meta`; (b) header 1999-01-01; (c) header 2026-07-28 + `_meta` 2025-06-18; (d) header 2025-06-18 | request with streaming deps wired | (a) `MissingMeta` error, (b) `UnsupportedProtocolVersion`, (c) 400 `HeaderMismatch`, (d) 404 `-32601`; in all four the stream-subscribe spy is never called |
| E13 | Direct issuance: label BVA | BVA | L1 | automated | `POST /api/paired-devices` from loopback, `label` ∈ {"" , " ", "a", "x"×64, "x"×65, "é"×32 (64 bytes), "é"×33 (66 bytes), 123, absent} | request | "" / " " / 65 / 66-byte / 123 / absent → 400 and registry file row count unchanged; "a" / 64 / "é"×32 → 200, `data.token` string ≥ 32 chars, `data.device.source === "manual"`, `data.device.label` equals trimmed input |
| E14 | Mint token reaches /mcp as device | EP | L1 | automated | token from a `registry.add("cli","manual")` on a temp registry | `POST /mcp tools/list` with `Authorization: Bearer <token>` | 200 with `result.tools`; caller resolved `kind:"device"` (assert via a tool that echoes caller kind or the auth helper directly) |
| E15 | Registry row without source | EP | L1 | automated | `paired-devices.json` pre-written with one row lacking `source` | `new PairedDeviceRegistry(path).list()` and `.verify(token)` | list row `source === "pairing"`; `verify` returns the row; after `add()` the file's old row now contains `"source":"pairing"` |
| E16 | Mint response envelope | EP | L1 | automated | valid mint | request | body deep-shape `{success:true, data:{device:{id,label,createdAt,lastSeen,source}, token}}`; `data.device` has no `tokenHash`; subsequent `GET /api/paired-devices` row for that id has no `token`/`tokenHash` |

### Performance

No new latency/throughput/memory requirement introduced; the slow-consumer
bound on `subscriptions/listen` is pre-existing and unchanged. None.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Settings offers MCP-client token flow — snippet copy-ready | state-transition | L3 | automated | harness dashboard, Settings → Paired Devices | click "Create token for an MCP client", type `claude-code`, submit | a code element appears whose text matches `/^claude mcp add --transport http \S+ https?:\/\/[^/]+\/mcp --header "Authorization: Bearer [A-Za-z0-9_-]{32,}"$/` and whose host equals `page.url()` origin; a separate token element's text equals the bearer inside the snippet |
| F2 | Token is not shown again | state-transition | L3 | automated | F1 result panel open | click dismiss | `page.getByText(<token>)` count 0; `document.body.innerText` does not contain the token; list now has one more row labelled `claude-code` with a "manual" badge; `GET /api/paired-devices` (harness port) has a row `label==="claude-code", source==="manual"` |
| F3 | Manual rows revocable | state-transition | L3 | automated | F2 state | click revoke on the `claude-code` row, confirm | row gone; `POST /mcp tools/list` with the F1 token → 401 |
| F4 | Pairing rows unchanged | EP | L1 | automated | `PairedDevicesSection` rendered with rows `[{source:"pairing"},{source:"manual"}]` (mock API) | render | exactly one "manual" badge in the DOM; both rows have a revoke control |
| F5 | Create-token API helper | EP | L1 | automated | mocked `fetch` | `createPairedDevice("cli")` | `fetch` called once with `POST`, URL ending `/api/paired-devices`, JSON body `{label:"cli"}`; resolves to `{device, token}` unwrapped from `data` |
| F6 | Snippet works in a real client | visual/subjective | — | manual-only | minted token | paste snippet into `claude mcp add`, run `claude mcp list` / one tool call | [judgment: needs a Claude Code install on the operator machine — no automatable observable in this repo] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Legacy authenticated identically | EP | L1 | automated | no `Authorization` header; invalid bearer | `initialize` 2025-06-18; `ping`; `notifications/initialized` | 401 each, `www-authenticate: Bearer`, no `mcp-session-id` header |
| X2 | Session id does not carry auth | state-transition | L1 | automated | valid `initialize` → captured `mcp-session-id` | `tools/list` with that `Mcp-Session-Id` and no `Authorization` | 401 |
| X3 | Ambiguous header refused | EP | L1 | automated | two `MCP-Protocol-Version` headers (`2025-06-18`, `2026-07-28`) | `tools/list`; and `initialize` with valid `params.protocolVersion` | 400 both, `data.type === "AmbiguousHeader"`; no `mcp-session-id` on the initialize |
| X4 | Paired device cannot clone itself | EP | L1 | automated | request whose only credential is a valid device bearer (`Authorization: Bearer`), from a non-loopback address (`127.0.0.1` with `x-forwarded-for: 203.0.113.9`) | `POST /api/paired-devices {label:"clone"}` | 401; registry row count unchanged |
| X5 | Trusted network alone cannot mint | EP | L1 | automated | auth disabled, `trustedNetworks: ["10.0.0.0/8"]`, remote address `10.1.2.3`, no credential | `POST /api/paired-devices` | 401; `GET /api/paired-devices` from the same address → 200 (proves the sibling route still admits it, i.e. the refusal is the operator guard) |
| X6 | Unadmitted Host refused in report mode | EP | L1 | automated | host gate mode `report`, loopback caller, `Host: attacker.example:8000`, `Origin: http://attacker.example:8000` | `POST /api/paired-devices` | 403; registry row count unchanged; `GET /api/paired-devices` with the same Host → 200 (global gate really is report-only) |
| X7 | Local browser mints with auth on | EP | L1 | automated | auth enabled (OAuth configured), loopback, no cookie, `Host: localhost:8000` | `POST /api/paired-devices {label:"lb"}` | 200 with token |
| X8 | Local token mints from non-loopback | EP | L1 | automated | valid `X-Pi-Local-Token`, `x-forwarded-for: 203.0.113.9` | `POST /api/paired-devices` | 200 with token |
| X9 | Mint route not a public prefix | EP | L1 | automated | auth enabled, remote address, no credential | `POST /api/paired-devices` | 401 (not 200, not 403 from the pairing-public path) |
| X10 | Malformed legacy payloads never 500 | EP | L1 | automated | header 2025-06-18; bodies: `not json`, `[]`, `{"jsonrpc":"2.0"}` | request | JSON-RPC parse / invalid-request error; status ≠ 500; no `unhandledRejection` (process listener spy) |
| X11 | Modern strictness regression guard | EP | L1 | automated | existing E13/E14/E15 fixtures in `protocol.test.ts` | rerun | E13 (`2026-07-28` header, no `_meta`) and E14 still refuse; E15 rewritten: (`_meta` 2026-07-28, no header) → `MissingHeader` |

---

## Coverage summary

- Requirements covered: 6/6 (Dual-era endpoint · Legacy auth parity · Event streaming (modified) · Long-lived tokens (modified) · Direct issuance · Settings flow)
- Scenarios by class: edge 16 · perf 0 · frontend 6 · error 11
- Scenarios by level: L1 28 · L2 0 · L3 3 · — 1
- Scenarios by disposition: automated 32 · manual-only 1

## New infra needed

- none. `/mcp` L1 rows reuse the `routes.test.ts` inject fixture; mint-route L1
  rows reuse the fastify-inject + temp-registry pattern of
  `packages/server/src/__tests__/pairing.test.ts`; L3 rows extend the
  `tests/e2e/pairing-qr.spec.ts` harness glue (real registry, `request` API
  context) plus a Settings page navigation as in
  `tests/e2e/mcp-client-settings-a11y.spec.ts`.
