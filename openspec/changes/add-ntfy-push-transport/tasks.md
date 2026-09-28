# Tasks

Prerequisite: work on top of `feat/add-server-push-notifications` (or after it merges). Its transport interface, registry, dispatcher, webhook address policy, routes and `PushNotificationsSection` must exist.

## 1. Preconditions

- [ ] 1.1 Read the as-built `packages/server/src/push/` (types, dispatcher cadence filter, webhook vetting + pinned `undici` agent, registry display/redaction) and confirm the seams named in design.md.
- [ ] 1.2 Read `PUT /api/config` in `packages/server/src/routes/system-routes.ts` (live-apply block) and the dispatcher construction in `server.ts`.
- [ ] 1.3 Capture a green baseline: `set -o pipefail; npm test 2>&1 | tee /tmp/ntfy-baseline.log`.

## 2. Payload: absoluteUrl

- [ ] 2.1 Tests first in the `build-push-payload` test file: `absoluteUrl` from `publicBaseUrls` (trailing slash stripped, wins over tunnel), from tunnel, absent when neither; `sessionId` URI-encoded; existing payload scenarios unchanged.
- [ ] 2.2 Add optional `baseUrl` input to `buildPushPayload`; emit `absoluteUrl` only when set.
- [ ] 2.3 Dispatcher computes `baseUrl` per fan-out: `resolvePublicBaseUrls(config)[0] ?? getTunnelUrl() ?? undefined`.

## 3. Address policy reuse

- [ ] 3.1 If the webhook's resolve-vet-pin logic is inline in `webhook.ts`, extract it to `push-transports/vetted-request.ts` (shared by webhook + ntfy) with no behaviour change; the existing webhook tests must stay green untouched.

## 4. ntfy transport

- [ ] 4.1 Tests first: `packages/server/src/__tests__/push-ntfy-transport.test.ts` against a local `http.createServer`:
  - POST goes to `/` with the JSON mapping (title, message fallback, priority 4/3, tags per trigger, `click` present/absent);
  - `Authorization: Bearer` only when `authToken` set;
  - `302` not followed; `401`/`403`/`404`/`429`/`500` → `{ok:false}`, no retry, never `gone`;
  - timeout aborts at 5 s; blocked resolved address (`169.254.169.254`) → no connection;
  - log lines contain only the redacted display, never full topic or `authToken`.
- [ ] 4.2 Create `packages/server/src/push/push-transports/ntfy.ts` (`createNtfyTransport()`), using the shared vetted request. Register it in the dispatcher's transport map.
- [ ] 4.3 Add `"ntfy"` to the `PushTransport` kind union and to the dispatcher's device-cadence set (unread edge, no coalescing). Test: unread session does not re-buzz an ntfy token; first edge does.

## 5. Registration and registry

- [ ] 5.1 Tests first in the push-routes / registry tests: the ntfy topic-URL validation matrix (spec "Malformed ntfy topic URL rejected" + 64-char boundary); `authToken` only for ntfy, 1–256 printable ASCII; re-register rotates `authToken` and keeps `tokenId`; display `label (origin/pi-X…)`; `authToken` absent from `GET /api/push/register`, test results and logs; `push-tokens.json` still `0600`.
- [ ] 5.2 Implement `parseNtfyTopicUrl` + ntfy branch in register validation (including address policy at registration), `authToken?` on the token record, ntfy display/redaction.

## 6. Live push toggle

- [ ] 6.1 Tests first (`push-live-toggle.test.ts`): boot disabled → `PUT /api/config {push:{enabled:true}}` → routes `200`, next trigger delivered, no restart; live disable → routes `404`, no outbound call, tokens kept with original `tokenId` after re-enable; enabling alone creates no `push-vapid.json`; unauthenticated caller still gets `401` in both states.
- [ ] 6.2 `server.ts`: always construct the dispatcher (no I/O on construction) and pass it to `wireEvents` and the push routes; keep the dispatcher/viewed-tracker pairing test green.
- [ ] 6.3 Dispatcher `fanout`, push route handlers and VAPID init read `enabled` from live config per call.
- [ ] 6.4 `system-routes.ts` `PUT /api/config`: when `partial.push !== undefined`, copy `reloaded.push` into the running config.

## 7. Settings UI

- [ ] 7.1 Tests first (`PushNotificationsSection` tests, `@testing-library/react`): switch shown in both states; enable sends `PUT /api/config` and reveals controls without reload; failure rolls back with inline error; insecure context hides the browser toggle but keeps webhook + Add phone; tap-target line with and without a base URL.
- [ ] 7.2 Add the server-wide **Enable push notifications** switch to `PushNotificationsSection.tsx`.
- [ ] 7.3 Tests first (`AddNtfyPhoneDialog` tests): generated topic matches `^pi-[-_A-Za-z0-9]{24}$` and differs between opens; QR payload `ntfy://ntfy.sh/<topic>?display=Pi%20Dashboard`, with `&secure=false` for `http:` servers; iOS steps and copy buttons; self-hosted `upstream-base-url` hint only for non-`ntfy.sh`; confirm → register → test with inline result; `400` shown inline via `aria-describedby`; access token field is `type="password"`.
- [ ] 7.4 Create `packages/client/src/components/settings/AddNtfyPhoneDialog.tsx` (QR via existing `qrcode`, same usage as `Gateway/GatewayPairQR.tsx`; focus-trapped, labelled inputs) and wire the **Add phone (ntfy)** action; show `consecutiveFailures` on rows when non-zero.

## 8. Documentation

- [ ] 8.1 Delegate to DocScribe (caveman style): ntfy subsection in the push section of `docs/architecture.md` (transport mapping, device cadence, redaction, live toggle) and a user guide: hosted `ntfy.sh` (free, anonymous ≈250 msgs/day, topic = password) vs self-hosted (`binwiederhier/ntfy`, `auth-default-access: deny-all` + access token, `upstream-base-url: "https://ntfy.sh"` for iOS), Android Play vs F-Droid instant delivery, `publicBaseUrls` / tunnel for tap-to-open.
- [ ] 8.2 Add a `docs/faq.md` entry: "How do I get dashboard notifications on my phone?".
- [ ] 8.3 Update the nearest directory `AGENTS.md` rows for `ntfy.ts`, `vetted-request.ts` (if extracted), `build-push-payload.ts`, the dispatcher, `system-routes.ts`, `PushNotificationsSection.tsx`, and `AddNtfyPhoneDialog.tsx`.

## 9. Verification

- [ ] 9.1 `npm test` green versus baseline; `npm run quality:changed` clean.
- [ ] 9.2 `openspec validate add-ntfy-push-transport --strict`.
- [ ] 9.3 Manual iPhone: Settings → Notifications → enable → Add phone (`https://ntfy.sh`) → subscribe in the iOS ntfy app → test arrives. Lock the phone, trigger `ask_user` in an unviewed session → notification within seconds; tap opens `/session/<id>` via `publicBaseUrls` / tunnel.
- [ ] 9.4 Manual Android: same flow, subscribe by scanning the QR; `ask_user` shows as a pop-over (priority 4), turn finished as normal (priority 3); a second turn while still unread does not re-buzz.
- [ ] 9.5 Manual: toggle off in Settings → trigger → nothing; on → delivered; no restart. `server.log` and the token list never show the full topic or access token.
