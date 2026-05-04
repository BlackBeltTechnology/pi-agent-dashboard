# push-notify-user

Send a push notification to the user's devices via the dashboard's `/api/push/send` endpoint.

## When to use

Use this skill when the user asks to be notified (e.g. "notify me when done", "ping me", "let me know when it finishes").

## How it works

1. **Detect the dashboard URL** — read the running server's port from `~/.pi/dashboard/config.json` (key: `port`, default 8000). Construct the base URL as `http://localhost:<port>`.

2. **Read the auth secret** — from `~/.pi/dashboard/config.json`, read the `auth.secret` key. If absent or empty, the dashboard has no auth — skip the Authorization header.

3. **Read config.json** — `cat ~/.pi/dashboard/config.json` and parse with your JSON parser (don't use jq if unavailable). Extract `port` (default 8000) and `auth.secret`.

4. **Send the push**:
   ```bash
   curl -s -X POST "http://localhost:<port>/api/push/send" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <secret>" \
     -d '{"title": "<title>", "body": "<body>", "url": "/<path>"}'
   ```

   - `title` — max 200 chars. Required.
   - `body` — max 500 chars. Required.
   - `url` — optional path starting with a single `/` (e.g. `/session/abc-123`). Defaults to `/` (dashboard root).

## Response handling

| HTTP Status | Meaning | What to tell the user |
|-------------|---------|-----------------------|
| 200 `{results: []}` | No devices registered | "No devices are registered for push notifications. Enable push in dashboard Settings first." |
| 200 `{results: [{ok: true}, ...]}` | Push sent successfully | "Push notification sent to N device(s)." |
| 401 | Auth failed | "Authentication failed — check that auth.secret in ~/.pi/dashboard/config.json matches." |
| 404 | Push not enabled on server | "Push notifications are not enabled on this server. Enable them in dashboard Settings." |
| 429 | Rate limited (2/min) | "Rate limited — wait 60 seconds before sending another push." |
| Connection refused / timeout | Dashboard not running | "Dashboard does not appear to be running. Cannot send push notification." |
| Other (4xx, 5xx) | Server error | "Push failed with status <code>: <body>. Check server logs." |

## Notes

- The endpoint is rate-limited to 2 requests per minute.
- The URL must start with a single `/` (not `//`).
- If the server has no auth configured, you can omit the Authorization header.
- The `auth.secret` is used as a Bearer token; this works on localhost without the full OAuth flow.
- If you can't read `~/.pi/dashboard/config.json` (permission denied, missing), assume port 8000 and no auth.
