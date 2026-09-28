# DOX — packages/gmail-plugin/src/bridge

pi extension entry: Gmail tools. See change: add-gmail-plugin.

| File | Purpose |
|------|---------|
| `__tests__/attachments.test.ts` | E27 — plain save ok; traversal, final symlink, symlinked parent escape, Windows device/UNC/drive refused; existing file untouched; attach reads confined. |
| `__tests__/bridge-entry.test.ts` | E21 — declarations created/adopted (reads untrusted, writes selfConfirming); `activate` registers 10 tools. |
| `__tests__/mime.test.ts` | E26 — UTF-8 subject/body/attachment round-trip; CR/LF header injection stripped. |
| `__tests__/tools.test.ts` | Real lease handler over fake lane + mocked Gmail REST: E15 downgrade refuses next call (0 Gmail calls) + bridge tier re-check, E18 accounts, E19 account_required (no lease), E20 untrusted + html contentType, E22 maxResults BVA, E23 confirm content, E24 confirm outcomes/headless, E25 reply threading, X6 429 no retry; downgrade during reply confirm refuses send; oversize attachment refused. |
| `attachments.ts` | `saveInsideCwd` (realpath parent inside cwd via `isPathInside`; `O_EXCL\|O_NOFOLLOW`, mode 0600; `exists`/`path_refused`) + `readInsideCwd` (realpath inside cwd, file, ≤20 MiB). Rejects `\\\\`/`//`/drive/NUL forms. TOCTOU on parent swap documented, not prevented. |
| `gmail-api.ts` | `GmailApi(base,token,fetch)` — list/getMessage/getThread/labels/attachment/createDraft/send/modify(batchModify)/trash; 30 s timeout; 429→`rate_limited`, 5xx→`gmail_unavailable` (+Retry-After), never retried. `header`, `extractBody` (plain, else html flagged), `listAttachments`. |
| `index.ts` | Bridge entry. `declareToGuard(host)` pushes to `Symbol.for("pi.untrusted-content-guard\")` registry (create-or-adopt; order-independent). `activate` registers `createGmailTools` with a real `LeaseClient`. |
| `lease-client.ts` | `LeaseClient(request=requestPluginServer)`: `lease(account,op)` one lane call per tool call (no cache), re-checks returned tier (`tier_denied`); `accounts()`. Parses `<code>: <detail>` into `GmailToolError{code}`; `unavailable` explained. |
| `mime.ts` | `buildMime` RFC 2822 (UTF-8 encoded-word headers, base64 text, multipart/mixed attachments, In-Reply-To/References, CR/LF stripped; `"`/`\\` in filename → `_`) + `toRaw` base64url. |
| `tools.ts` | `createGmailTools({leases,endpoints,fetchImpl})`. `gmail_accounts` (no account, trusted); reads `gmail_search` (1–50, metadata), `gmail_get` (msg/thread, html→`contentType:text/html`), `gmail_labels`, `gmail_attachments` (list/save; >20 MiB refused `too_large` before decode) — all `details.untrusted=true`; writes `gmail_draft`/`gmail_send`/`gmail_reply` (threading; `read` lease for the original, fresh `send` lease AFTER confirm)/`gmail_modify`/`gmail_trash` — `ctx.ui.confirm` (account, recipients, subject, ≤500-char preview), headless → `blocked`, false/throw → `denied`. `splitAddresses` splits To/Cc on commas outside quotes/angles; replyAll drops recipients by exact `addressOf` match (self + reply-to), never substring. Missing account → `account_required` listing accounts, no lease. `READ_TOOLS`/`WRITE_TOOLS`. |
