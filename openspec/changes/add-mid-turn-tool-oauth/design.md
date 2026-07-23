# Design — mid-turn tool OAuth in ChatView

> Exploration-stage design. Records the reasoning, the end-to-end trace, and the verified
> rclone spike. Not yet a committed build.

## The two OAuth patterns already in the tree

The dashboard already implements the loopback-catch idea twice:

```
PATTERN A — dashboard-login OAuth (auth.ts / auth-plugin.ts)
  redirect_uri = getTunnelUrl() ?? http://localhost:PORT  → /auth/callback/:provider
  Served by the DASHBOARD server → reachable THROUGH the tunnel. Works remotely.

PATTERN B — LLM-provider OAuth (oauth-callback-server.ts)
  startCallbackServer({ port, path, onCode })  redirect = http://localhost:PORT/callback
  Opens the SYSTEM browser on the server host, catches code, exchanges, saves, shuts down.
  Trivial locally; breaks through a tunnel (loopback resolves on the wrong machine).
```

The rclone case is Pattern B in spirit. The remote wrinkle is the core tension, resolved by
scope decision #1 (auth is local-only).

## Why loopback breaks remotely (and why #1 dissolves it)

```
LOCAL: browser + tool share the box → 127.0.0.1:PORT catches the redirect        ✔
REMOTE: tool on server, browser on phone → 127.0.0.1:PORT resolves on the PHONE  ✘
```

Providers split on redirect policy: *loopback-any-port* (installed-app; can't tunnel) vs
*exact pre-registered URI* (can tunnel only with a STABLE host — random zrok hostnames can
never be pre-registered). So "dynamic host redirect" cuts against a remote flow. Scope
decision #1 (persist locally, use remotely) sidesteps all of it: the ceremony is a one-time
local act, gated by the existing `system-open-capability` + remote-access pattern.

> **Correction (refined after the gh/gcloud spike):** "local-only ceremony" holds **only for
> the loopback challenge kind**. Device-code and OOB paste-back kinds have no loopback to
> resolve on the wrong machine, so they authenticate fine from a *remote* ChatView. See the
> three-kind taxonomy below — it partially reverses the blanket "auth is local-only" claim.

## Courier vs owner (the credential-ownership axis)

```
              Does the external tool own its OAuth app + credential store?
   YES → COURIER (rclone, gh, aws sso)          NO → OWNER (generic HTTP connector)
   catch listener : the TOOL's own :53682       catch listener : dashboard startCallbackServer
   credential     : the TOOL's own config        credential     : connector-auth.json vault
   dashboard job  : detect blocking auth-URL,     dashboard job  : full Pattern-B flow,
                    surface card, open browser                     exchange, persist, refresh, inject
```

Courier is **local-only for the catch by construction** — the dashboard does not own the
listener socket, so it cannot inject a tunnel-caught code into the tool. Given #1 that is
fine. Owner mode *could* catch remotely with a stable registered redirect, but #1 makes both
modes settle on the same local-ceremony substrate.

## End-to-end trace — "connect my Google Drive via rclone" (courier)

```
 HOP 1  wrapper tool invoked                                              glue
 HOP 2  rclone config create gdrive drive --auth-no-open-browser
        → rclone mints Google authorize URL (its OWN client_id),
          starts its OWN loopback :53682, prints URL, BLOCKS              rclone owns it
 HOP 3  wrapper detects the auth-URL from rclone (structured)             NOVEL  ← only new code
 HOP 4  wrapper → ask_user → PromptBus → prompt_request → ChatView card   ships
 HOP 5  click → server openBrowser(url) on SERVER host,
        gated by system-open-capability + remote-access check            ships
        (remote user instead: "open the dashboard on <host>")
 HOP 6  Google → 127.0.0.1:53682?code=… → rclone's OWN listener catches,
        exchanges, writes rclone.conf                                    rclone owns it
 HOP 7  rclone exits 0 → wrapper resolves the card → "Connected"         glue
 HOP 8  token persisted in rclone.conf; remote USE = read local config   ships (#1 + #3)
```

Result: **the sole novel surface is HOP 3.** HOP 3 also *disappears* in the degenerate case
where the dashboard runs on the user's own desktop and rclone opens its own browser — at the
cost of a browser popping up outside ChatView. Routing the ceremony *through ChatView* is
what makes HOP 3 worth building.

## Courier is a family — three challenge kinds (verified: gh, gcloud, rclone)

Courier is not one flow. Every courier tool owns its own credential store, but the *kind* of
challenge it raises decides the topology and the ChatView card shape:

```
 (1) LOOPBACK url   tool runs its OWN 127.0.0.1 listener; browser→consent→loopback redirect
     rclone (default), gcloud (default)          → LOCAL-ONLY
 (2) DEVICE code    tool prints {verification URL + short user-code}, POLLS provider itself
     gh (default), aws sso, az                    → REMOTE-OK  (no loopback)
 (3) OOB paste-back tool prints a long URL; a browser-machine yields a code you paste back
     gcloud --no-browser/--remote-bootstrap,
     rclone authorize (2nd machine)               → REMOTE-OK  (manual copy)
```

| Tool | Creds store | Default kind | Remote-capable path | Detection signal |
|---|---|---|---|---|
| rclone | rclone.conf | loopback `url` | none (only `authorize` paste) | **structured** (`--non-interactive` State) |
| gcloud | ~/.config/gcloud | loopback `url` | `--no-browser` / `--remote-bootstrap` → paste | prose |
| gh | hosts.yml | **device** (or `--web` loopback) | device is remote-OK by default | prose (`one-time OAuth device code`) |
| aws sso | ~/.aws/sso/cache | device *(spike inconclusive)* | device remote-OK | prose |

**Strategy:** when a tool offers a choice, prefer the remote-capable kind (gh → device not
`--web`; gcloud → `--no-browser` for remote, loopback for local; rclone → loopback only, so
local-only with the 2nd-machine paste as its escape hatch).

## The novel primitive — AuthChallengeDetector

```
interface AuthChallengeDetector {
  launch()    // spawn the tool in its most-structured headless auth mode + right flag
  detect()    // → {kind:"url",    url}                        (loopback, local-only)
              //   {kind:"device", verificationUrl, userCode}  (device, remote-OK)
              //   {kind:"paste",  url}  then accept a code     (OOB, remote-OK)
              //   {kind:"done"} | {kind:"none"}
  complete()  // resolve when the tool's own listener/poll/exit signals success
}
```

Each `kind` renders a different ChatView card: `url` → "Open in browser"; `device` → show the
CODE prominently + "enter it at <url>"; `paste` → url + a paste field. Detection is
**per-tool adapters** (launch flag + kind + a regex to pull url/code + completion = process
exit), NOT one universal parser: rclone's `--non-interactive` structured State is the
pleasant exception; gh/gcloud/aws emit prose. Owner-mode connectors (no such tool) fall
through to `startCallbackServer` instead.

## Verified spike — rclone `--non-interactive` (rclone v1.74.3, macOS)

`rclone config create --help` confirms the structured protocol; the OAuth step is a
first-class **State**, not prose:

```json
  "State": "*oauth-islocal,teamdrive,,"
```

- `--non-interactive` → returns a JSON blob per question instead of prompting.
- Drive it forward with `rclone config update <name> --continue --state "…" --result "…"`.
- Detector keys off `State` beginning with `*oauth` — no fragile regex on prose.
- `rclone authorize --auth-no-open-browser` is the confirmed knob to stop rclone opening its
  own browser, so the dashboard's `openBrowser` owns HOP 5.

This closes the one open fact. The exact continue-loop past the first `*oauth-…` state is a
build-time detail, not a feasibility risk.

## Payoff — courier is *easier* than owner for cloud providers

rclone ships its own registered Google OAuth client. Courier mode therefore needs **no**
Google Cloud console app, **no** owned redirect URI, **no** tunnel-hostname registration.
rclone already solved "who owns the OAuth app + the registered loopback redirect." Owner mode
only earns its keep for generic HTTP APIs where no rclone-like tool exists.

## Rejected alternatives

- **Unify courier + owner under one adapter interface** — over-engineering; the trace showed
  they share only the card + open-browser primitives, not a credential model.
- **Tunnel the OAuth redirect for remote auth** — needs a stable pre-registered public host;
  random zrok hostnames make it unworkable, and #1 makes it unnecessary.
- **`rclone rcd` daemon + `rc config/create`** — richest, but daemon lifecycle is overkill
  for a one-shot config; `--non-interactive` gives structure without a daemon.

## Open items before build

1. Green-light to leave exploration and write `tasks.md` + `specs/` deltas.
2. Which tools ship a courier detector at MVP (rclone first; gh / aws sso as seam-provers?).
3. Whether owner-mode lands here or inside `add-connector-layer` Phase 2 (avoid duplication).
