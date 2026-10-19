# Test Plan — fix-pairing-approval-credential

Stage: design   Generated: 2026-05-14

Decisions applied: P1–P6 (see design.md D12). Exemplar column = harness pointer for the tasks.md fold.

Harness exemplars (all verified present):
`H-pairdlg` = packages/server/src/__tests__/pairing-approval-dialog.test.ts ·
`H-opreq` = packages/server/src/__tests__/operate-required.test.ts ·
`H-hostgate` = packages/server/src/__tests__/host-gate-wiring.test.ts ·
`H-oauth` = packages/server/src/__tests__/auth-plugin-oauth-state.test.ts ·
`H-lpstrict` = packages/server/src/__tests__/local-proof-strict.test.ts ·
`H-cliopen` = packages/server/src/__tests__/cli-open.test.ts ·
`H-clitoken` = packages/server/src/__tests__/cli-token.test.ts ·
`H-ltoken` = packages/server/src/__tests__/local-token.test.ts ·
`H-pairing` = packages/server/src/__tests__/pairing.test.ts ·
`H-shared` = packages/shared/src/__tests__/config-pairing.test.ts ·
`H-dlg` = packages/client/src/components/pairing-approval/__tests__/PairingApprovalDialog.test.tsx ·
`H-host` = packages/client/src/components/pairing-approval/__tests__/PairingApprovalHost.test.tsx ·
`H-api` = packages/client/src/lib/pairing/__tests__/pairing-approval-api.test.ts ·
`H-i18n` = packages/client/src/lib/__tests__/i18n-orphans.test.ts ·
`H-lpb` = packages/electron/src/lib/__tests__/local-proof-bootstrap.test.ts ·
`H-ipc` = packages/electron/src/__tests__/ipc-trust.test.ts ·
`H-rb` = packages/electron/src/__tests__/renderer-boundary.test.ts ·
`H-link` = packages/electron/src/__tests__/link-handling.test.ts ·
`H-e2e-dlg` = tests/e2e/pairing-approval-dialog.spec.ts ·
`H-qa-start` = qa/tests/02-server-start.sh

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable | exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|----------|
| E1 | qr: remedies decision table | decision-table | L1 | automated | ip 127.0.0.1, no XFF, no proof, Host `localhost:8000`, cfg port 8000, loginAvailable→false | `describeApprovalRefusal` | `{reason:"no-credential", remedies:["authorize-browser","approve-on-host"]}` | H-opreq |
| E2 | qr: remedies | decision-table | L1 | automated | same, loginAvailable→true | helper | `["authorize-browser","approve-on-host","sign-in"]` (order fixed, no dups) | H-opreq |
| E3 | qr: off-host remedy | decision-table | L1 | automated | ip 10.0.0.5 via tunnel Host, OAuth provider clientId non-empty | helper | `["approve-on-host","sign-in"]` | H-opreq |
| E4 | qr: off-host no login | decision-table | L1 | automated | ip 10.0.0.5, no login | helper | `["approve-on-host"]` exactly | H-opreq |
| E5 | qr: XFF disqualifies local | decision-table | L1 | automated | ip 127.0.0.1 + `X-Forwarded-For: 1.2.3.4`, Host `localhost:8000` | helper | no `authorize-browser` | H-opreq |
| E6 | qr: local WITH proof cookie (refused for other reason not reachable) | decision-table | L1 | automated | genuinely local + valid proof cookie | helper called directly | no `authorize-browser` | H-opreq |
| E7 | qr: device credential | decision-table | L1 | automated | `authVia:"device"` | approve-pending | 401 `{reason:"device-credential", remedies:[]}` | H-pairdlg |
| E8 | qr: strict-mode independence | decision-table | L1 | automated | bare loopback, `requireLocalProof` true vs false | approve-pending ×2 | byte-identical `remedies` arrays, both contain `authorize-browser` | H-lpstrict |
| E9 | qr: spoofed Host — other port | EP (abuse: spoofed Host) | L1 | automated | bare loopback, Host `localhost:9000`, cfg 8000, no login | approve-pending | `remedies` exactly `["approve-on-host"]` | H-pairdlg |
| E10 | qr: isLauncherOrigin BVA | EP+BVA | L1 | automated | (`localhost`,8000),(`127.0.0.1`,8000),(`127.255.255.254`,8000),(`[::1]`,8000),(`localhost`,implicit 80, cfg 80) vs (`128.0.0.1`,8000),(`localhost.evil.com`,8000),(`localhost`,7999),(`localhost`,8001),(`localhost`,implicit 80, cfg 8000),(`0.0.0.0`,8000),(`[::ffff:127.0.0.1]`,8000) | `isLauncherOrigin(hostname, port, cfgPort)` | first five → true; remaining seven → false (`[::ffff:127.0.0.1]` refused: only `127.0.0.0/8` and `[::1]` are loopback literals) | H-shared |
| E11 | qr: spoofed Host values | EP (abuse) | L1 | automated | Host header missing; `Host: localhost:8000@evil`; `Host: [::1`; `Host: LOCALHOST:8000` (cfg 8000, bare loopback, no login) | credential-less approve-pending | missing/malformed → 401, `remedies` exactly `["approve-on-host"]`, never 5xx; `LOCALHOST:8000` → `["authorize-browser","approve-on-host"]` (hostname compared case-insensitively) | H-pairdlg |
| E12 | qr: report-mode non-admitted Host | decision-table | L1 | automated | hostGate `report`, Host `evil.example`, login configured, no cred | approve-pending | 401, `Object.keys(body)` == `["success","error"]`, error `operator credential required` | H-hostgate |
| E13 | qr: enforce-mode non-admitted Host | decision-table | L1 | automated | hostGate `enforce`, Host `evil.example` | approve-pending | 403 host-gate body, no `reason`/`remedies` | H-hostgate |
| E14 | qr: admission unchanged | decision-table | L1 | automated | session / proof cookie / `X-Pi-Local-Proof` / legacy `X-Pi-Local-Token` / bare loopback / device bearer | approve + approve-pending | admit set == pre-change admit set (snapshot of 6 rows) | H-pairdlg |
| E15 | qr: body non-disclosure | EP | L1 | automated | pending label `robson-phone` @ `192.168.16.31`, host `office-mac` | credential-less approve | keys exactly `success,error,reason,remedies`; JSON contains none of pendingId/`robson-phone`/`192.168.16.31`/`office-mac` | H-pairdlg |
| E16 | qr deny: guard move | state-transition | L1 | automated | bare loopback, `requireLocalProof` false, pending P | POST /api/pair/deny | 401 with same reason/remedies as approve; P still pending; subsequent redeem of code still accepted (code not consumed) | H-pairdlg |
| E17 | qr deny: host credential | state-transition | L1 | automated | `X-Pi-Local-Proof` | deny | 200, status poll → `rejected`, redeem refused | H-pairdlg |
| E18 | qr deny: device bearer | decision-table | L1 | automated | device bearer | deny | 401 `device-credential`, P unchanged | H-pairdlg |
| E19 | qr: pending feed untouched | regression | L1 | automated | bare loopback | GET /api/pair/pending | still 200 (operatorGuard unchanged) | H-pairdlg |
| E20 | trust: sanitizeReturnUrl accept | EP | L1 | automated | `/settings/gateway`, `/a?b=c#d`, `/%2F%2Fevil.example` (post-decode literal) | `sanitizeReturnUrl` | returned unchanged | H-oauth |
| E21 | trust: open redirect | EP (abuse: open redirect) | L1 | automated | `https://evil.example/steal`, `//evil.example`, `/\evil.example`, `evil`, `""`, `undefined`, `123`, `["/a"]`, `HTTPS://evil`, `/\\/evil`; plus `/..//evil` | `sanitizeReturnUrl` | `/` for every value in the first list; `/..//evil` returned unchanged (re-parses to the sentinel origin, path `//evil`, same-origin) | H-oauth |
| E22 | trust: CRLF / control chars | EP+BVA (abuse: CRLF) | L1 | automated | `/\t/evil.example`, `/\r\n/evil.example`, `/\r\nSet-Cookie: x=y`, `/a\u0000`, `/a\u001f`, `/a\u007f`; boundary `/a\u0020`, `/a\u0080` | `sanitizeReturnUrl` | first six → `/`; `/a\u0020` and `/a\u0080` (outside `U+0000`–`U+001F`,`U+007F`) returned unchanged | H-oauth |
| E23 | trust: single predicate | invariant | L1 | automated | grep source tree | static test | exactly one definition of `sanitizeReturnUrl`; `local-proof-routes.ts` imports it | H-oauth |
| E24 | trust: `next=` honored | state-transition | L1 | automated | fresh code, `next=/settings/gateway` | GET /auth/local-proof | Set-Cookie `pi_dash_local` (httpOnly, SameSite=Strict); 302 Location `/settings/gateway` | H-lpstrict |
| E25 | trust: `next=` CRLF on wire | EP (abuse: CRLF) | L1 | automated | `next=%0D%0ASet-Cookie:%20x=y`, `next=%09/evil.example`, `next=%2F%2Fevil.example` | GET /auth/local-proof | cookie set; Location exactly `/`; no response header contains `\r`/`\n`; no second Set-Cookie | H-lpstrict |
| E26 | trust: spent code + next | state-transition | L1 | automated | already-redeemed code; `next=/settings` | GET again | no Set-Cookie; no redirect to `/settings` | H-lpstrict |
| E27 | trust: code TTL BVA | BVA | L1 | automated | code age 59.999s / 60s / 60.001s (fake clock) | redeem with `next` | ≤60s cookie set; >60s none; `next` irrelevant | H-lpstrict |
| E28 | trust: duplicate `next` | EP | L1 | automated | `?next=/ok&next=//evil` (array) | redeem | Location `/` (non-string ⇒ rejected) | H-lpstrict |
| E29 | qr CLI: approve id resolution | decision-table | L1 | automated | pending count 0 / 1 / 2, no id arg | `cmdPair(["approve"])` | 1 → reads code then POSTs that id; 0/2 → prints list, exit 2, no POST | H-clitoken |
| E30 | qr CLI: code too short (P2) | EP+BVA | L1 | automated | `--code 1234567` | `cmdPair(["approve",id,"--code","1234567"])` | exit 2, err names "8 digits", fetchImpl POST count 0 (no attempt spent) | H-clitoken |
| E31 | qr CLI: code too long / non-numeric (P2) | EP+BVA | L1 | automated | `--code 123456789`, `--code 12a45678` | approve | exit 2 each, no POST | H-clitoken |
| E32 | qr CLI: code with separators (P2) | EP | L1 | automated | prompt input `1234 5678` / `1234-5678` | approve | POST body `confirmCode` = `12345678` both times | H-clitoken |
| E33 | qr CLI: argv code not echoed | EP (abuse: argv) | L1 | automated | `--code 12345678` | approve (success + mismatch) | stdout/stderr never contain `12345678`; outgoing body carries it once; no log line contains it | H-clitoken |
| E34 | qr CLI: stdin non-TTY (P3) | EP (abuse: stdin) | L1 | automated | stdin pipe `12345678\n99999999\n`, isTTY false, no `--code` | approve | first line read: POST body `confirmCode` = `12345678`; prompt text not required | H-clitoken |
| E35 | qr CLI: stdin EOF / empty line (P3) | EP | L1 | automated | non-TTY stdin closed with no bytes; non-TTY stdin `\n` | approve | exit 2 each, no POST | H-clitoken |
| E36 | qr CLI: prompt code not in history | invariant | L1 | automated | interactive prompt | approve | prompt reads from injected `prompt`, code never written to `out`/`err` | H-clitoken |
| E37 | qr CLI: list hides code | invariant | L1 | automated | pending payload (fixture even if server erroneously included `confirmCode:"87654321"`) | `pair list` and `--json` | output contains no `87654321`; `--json` only whitelisted fields | H-clitoken |
| E38 | qr CLI: tier forwarding | decision-table | L1 | automated | knock entry; `--tier operate` / absent / `--tier root` | approve | body has `tier:"operate"` / no `tier` key / exit 2, no POST | H-clitoken |
| E39 | qr CLI: terminalSafe removal | EP (abuse: terminal) | L1 | automated | UA `Mozilla\u001b[2J\u009b31m\u202Eevil\u200B\u2028x\uFEFF\u0007` | `terminalSafe` + `pair list` | printed field contains no char in C0/DEL/C1/bidi/ZW/2028-9; `Mozilla[2J31mevilx` | H-pairing |
| E40 | qr CLI: cap BVA (P4) | BVA | L1 | automated | UA 119/120/121 ASCII chars | `terminalSafe(ua,120)` | 119, 120 returned unchanged; 121 → exactly 120 code points = first 119 chars + `…` | H-pairing |
| E41 | qr CLI: cap with astral chars (P4) | BVA | L1 | automated | 119 ASCII + `😀` (len 120 code points); 119 ASCII + `😀` + `x` (121) | `terminalSafe(ua,120)` | first returned unchanged incl. `😀`; second → 119 ASCII + `…`; neither contains an unpaired surrogate (`/[\uD800-\uDFFF]/u` on code points finds none) | H-pairing |
| E42 | qr CLI: caps per field (P4) | EP | L1 | automated | requesterName 65, viaHost 65, remoteAddress 65 code points, pendingId 36-char UUID | `pair list` | first three printed as 64 code points ending `…`; pendingId printed in full | H-pairing |
| E43 | qr CLI: shared char class | invariant | L1 | automated | source | static | `INVISIBLE_OR_SEPARATOR` defined once in shared, imported by `pairing.ts` and CLI; `normalizeRequesterName` behaviour unchanged (existing `pairing.test.ts` green) | H-pairing |
| E44 | qr CLI: no raw token on wire | invariant | L1 | automated | token `T`, injected fetch | list/approve/deny | every request has `X-Pi-Local-Proof`; no header value contains `T`; no `X-Pi-Local-Token` | H-clitoken |
| E45 | qr CLI: dial address | invariant | L1 | automated | config host unset / `127.0.0.1` / `::1` | any verb | fetch URL = `localBase(config)`; proof bound to that URL+method | H-clitoken |
| E46 | qr: launcher `--url` decision table | decision-table (abuse: open redirect / code delivery) | L1 | automated | `http://127.0.0.1:8000`, `https://localhost:8000`, `http://localhost` (cfg 80), `http://localhost:9999`, `http://evil.example:8000`, `file:///x`, `javascript:alert(1)`, `http://u:p@localhost:8000`, `http://localhost:8000/x`, `http://localhost:8000/?a`, `http://localhost:8000/#f` | `cmdOpen --url` | first three accepted (browser opened with that origin + code); rest exit non-zero naming reason (port names configured port), fetch NOT called, browser NOT opened | H-cliopen |
| E47 | qr: launcher default unchanged | regression | L1 | automated | no `--url` | cmdOpen | URL `http://localhost:<port>/auth/local-proof?code=…` byte-identical to pre-change snapshot | H-cliopen |
| E48 | qr dialog: authorize-browser command origin | EP | L1 | automated | `window.location.origin` = `http://127.0.0.1:8000` / `http://localhost:8000` | refusal with authorize-browser | `pi-dashboard open --url http://127.0.0.1:8000` / `pi-dashboard open` (flag omitted for default) | H-dlg |
| E49 | qr dialog: DEV build | decision-table | L1 | automated | `import.meta.env.DEV` true | refusal with both remedies | only approve-on-host row rendered | H-dlg |
| E50 | qr dialog: copy strings exclude code | invariant | L1 | automated | typed code `24681357`, pendingId `abc…` | refusal rows | approve-on-host text = `pi-dashboard pair approve <pendingId>`; no copyable string/clipboard write contains `24681357` | H-dlg |
| E51 | qr dialog: unknown remedy | EP | L1 | automated | `["future-thing","approve-on-host"]` | render refusal | unknown value ignored; exactly one `approve-on-host` row | H-dlg |
| E52 | qr dialog: legacy body | regression | L1 | automated | 401 `{success:false,error:"operator credential required"}` | approve | legacy sentence shown, no rows | H-dlg |
| E53 | qr dialog: device-credential | EP | L1 | automated | `reason:"device-credential", remedies:[]` | approve | no remedy rows; no `pi-dashboard` command text in the dialog | H-dlg |
| E54 | qr dialog: api surfaces remedies | EP | L1 | automated | 401 bodies for approvePending + denyPending | api fns | outcome carries `reason`,`remedies`; absent → undefined | H-api |
| E55 | qr dialog: i18n | invariant | L1 | automated | new keys | i18n coverage | no orphan/missing keys | H-i18n |
| E56 | qr dialog: a11y | invariant | L1 | automated | refusal rendered | DOM query | container `role="alert"`; command is selectable text node; copy button has accessible name | H-dlg |
| E57 | electron: preload closed list | invariant | L1 | automated | main preload | exposeInMainWorld spy | keys exactly `requestLaunch,openDoctor,readServerLog,onStatus,probeServer,checkAppUpdate,navigateToServer` | H-rb |
| E58 | electron: target allowlist | decision-table (abuse: open redirect) | L1 | automated | trusted dashboard-origin sender; targets `https://evil.example/`, `http://localhost:8000.evil.com`, `http://127.0.0.1:8000@evil.example/` | navigateToServer | `{navigated:false, reason:"target-not-allowed"}`; loadURL, `shell.openExternal` and mint spies 0 calls (P6) | H-lpb |
| E59 | electron: scheme refusal | EP (abuse) | L1 | automated | `file:///etc/passwd`, `javascript:alert(1)`, `data:text/html,x`, `pi-dashboard://approve` | navigateToServer | refusal, loadURL 0, mint 0 | H-lpb |
| E60 | electron: local configured target mints | state-transition | L1 | automated | `http://localhost:8000` (cfg 8000), mint ok | navigateToServer | loadURL once with `/auth/local-proof?code=…&next=<path>`; return value deep-equals `{navigated:true}` (no `code=`, no URL) | H-lpb |
| E61 | electron: other local port | EP (abuse: credential aim) | L1 | automated | `http://127.0.0.1:9999` in knownServers | navigateToServer | loadURL(target unchanged); mint 0; return no URL | H-lpb |
| E62 | electron: remote known server | EP | L1 | automated | knownServers `192.168.16.242:8000` | navigateToServer | loadURL unchanged; mint 0 | H-lpb |
| E63 | electron: remote-mode window serverUrl | EP | L1 | automated | serverUrl `http://192.168.16.242:8000`, healthy main probe | attach | loadURL(remoteUrl) unchanged, no renderer fetch gate, mint 0 | H-lpb |
| E64 | electron: next= shape | invariant | L1 | automated | renderer-supplied path with `\r\n` / `//evil` | mint URL build | `next` emitted only in sanitizeReturnUrl-acceptable form, else omitted/`/` | H-lpb |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | electron: read-server-log 8 KiB bound (restated) | threshold | L1 | automated | 50 MB `server.log` fixture | bytes read ≤ 8192 (fs.read spy), returns ≤ `lines` lines | single call |
| P2 | electron: handoff "within one polling cycle" | threshold (fake timers) | L1 | automated | health flips OK at t | navigate IPC invoked ≤ max poll interval (1500 ms, `loading.html:157`) after t | one cycle |
| P3 | qr: refusal never 5xx | fault-injection | L1 | automated | loginAvailable thunk throws / undefined, 100 sequential requests | 100% status 401, 0 × 5xx, `sign-in` absent | 100 req |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) | exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|----------|
| F1 | qr dialog: retry in place | state-transition | L1 | automated | typed code, name `Phone`, tier `control`, countdown at 3:00 | 401 with remedies | code/name/tier preserved, countdown still ticking, Approve enabled, fetch called exactly once | H-dlg |
| F2 | qr dialog: no auto-retry | convergence | L1 | automated | after refusal, window focus/visibilitychange events | wait (fake timers 60s) | approve fetch count stays 1 | H-dlg |
| F3 | qr dialog: retry succeeds | state-transition | L1 | automated | refusal then 200 | click Approve again | body carries same code/name/tier; paired state shown | H-dlg |
| F4 | qr dialog: refused deny | state-transition | L1 | automated | deny → 401 remedies | click Deny | same rows; dialog open; request not removed from queue; Deny enabled | H-host |
| F5 | qr dialog: handled-elsewhere after CLI deny | convergence | L1 | automated | open dialog for P; WS `pair_pending_changed` without P (CLI deny) | event | dialog closes + "handled in another window" notice | H-host |
| F6 | qr: shared budget dialog↔CLI | convergence | L1 | automated | 5-attempt pending P | 1 wrong code via CLI (X-Pi-Local-Proof), then dialog wrong code | CLI prints attemptsLeft 4; dialog shows 3 left after its failure | H-pairdlg |
| F7 | qr: lockout via CLI | state-transition | L1 | automated | 5 wrong CLI attempts | 6th CLI approve with correct code | refused locked_out (429), device not paired | H-pairdlg |
| F8 | qr dialog: rendered remedies vs docker harness | convergence | L3 | automated | harness at `.pi-test-harness.json` dashboardPort, tab origin `http://localhost:<dashboardPort>` (≠ container cfg port, non-loopback peer) | redeem + Approve with code | alert lists `approve-on-host` row with copyable `pi-dashboard pair approve <id>`; no `authorize-browser`; typed code retained | H-e2e-dlg |
| F9 | electron: server started after window | state-transition | — | manual-only | macOS app launched with server down | start server, approve pending in dialog | approval succeeds without terminal (task 5.6) | — |
| F10 | electron: restart keeps proof | state-transition | — | manual-only | app attached locally | restart from app, then approve | approval succeeds without terminal | — |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable | exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|----------|
| X1 | qr CLI: token absent | fault (abort; abuse: token absent) | L1 | automated | injected token dir does not exist | approve/list/deny | exit 1, message names path; fetch 0 calls; dir still absent afterwards | H-ltoken |
| X2 | qr CLI: token unreadable | fault (abuse: token unreadable) | L1 | automated | token file mode 000 / EACCES / is a directory | approve | `readLocalTokenIfPresent` → null; exit 1; fetch 0; file mode/content unchanged | H-ltoken |
| X3 | qr CLI: token empty | fault | L1 | automated | token file 0 bytes | `readLocalTokenIfPresent` + approve | returns null → exit 1, fetch 0, file still 0 bytes (not rewritten) | H-ltoken |
| X4 | qr CLI: wrong token (split OS) (P1) | fault | L1 | automated | token readable but differs from server's | approve | server 401 → exit 3 "credential rejected"; no file written | H-clitoken |
| X5 | qr CLI: host-name bind | fault | L1 | automated | token readable, `config.host = "myhost.local"` | any verb | exit 1 naming `myhost.local`; fetch 0 | H-clitoken |
| X6 | qr: readLocalTokenIfPresent purity | fault | L1 | automated | missing path | call | no mkdir/writeFile (fs spies 0) | H-ltoken |
| X7 | qr: `safeEnsureLocalToken` unchanged for open/login | regression | L1 | automated | missing dir | `cmdOpen` | still creates 0700 dir + 0600 token | H-cliopen |
| X8 | electron: untrusted sender | fault (abuse: untrusted IPC) | L1 | automated | sender frame `http://192.168.16.242:8000/`, `http://127.0.0.1:9999/`, `https://evil.example/`, `null` frame, `file:///other.html` | invoke `dashboard:navigate-to-server` with configured server target | `UntrustedSenderError`; loadURL 0; mint 0; rejection logged | H-ipc |
| X9 | electron: trusted sender | positive | L1 | automated | packaged `loading.html`; `http://localhost:8000/` | invoke | handler runs | H-ipc |
| X10 | electron: handler registered gated | invariant | L1 | automated | `registerPiDashboardIpc` | spy | channel registered via `trustedHandler` (not raw `ipcMain.handle`) | H-rb |
| X11 | electron: mint fault — server down | fault (abort) | L1 | automated | POST /api/local-proof ECONNREFUSED | navigateToServer(local) | loadURL(plain target); `{navigated:true}`; no throw | H-lpb |
| X12 | electron: mint fault — token unreadable | fault (abuse: token absent) | L1 | automated | local token missing | navigateToServer(local) | plain target loaded; no error UI; no token file created | H-lpb |
| X13 | electron: mint fault — server 401/500 | fault | L1 | automated | mint returns 401 / 500 | navigate | plain target | H-lpb |
| X14 | electron: mint delay | fault (delay) | L1 | automated | mint POST never answers (fake timers) | navigateToServer(local) | plain target loaded after the existing 3000 ms `AbortSignal.timeout` in `local-proof-bootstrap.ts`; returns `{navigated:true}` | H-lpb |
| X15 | electron: decideWillNavigate untouched | regression | L1 | automated | existing link-handling cases | — | all green unchanged | H-link |
| X16 | electron: unreachable remote | fault (abort) | L1 | automated | remote probe fails | remote attach | probe not-reachable; error UI after ~15s; no navigation | H-lpb |
| X17 | qr: legacy deny tests | regression | L1 | automated | `local()` helper w/ legacy token | deny cases `:253-267`,`:345` | still 200 | H-pairdlg |
| X18 | qr: expired approve, no sweep | fault (clock) | L1 | automated | code TTL elapsed, no poll/mint since | CLI approve correct code | expired outcome, no device paired | H-pairdlg |
| X19 | qr CLI: audit parity | invariant | L1 | automated | CLI approve success / mismatch / locked | log spy | `[pairing] approved|mismatch|locked_out` line identical in shape to dashboard approval | H-pairdlg |
| X20 | qr CLI: mismatch (P1) | fault | L1 | automated | 400 `{error:"mismatch",attemptsLeft:3}` | approve | message "3 attempts left"; exit 3 | H-clitoken |
| X21 | qr CLI: locked_out (P1) | fault | L1 | automated | 429 locked_out | approve | exit 3; message distinct from X20/X22/X23 | H-clitoken |
| X22 | qr CLI: expired (P1) | fault | L1 | automated | 400 expired | approve | exit 3; "expired" message | H-clitoken |
| X23 | qr CLI: no_pending (P1) | fault | L1 | automated | 404 no_pending | approve/deny | exit 3; "no such request" message | H-clitoken |
| X24 | qr CLI: 401 (P1) | fault | L1 | automated | 401 `operator credential required` | list/approve/deny | exit 3 | H-clitoken |
| X25 | qr CLI: server down / slow (P1) | fault (abort + delay) | L1 | automated | ECONNREFUSED; fetch stalls past the existing 5000 ms CLI timeout | approve | exit 4 "server not running" for both | H-clitoken |
| X26 | qr CLI: unknown verb | EP | L1 | automated | `pair frob` | cmdPair | usage, exit 2, fetch 0 | H-clitoken |
| X27 | qr CLI: live end-to-end | process | L2 | automated | real server on loopback, real token, pending via `/api/pair/request` | `pi-dashboard pair list`, `pair approve <id> --code <digits>` | exit 0; server.log has `[pairing] approved`; list output has no code | H-qa-start |
| X28 | qr CLI: docker exec path | process | — | manual-only | docker harness container | `docker exec … pi-dashboard pair approve` | pairs device (docs claim; live container) | — |

---

## Coverage summary

- Requirements covered: all MODIFIED/ADDED requirements in 3 deltas (electron-shell 4, qr-device-pairing 4, trust 2) — 10/10.
- Scenarios by class: edge 64 · perf 3 · frontend 10 · error 28 → 105
- Scenarios by level: L1 100 · L2 1 · L3 1 · — 3
- Scenarios by disposition: automated 102 · manual-only 3

## New infra needed

- none (L2 X27 reuses qa server-start harness; L3 F8 reuses tests/e2e/pairing-approval-dialog.spec.ts).
