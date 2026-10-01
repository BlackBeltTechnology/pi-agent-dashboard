## Why

`add-server-push-notifications` (in implementation on `feat/add-server-push-notifications`) reaches browsers through Web Push and headless receivers through a generic webhook. It leaves phones weak:
- iOS Web Push works only after a home-screen PWA install and is unreliable in the background.
- FCM needs a Firebase project, a service account, and the not-yet-built Capacitor app.
- Pointing the generic webhook at ntfy "works" but is unusable: ntfy shows the raw `PushPayload` JSON as the message text, with no title, no priority, and no tap-to-open.
- `push.enabled` can only be turned on by editing `config.json` and restarting; the Settings section shows "Push not enabled on this server" and no controls.

[ntfy](https://ntfy.sh) (Apache-2.0 / GPLv2) delivers push to **iOS and Android** through its open-source app (App Store, Google Play, F-Droid). Hosted `ntfy.sh` is free with no signup (≈250 messages/day anonymous); any self-hosted ntfy server works too. The dashboard only needs to publish: one HTTP POST. This change adds ntfy as a first-class transport and makes push fully configurable from Settings.

## What Changes

- **NEW** `packages/server/src/push/push-transports/ntfy.ts`: `transport: "ntfy"`, `deviceToken` = topic URL `<scheme>://<host>[:port]/<topic>`, optional `authToken` (ntfy `tk_…`). Delivery = `POST <origin>/` with ntfy's JSON publish body `{topic, title, message, priority, tags, click?}`, `Authorization: Bearer <authToken>` when set.
  - Priority: `4` (pop-over + sound) for `input` / `crash`, `3` for `turn_end`.
  - `click` = the payload's new `absoluteUrl`, omitted when the dashboard has no reachable base URL.
  - Reuses the webhook transport's address policy verbatim (link-local / metadata / dashboard-own-port refusal on every resolved IP, pinned `undici` connection, no redirects, 5 s timeout, body discarded).
  - `2xx` → ok; everything else → failure, kept, not retried. ntfy has no "gone" signal, so ntfy tokens are never pruned.
- **MODIFY** cadence: `ntfy` is a **device** transport: delivered only on the unread edge, like `web-push` / `fcm`. A phone gets one buzz per unread period.
- **MODIFY** registration: `transport` accepts `"ntfy"`; body gains optional `authToken` (ntfy only). Topic URL validated (`http(s)`, no userinfo, exactly one path segment `^[-_A-Za-z0-9]{1,64}$`). Topic and `authToken` are secrets: display = `label (origin/<first 4 topic chars>…)`; `authToken` never returned or logged; both persist only in the `0600` `push-tokens.json`.
- **MODIFY** payload: `buildPushPayload` adds optional `absoluteUrl` = `<base>/session/<id>`, where `<base>` is the first `resolvePublicBaseUrls(config)` entry, else the live tunnel URL, else absent. Web Push keeps using relative `url`.
- **MODIFY** opt-in: `push.enabled` becomes **live**. `PUT /api/config` with a `push` key reloads the running push config without a restart. The dispatcher is always constructed (no I/O, no files) and gates on live `enabled`; while disabled the routes still answer `404`, no VAPID keys exist, and no outbound call happens, exactly as before.
- **MODIFY** `PushNotificationsSection.tsx`:
  - a server-wide **Enable push notifications** switch (`PUT /api/config {push: {enabled}}`) shown even while push is disabled;
  - **Add phone (ntfy)** dialog: server URL (default `https://ntfy.sh`), topic generated client-side (`pi-` + 24 base64url chars from `crypto.getRandomValues`, 144 bits, works in insecure contexts), optional label and access token. Shows a QR code (existing `qrcode` dependency) of `ntfy://<host>/<topic>?display=Pi%20Dashboard` for Android, plus copyable server URL and topic with iOS app steps. Confirm → register → automatic Send Test;
  - hints: Android Google-Play build → enable "instant delivery"; non-`ntfy.sh` server → needs `upstream-base-url: "https://ntfy.sh"` for instant iOS delivery; which base URL taps will open, or "taps won't open the dashboard".
- **NEW** docs: ntfy phone setup (hosted vs self-hosted, iOS relay, Android instant delivery, topic = password) in `docs/` and `docs/faq.md`.
- No new routes, route tiers, MCP denylist rows, or dependencies.

## Capabilities

### New Capabilities

(none; extends `push-notifications`.)

### Modified Capabilities

- `push-notifications`: adds the ntfy transport, `absoluteUrl` in the payload, a live `enabled` toggle, and ntfy phone onboarding in the Settings UI.

## Dependencies

- Builds on `add-server-push-notifications`. Its `push-notifications` capability must be archived into `openspec/specs/` before this change archives. Implementation can start on top of `feat/add-server-push-notifications` once its transport interface, registry and Settings section exist.

## Out of Scope

- **Bundling or spawning an ntfy server**: ntfy is a Go binary; the dashboard is a publish-only client. Self-hosting is the operator's choice, documented not managed.
- **Dashboard serving the ntfy subscribe protocol** (the app subscribing to the dashboard directly): unofficial compatibility, and no iOS instant delivery.
- **ntfy action buttons** ("Abort" / "Reply" from the notification): needs a callable action endpoint and its own security review.
- **Per-event-type opt-in** and quiet hours: unchanged from the base change.
- **Encrypting the topic at rest** beyond `0600`: same trust model as webhook URLs.

## Discipline Skills

- `security-hardening`: server POSTs to a user-supplied ntfy URL; topic and `authToken` are credentials. Reuses the webhook SSRF policy and redaction; topic generated with 144 bits of CSPRNG entropy; `authToken` write-only.
- `observability-instrumentation`: new outbound call. Same structured per-delivery log line as other transports (`{transport: "ntfy", target: <redacted>, outcome, latencyMs}`); a `401`/`403` is logged as an auth failure so a wrong token is diagnosable.
- `doubt-driven-review`: the live-toggle change touches the base change's Decision 6 invariants (no VAPID, no outbound, `404` while disabled). Review before implementation that live reload preserves all three.
