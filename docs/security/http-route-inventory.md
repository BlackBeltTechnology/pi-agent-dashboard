# HTTP route inventory — core server (364 routes)
> Evidence base: HEAD e54074304 · Parent chapter: [http-gates-and-routes.md](http-gates-and-routes.md) · Map index: [security-map.md](../security-map.md) · Register: [residual-risks.md](residual-risks.md)

| Method | Path | Handler path:line | Required tier / per-route guard | Mutating | Danger class |
|---|---|---|---|---|---|
| GET | `/auth/login` | `packages/server/src/auth/auth-plugin.ts:365` | n/a | N | info |
| GET | `/auth/start/:provider` | `packages/server/src/auth/auth-plugin.ts:390` | n/a | N | info |
| GET | `/auth/callback/:provider` | `packages/server/src/auth/auth-plugin.ts:404` | n/a | N | info |
| POST | `/auth/logout` | `packages/server/src/auth/auth-plugin.ts:468` | n/a | Y | state |
| GET | `/auth/status` | `packages/server/src/auth/auth-plugin.ts:476` | n/a | N | info |
| POST | `/api/device-session` | `packages/server/src/auth/bearer-auth.ts:146` | observe | Y | secrets/credentials |
| DELETE | `/api/device-session` | `packages/server/src/auth/bearer-auth.ts:162` | observe | Y | secrets/credentials |
| GET | `/auth/passkey/status` | `packages/server/src/auth/passkey/passkey-routes.ts:103` | n/a | N | info |
| GET | `/auth/passkey/webauthn.js` | `packages/server/src/auth/passkey/passkey-routes.ts:108` | n/a | N | info |
| GET | `/auth/passkey/<asset>` | `packages/server/src/auth/passkey/passkey-routes.ts:114` | n/a | N | info |
| GET | `/auth/invite` | `packages/server/src/auth/passkey/passkey-routes.ts:119` | n/a | N | info |
| GET | `/auth/phone` | `packages/server/src/auth/passkey/passkey-routes.ts:120` | n/a | N | info |
| POST | `/auth/passkey/register/options` | `packages/server/src/auth/passkey/passkey-routes.ts:123` | n/a | Y | state |
| POST | `/auth/passkey/register/verify` | `packages/server/src/auth/passkey/passkey-routes.ts:132` | n/a | Y | state |
| POST | `/auth/passkey/login/options` | `packages/server/src/auth/passkey/passkey-routes.ts:145` | n/a | Y | state |
| POST | `/auth/passkey/login/verify` | `packages/server/src/auth/passkey/passkey-routes.ts:154` | n/a | Y | state |
| POST | `/auth/passkey/phone/start` | `packages/server/src/auth/passkey/passkey-routes.ts:167` | n/a | Y | state |
| GET | `/auth/passkey/phone/poll/:requestId` | `packages/server/src/auth/passkey/passkey-routes.ts:186` | n/a | N | info |
| POST | `/auth/passkey/phone/lookup` | `packages/server/src/auth/passkey/passkey-routes.ts:198` | n/a | Y | state |
| POST | `/auth/passkey/phone/view` | `packages/server/src/auth/passkey/passkey-routes.ts:205` | n/a | Y | state |
| POST | `/auth/passkey/phone/approve` | `packages/server/src/auth/passkey/passkey-routes.ts:212` | n/a | Y | state |
| POST | `/auth/passkey/phone/deny` | `packages/server/src/auth/passkey/passkey-routes.ts:226` | n/a | Y | state |
| POST | `/api/csp-reports/reset` | `packages/server/src/auth/csp-report-sink.ts:296` | operate + `networkGuard` | Y | config |
| [...SINK_METHODS] | `` `${CSP_REPORT_PREFIX}` `` | `packages/server/src/auth/csp-report-sink.ts:271` | n/a | Y | state |
| GET | `/auth/status` | `packages/server/src/server.ts:2519` | n/a | N | info |
| GET | `/api/identity/login-config` | `packages/server/src/server.ts:2532` | observe | N | info |
| POST | `/api/identity/local-code` | `packages/server/src/server.ts:2542` | operate | Y | secrets/credentials |
| POST | `/api/identity/local-exchange` | `packages/server/src/server.ts:2551` | operate | Y | secrets/credentials |
| GET | `/api/identity/me` | `packages/server/src/server.ts:2569` | observe | N | info |
| POST | `/api/ws-ticket` | `packages/server/src/server.ts:3459` | operate + `networkGuard` | Y | secrets/credentials |
| GET | `/` | `packages/server/src/server.ts:3777` | n/a | N | info |
| GET | `/index.html` | `packages/server/src/server.ts:3778` | n/a | N | info |
| GET | `/` | `packages/server/src/server.ts:3793` | n/a | N | info |
| GET | `/index.html` | `packages/server/src/server.ts:3794` | n/a | N | info |
| GET | `/api/preferences/auto-name` | `packages/server/src/routes/preferences-auto-name-routes.ts:31` | observe + `networkGuard` | N | info |
| GET | `/api/auto-name-outcomes` | `packages/server/src/routes/preferences-auto-name-routes.ts:44` | observe + `networkGuard` | N | info |
| PATCH | `/api/preferences/auto-name` | `packages/server/src/routes/preferences-auto-name-routes.ts:52` | control + `networkGuard` | Y | state |
| GET | `/api/pi-core/changelog` | `packages/server/src/routes/pi-changelog-routes.ts:51` | observe | N | info |
| GET | `/v1/models` | `packages/server/src/routes/model-proxy-routes.ts:149` | n/a | N | network-egress |
| POST | `/v1/chat/completions` | `packages/server/src/routes/model-proxy-routes.ts:178` | n/a | Y | network-egress |
| POST | `/v1/messages` | `packages/server/src/routes/model-proxy-routes.ts:181` | n/a | Y | network-egress |
| GET | `/api/sessions` | `packages/server/src/routes/session-routes.ts:125` | observe | N | info |
| GET | `/api/sessions/archived` | `packages/server/src/routes/session-routes.ts:163` | observe | N | info |
| GET | `/api/sessions/archived/:id` | `packages/server/src/routes/session-routes.ts:197` | observe | N | info |
| DELETE | `/api/sessions/archived/:id` | `packages/server/src/routes/session-routes.ts:226` | control + `networkGuard` | Y | state |
| GET | `/api/events/:sessionId/:seq` | `packages/server/src/routes/session-routes.ts:243` | observe | N | info |
| GET | `/api/sessions/:sessionId/tool-result/:toolCallId` | `packages/server/src/routes/session-routes.ts:264` | observe + `networkGuard` | N | fs-read |
| GET | `/api/session-change/:sessionId/:toolCallId` | `packages/server/src/routes/session-routes.ts:316` | observe + `networkGuard` | N | info |
| GET | `/api/sessions/:sessionId/entry/:entryId` | `packages/server/src/routes/session-routes.ts:347` | observe + `networkGuard` | N | info |
| GET | `/api/session-diff` | `packages/server/src/routes/session-routes.ts:383` | observe + `networkGuard` | N | fs-read |
| GET | `/api/sessions/:sessionId/retained-transcript` | `packages/server/src/routes/session-routes.ts:439` | observe + `networkGuard` | N | fs-read |
| GET | `/api/session-file` | `packages/server/src/routes/session-routes.ts:505` | observe + `networkGuard` | N | fs-read |
| POST | `/api/tls/issue` | `packages/server/src/routes/tls-routes.ts:31` | operate + `deps.networkGuard` | Y | config, network-egress |
| GET | `/api/runtime/status` | `packages/server/src/routes/runtime-routes.ts:193` | observe + `deps.networkGuard` | N | info |
| POST | `/api/runtime/source` | `packages/server/src/routes/runtime-routes.ts:216` | operate + `quietMutation` | Y | exec/spawn |
| POST | `/api/runtime/update` | `packages/server/src/routes/runtime-routes.ts:224` | operate + `mutation` | Y | exec/spawn |
| POST | `/api/runtime/activate` | `packages/server/src/routes/runtime-routes.ts:241` | operate + `quietMutation` | Y | exec/spawn |
| POST | `/api/runtime/rollback` | `packages/server/src/routes/runtime-routes.ts:276` | operate + `quietMutation` | Y | exec/spawn |
| POST | `/api/config/plugins/:id` | `packages/server/src/routes/plugin-config-routes.ts:66` | operate + `networkGuard` | Y | config |
| PUT | `/api/tls/acme/:sourceId` | `packages/server/src/routes/acme-routes.ts:88` | operate + `networkGuard` | Y | config |
| DELETE | `/api/tls/acme/:sourceId` | `packages/server/src/routes/acme-routes.ts:127` | operate + `networkGuard` | Y | config |
| PUT | `/api/tls/acme/:sourceId/credentials` | `packages/server/src/routes/acme-routes.ts:146` | operate + `[networkGuard, manageGuard]` | Y | secrets/credentials, config |
| GET | `/api/packages/health` | `packages/server/src/routes/package-health-routes.ts:66` | observe | N | info |
| POST | `/api/packages/cleanup` | `packages/server/src/routes/package-health-routes.ts:75` | operate | Y | exec/spawn |
| GET | `/api/addons/catalog` | `packages/server/src/routes/addons-routes.ts:141` | observe + `networkGuard` | N | info |
| POST | `/api/addons/:featureId/toggle` | `packages/server/src/routes/addons-routes.ts:168` | operate + `networkGuard` | Y | exec/spawn |
| GET | `/api/model-proxy/api-keys` | `packages/server/src/routes/model-proxy-api-key-routes.ts:37` | operate + `networkGuard` | N | secrets/credentials |
| POST | `/api/model-proxy/api-keys` | `packages/server/src/routes/model-proxy-api-key-routes.ts:62` | operate + `networkGuard` | Y | secrets/credentials |
| POST | `/api/model-proxy/api-keys/:id/revoke` | `packages/server/src/routes/model-proxy-api-key-routes.ts:112` | operate + `networkGuard` | Y | secrets/credentials |
| DELETE | `/api/model-proxy/api-keys/:id` | `packages/server/src/routes/model-proxy-api-key-routes.ts:142` | control + `networkGuard` | Y | secrets/credentials |
| GET | `/api/pi-core/versions` | `packages/server/src/routes/pi-core-routes.ts:49` | observe | N | info |
| POST | `/api/pi-core/update` | `packages/server/src/routes/pi-core-routes.ts:64` | operate | Y | exec/spawn |
| GET | `/api/pi-retry` | `packages/server/src/routes/pi-retry-routes.ts:34` | observe + `networkGuard` | N | info |
| PUT | `/api/pi-retry` | `packages/server/src/routes/pi-retry-routes.ts:42` | control + `networkGuard` | Y | config |
| GET | `/api/folder/project` | `packages/server/src/routes/folder-project-routes.ts:54` | observe + `networkGuard` | N | fs-read |
| GET | `/api/known-servers` | `packages/server/src/routes/known-servers-routes.ts:206` | operate + `networkGuard` | N | info |
| POST | `/api/known-servers` | `packages/server/src/routes/known-servers-routes.ts:215` | operate + `mutationGuard` | Y | config |
| DELETE | `/api/known-servers` | `packages/server/src/routes/known-servers-routes.ts:301` | operate + `mutationGuard` | Y | config |
| POST | `/api/known-servers/accept-move` | `packages/server/src/routes/known-servers-routes.ts:336` | operate + `mutationGuard` | Y | config |
| POST | `/api/known-servers/probe` | `packages/server/src/routes/known-servers-routes.ts:437` | operate + `mutationGuard` | Y | config, network-egress |
| POST | `/api/discover-servers` | `packages/server/src/routes/known-servers-routes.ts:470` | operate + `networkGuard` | Y | network-egress |
| POST | `/api/pair/challenge` | `packages/server/src/routes/pairing-routes.ts:336` | operate | Y | state |
| GET | `/api/pair/payload` | `packages/server/src/routes/pairing-routes.ts:357` | operate + `networkGuard` | N | info |
| POST | `/api/pair/redeem` | `packages/server/src/routes/pairing-routes.ts:373` | operate | Y | secrets/credentials |
| POST | `/api/pair/request` | `packages/server/src/routes/pairing-routes.ts:406` | operate | Y | state |
| POST | `/api/pair/approve` | `packages/server/src/routes/pairing-routes.ts:473` | operate + `approvalGuard` | Y | secrets/credentials |
| GET | `/api/pair/pending` | `packages/server/src/routes/pairing-routes.ts:521` | operate + `operatorGuard` | N | info |
| POST | `/api/pair/approve-pending` | `packages/server/src/routes/pairing-routes.ts:528` | operate + `approvalGuard` | Y | secrets/credentials |
| POST | `/api/pair/deny` | `packages/server/src/routes/pairing-routes.ts:559` | operate + `approvalGuard` | Y | state |
| POST | `/api/pair/poll` | `packages/server/src/routes/pairing-routes.ts:578` | operate | Y | secrets/credentials |
| GET | `/api/paired-devices` | `packages/server/src/routes/pairing-routes.ts:607` | operate + `networkGuard` | N | secrets/credentials |
| DELETE | `/api/paired-devices/:id` | `packages/server/src/routes/pairing-routes.ts:617` | operate + `operatorGuard` | Y | state |
| POST | `/api/paired-devices` | `packages/server/src/routes/pairing-routes.ts:638` | operate + `operatorGuard` | Y | secrets/credentials |
| GET | `/api/pair/reachable-urls` | `packages/server/src/routes/pairing-routes.ts:681` | operate + `networkGuard` | N | info |
| GET | `/api/preferences/worktree-auto-init` | `packages/server/src/routes/preferences-worktree-init-routes.ts:26` | observe + `networkGuard` | N | info |
| PATCH | `/api/preferences/worktree-auto-init` | `packages/server/src/routes/preferences-worktree-init-routes.ts:34` | control + `networkGuard` | Y | state |
| GET | `/api/pi-settings` | `packages/server/src/routes/pi-settings-routes.ts:169` | operate + `networkGuard` | N | info |
| PUT | `/api/pi-settings` | `packages/server/src/routes/pi-settings-routes.ts:182` | operate + `networkGuard` | Y | fs-write, config |
| PUT | `/api/pi-settings/raw` | `packages/server/src/routes/pi-settings-routes.ts:195` | operate + `networkGuard` | Y | fs-write, config |
| POST | `/api/pi-settings/sync-defaults` | `packages/server/src/routes/pi-settings-routes.ts:218` | operate + `networkGuard` | Y | fs-write, config |
| POST | `/api/pi-settings/legacy-credentials` | `packages/server/src/routes/pi-settings-routes.ts:236` | operate + `networkGuard` | Y | secrets/credentials, config |
| POST | `/api/csp-violations` | `packages/server/src/routes/csp-violations-routes.ts:135` | observe + `deps.networkGuard` | Y | state |
| GET | `/api/csp-violations` | `packages/server/src/routes/csp-violations-routes.ts:158` | operate + `deps.networkGuard` | N | info |
| GET | `/manifest.json` | `packages/server/src/routes/manifest-route.ts:151` | n/a | N | info |
| GET | `/api/git/branches` | `packages/server/src/routes/git-routes.ts:286` | observe + `networkGuard` | N | git |
| POST | `/api/git/checkout` | `packages/server/src/routes/git-routes.ts:309` | control + `networkGuard` | Y | git |
| POST | `/api/git/init` | `packages/server/src/routes/git-routes.ts:337` | control + `networkGuard` | Y | git |
| GET | `/api/git/status` | `packages/server/src/routes/git-routes.ts:361` | observe + `networkGuard` | N | git |
| GET | `/api/git/changed-files` | `packages/server/src/routes/git-routes.ts:379` | observe + `networkGuard` | N | git |
| POST | `/api/git/commit` | `packages/server/src/routes/git-routes.ts:400` | control + `networkGuard` | Y | git |
| POST | `/api/git/commit-draft` | `packages/server/src/routes/git-routes.ts:438` | control + `networkGuard` | Y | git |
| GET | `/api/git/head` | `packages/server/src/routes/git-routes.ts:482` | observe + `networkGuard` | N | git |
| GET | `/api/git/worktrees` | `packages/server/src/routes/git-routes.ts:500` | observe + `networkGuard` | N | git |
| GET | `/api/git/worktree/init-status` | `packages/server/src/routes/git-routes.ts:522` | observe + `networkGuard` | N | git |
| GET | `/api/git/worktree/active-inits` | `packages/server/src/routes/git-routes.ts:567` | observe + `networkGuard` | N | git |
| POST | `/api/git/worktree/init` | `packages/server/src/routes/git-routes.ts:580` | control + `networkGuard` | Y | git |
| POST | `/api/git/worktree` | `packages/server/src/routes/git-routes.ts:692` | control + `networkGuard` | Y | git |
| POST | `/api/git/worktree/orphan-cleanup` | `packages/server/src/routes/git-routes.ts:754` | control + `networkGuard` | Y | git |
| POST | `/api/git/worktree/remove` | `packages/server/src/routes/git-routes.ts:824` | control + `networkGuard` | Y | git |
| POST | `/api/git/worktree/remove-batch` | `packages/server/src/routes/git-routes.ts:890` | control + `networkGuard` | Y | git |
| POST | `/api/git/worktree/prune` | `packages/server/src/routes/git-routes.ts:1008` | control + `networkGuard` | Y | git |
| POST | `/api/git/worktree/merge` | `packages/server/src/routes/git-routes.ts:1023` | control + `networkGuard` | Y | git |
| POST | `/api/git/worktree/push` | `packages/server/src/routes/git-routes.ts:1056` | control + `networkGuard` | Y | git |
| POST | `/api/git/worktree/pr` | `packages/server/src/routes/git-routes.ts:1085` | control + `networkGuard` | Y | git |
| GET | `/api/git/pull-requests` | `packages/server/src/routes/git-routes.ts:1131` | observe + `networkGuard` | N | git |
| POST | `/api/git/worktree/from-pr` | `packages/server/src/routes/git-routes.ts:1161` | control + `networkGuard` | Y | git |
| GET | `/api/git/worktree/diff-stat` | `packages/server/src/routes/git-routes.ts:1203` | observe + `networkGuard` | N | git |
| POST | `/api/git/stash-pop` | `packages/server/src/routes/git-routes.ts:1227` | control + `networkGuard` | Y | git |
| POST | `/api/nav-intent` | `packages/server/src/routes/nav-intent-routes.ts:29` | observe + `deps.networkGuard` | Y | state |
| POST | `/api/nav-intent/verify` | `packages/server/src/routes/nav-intent-routes.ts:41` | observe + `deps.networkGuard` | Y | state |
| GET | `/api/host-gate` | `packages/server/src/routes/host-gate-routes.ts:20` | operate + `deps.networkGuard` | N | info |
| GET | `/api/plugins/runtime-clients` | `packages/server/src/routes/plugin-runtime-client-routes.ts:81` | observe + `networkGuard` | N | info |
| POST | `/api/plugins/:id/trust` | `packages/server/src/routes/plugin-runtime-client-routes.ts:119` | operate + `networkGuard` | Y | config |
| DELETE | `/api/plugins/:id/trust` | `packages/server/src/routes/plugin-runtime-client-routes.ts:137` | operate + `networkGuard` | Y | config |
| GET | `/api/push/vapid-public-key` | `packages/server/src/routes/push-routes.ts:117` | observe | N | info |
| POST | `/api/push/register` | `packages/server/src/routes/push-routes.ts:123` | operate | Y | state |
| GET | `/api/push/register` | `packages/server/src/routes/push-routes.ts:144` | operate | N | info |
| DELETE | `/api/push/register/:tokenId` | `packages/server/src/routes/push-routes.ts:159` | operate | Y | state |
| POST | `/api/push/test` | `packages/server/src/routes/push-routes.ts:166` | operate | Y | network-egress |
| GET | `/api/providers` | `packages/server/src/routes/provider-routes.ts:297` | observe + `networkGuard` | N | info |
| PUT | `/api/providers` | `packages/server/src/routes/provider-routes.ts:308` | operate + `networkGuard` | Y | config |
| PATCH | `/api/providers/:name` | `packages/server/src/routes/provider-routes.ts:422` | operate + `networkGuard` | Y | config |
| DELETE | `/api/providers/:name` | `packages/server/src/routes/provider-routes.ts:510` | operate + `networkGuard` | Y | config |
| POST | `/api/providers/:name/refresh` | `packages/server/src/routes/provider-routes.ts:549` | operate + `networkGuard` | Y | config, network-egress |
| POST | `/api/providers/test` | `packages/server/src/routes/provider-routes.ts:573` | operate + `networkGuard` | Y | config, network-egress |
| POST | `/api/local-proof` | `packages/server/src/routes/local-proof-routes.ts:43` | operate | Y | secrets/credentials |
| GET | `/auth/local-proof` | `packages/server/src/routes/local-proof-routes.ts:51` | n/a | N | secrets/credentials |
| GET | `/api/packages/recommended` | `packages/server/src/routes/recommended-routes.ts:334` | observe | N | network-egress |
| GET | `/api/tools` | `packages/server/src/routes/tool-routes.ts:62` | observe + `networkGuard` | N | info |
| GET | `/api/tools/:name` | `packages/server/src/routes/tool-routes.ts:77` | observe + `networkGuard` | N | info |
| POST | `/api/tools/rescan` | `packages/server/src/routes/tool-routes.ts:91` | operate + `networkGuard` | Y | exec/spawn |
| PUT | `/api/tools/:name` | `packages/server/src/routes/tool-routes.ts:112` | operate + `networkGuard` | Y | fs-write |
| DELETE | `/api/tools/:name` | `packages/server/src/routes/tool-routes.ts:160` | control + `networkGuard` | Y | fs-write |
| POST | `/api/tools/diagnostics` | `packages/server/src/routes/tool-routes.ts:179` | operate + `networkGuard` | Y | state |
| GET | `/api/users` | `packages/server/src/routes/user-routes.ts:92` | operate + `operatorGuard` | N | secrets/credentials |
| POST | `/api/users` | `packages/server/src/routes/user-routes.ts:105` | operate + `operatorGuard` | Y | secrets/credentials |
| PATCH | `/api/users/:id` | `packages/server/src/routes/user-routes.ts:121` | operate + `operatorGuard` | Y | secrets/credentials |
| POST | `/api/users/:id/revoke` | `packages/server/src/routes/user-routes.ts:131` | operate + `operatorGuard` | Y | secrets/credentials |
| POST | `/api/users/:id/invites` | `packages/server/src/routes/user-routes.ts:141` | operate + `operatorGuard` | Y | secrets/credentials |
| DELETE | `/api/users/invites/:inviteId` | `packages/server/src/routes/user-routes.ts:167` | operate + `operatorGuard` | Y | secrets/credentials |
| GET | `/api/users/credentials/impact` | `packages/server/src/routes/user-routes.ts:173` | operate + `operatorGuard` | N | secrets/credentials |
| GET | `/api/sessions/:sessionId/attachments/:attachmentId` | `packages/server/src/routes/attachment-routes.ts:43` | observe + `networkGuard` | N | fs-read |
| POST | `/api/mermaid/repair` | `packages/server/src/routes/mermaid-repair-routes.ts:211` | control + `deps.networkGuard` | Y | network-egress |
| GET | `/api/access/prompts` | `packages/server/src/routes/access-prompt-routes.ts:164` | observe + `networkGuard` | N | info |
| POST | `/api/access/prompts/:promptId` | `packages/server/src/routes/access-prompt-routes.ts:184` | operate + `networkGuard` | Y | config |
| GET | `/api/access/yolo/roots` | `packages/server/src/routes/access-prompt-routes.ts:206` | observe + `networkGuard` | N | info |
| POST | `/api/access/yolo` | `packages/server/src/routes/access-prompt-routes.ts:221` | operate + `networkGuard` | Y | config |
| DELETE | `/api/access/yolo` | `packages/server/src/routes/access-prompt-routes.ts:242` | operate + `networkGuard` | Y | config |
| DELETE | `/api/access/refusals` | `packages/server/src/routes/access-prompt-routes.ts:249` | operate + `networkGuard` | Y | config |
| GET | `/api/node/installs` | `packages/server/src/routes/node-runtime-routes.ts:101` | observe + `networkGuard` | N | info |
| POST | `/api/node/installs/select` | `packages/server/src/routes/node-runtime-routes.ts:112` | operate + `networkGuard` | Y | exec/spawn |
| GET | `/api/access/grants` | `packages/server/src/routes/access-routes.ts:159` | observe + `networkGuard` | N | info |
| DELETE | `/api/access/grants` | `packages/server/src/routes/access-routes.ts:188` | operate + `networkGuard` | Y | config |
| DELETE | `/api/access/worktree-trust` | `packages/server/src/routes/access-routes.ts:218` | operate + `networkGuard` | Y | config |
| DELETE | `/api/access/bypass-hosts` | `packages/server/src/routes/access-routes.ts:248` | operate + `networkGuard` | Y | config |
| DELETE | `/api/access/trusted-network` | `packages/server/src/routes/access-routes.ts:276` | operate + `networkGuard` | Y | config |
| DELETE | `/api/access/cors-origin` | `packages/server/src/routes/access-routes.ts:296` | operate + `networkGuard` | Y | config |
| DELETE | `/api/access/preview-egress` | `packages/server/src/routes/access-routes.ts:323` | operate + `networkGuard` | Y | config |
| DELETE | `/api/access/project-trust` | `packages/server/src/routes/access-routes.ts:350` | operate + `networkGuard` | Y | config |
| DELETE | `/api/access/pinned-directory` | `packages/server/src/routes/access-routes.ts:379` | operate + `networkGuard` | Y | config |
| POST | `/api/access/grants` | `packages/server/src/routes/access-routes.ts:405` | operate + `networkGuard` | Y | config |
| GET | `/api/access/pi-trust` | `packages/server/src/routes/access-routes.ts:502` | observe + `networkGuard` | N | info |
| PUT | `/api/access/pi-trust/choice` | `packages/server/src/routes/access-routes.ts:580` | operate + `networkGuard` | Y | config |
| GET | `/api/access/store-stats` | `packages/server/src/routes/access-routes.ts:609` | observe + `networkGuard` | N | info |
| POST | `/api/access/provision` | `packages/server/src/routes/access-routes.ts:642` | operate + `networkGuard` | Y | config |
| GET | `/api/access/provision` | `packages/server/src/routes/access-routes.ts:654` | observe + `networkGuard` | N | info |
| GET | `/api/access/provision/:id` | `packages/server/src/routes/access-routes.ts:658` | observe + `networkGuard` | N | info |
| POST | `/api/access/provision/dismiss-all` | `packages/server/src/routes/access-routes.ts:666` | operate + `networkGuard` | Y | config |
| POST | `/api/access/provision/:id/settle` | `packages/server/src/routes/access-routes.ts:674` | operate + `networkGuard` | Y | config |
| POST | `/api/resources/toggle` | `packages/server/src/routes/resource-activation-routes.ts:130` | operate | Y | exec/spawn |
| POST | `/api/resources/trust` | `packages/server/src/routes/resource-activation-routes.ts:195` | operate + `networkGuard` | Y | config |
| POST | `/api/resources/reload` | `packages/server/src/routes/resource-activation-routes.ts:237` | operate + `networkGuard` | Y | exec/spawn |
| POST | `/api/file/write-binary` | `packages/server/src/routes/file-write-binary-routes.ts:288` | control + `networkGuard` | Y | fs-write |
| POST | `/api/model-proxy/refresh` | `packages/server/src/routes/model-proxy-refresh-routes.ts:11` | operate | Y | state |
| GET | `/api/provider-auth/providers` | `packages/server/src/routes/provider-auth-routes.ts:129` | operate | N | secrets/credentials |
| GET | `/api/provider-auth/handlers` | `packages/server/src/routes/provider-auth-routes.ts:137` | operate | N | secrets/credentials |
| GET | `/api/provider-auth/radius/mcp` | `packages/server/src/routes/provider-auth-routes.ts:156` | operate | N | secrets/credentials |
| POST | `/api/provider-auth/radius/mcp` | `packages/server/src/routes/provider-auth-routes.ts:161` | operate | Y | secrets/credentials |
| GET | `/api/provider-auth/status` | `packages/server/src/routes/provider-auth-routes.ts:172` | operate | N | secrets/credentials |
| GET | `/api/provider-auth/catalogue-ready` | `packages/server/src/routes/provider-auth-routes.ts:190` | observe | N | secrets/credentials |
| GET | `/api/provider-auth/legacy-provider-ids` | `packages/server/src/routes/provider-auth-routes.ts:204` | operate | N | secrets/credentials |
| POST | `/api/provider-auth/start` | `packages/server/src/routes/provider-auth-routes.ts:211` | operate | Y | secrets/credentials |
| GET | `/api/provider-auth/flow/:flowId` | `packages/server/src/routes/provider-auth-routes.ts:249` | operate | N | secrets/credentials |
| POST | `/api/provider-auth/flow/:flowId/input` | `packages/server/src/routes/provider-auth-routes.ts:261` | operate | Y | secrets/credentials |
| DELETE | `/api/provider-auth/flow/:flowId` | `packages/server/src/routes/provider-auth-routes.ts:279` | operate | Y | secrets/credentials |
| PUT | `/api/provider-auth/api-key` | `packages/server/src/routes/provider-auth-routes.ts:290` | operate | Y | secrets/credentials |
| DELETE | `/api/provider-auth/:provider` | `packages/server/src/routes/provider-auth-routes.ts:327` | operate | Y | secrets/credentials |
| GET | `/api/packages/search` | `packages/server/src/routes/package-routes.ts:65` | observe | N | network-egress |
| GET | `/api/packages/readme` | `packages/server/src/routes/package-routes.ts:80` | observe | N | network-egress |
| GET | `/api/packages/installed` | `packages/server/src/routes/package-routes.ts:103` | observe | N | info |
| POST | `/api/packages/install` | `packages/server/src/routes/package-routes.ts:132` | operate | Y | exec/spawn |
| POST | `/api/packages/remove` | `packages/server/src/routes/package-routes.ts:165` | operate | Y | exec/spawn |
| POST | `/api/packages/update` | `packages/server/src/routes/package-routes.ts:198` | operate | Y | exec/spawn |
| POST | `/api/packages/move` | `packages/server/src/routes/package-routes.ts:228` | operate | Y | exec/spawn |
| POST | `/api/packages/reset-to-npm` | `packages/server/src/routes/package-routes.ts:309` | operate | Y | exec/spawn |
| POST | `/api/packages/check-updates` | `packages/server/src/routes/package-routes.ts:368` | operate | Y | network-egress |
| GET | `/api/model-proxy/diagnostics` | `packages/server/src/routes/model-proxy-diagnostics-routes.ts:18` | operate | N | info |
| GET | `/api/plugins` | `packages/server/src/routes/plugin-activation-routes.ts:272` | observe + `networkGuard` | N | info |
| POST | `/api/plugins/:id/toggle` | `packages/server/src/routes/plugin-activation-routes.ts:363` | operate + `networkGuard` | Y | exec/spawn |
| POST | `/api/test/force-shed` | `packages/server/src/routes/system-routes.ts:441` | operate (unlisted→fail-closed) + `networkGuard` | Y | state |
| GET | `/api/config` | `packages/server/src/routes/system-routes.ts:456` | operate + `networkGuard` | N | info |
| GET | `/api/tunnel/endpoints` | `packages/server/src/routes/system-routes.ts:483` | operate + `networkGuard` | N | info |
| POST | `/api/tunnel/enroll` | `packages/server/src/routes/system-routes.ts:513` | operate + `networkGuard` | Y | exec/spawn |
| GET | `/api/tunnel/block-events` | `packages/server/src/routes/system-routes.ts:532` | operate + `networkGuard` | N | info |
| POST | `/api/tunnel/block-events` | `packages/server/src/routes/system-routes.ts:568` | operate + `networkGuard` | Y | state |
| PUT | `/api/config` | `packages/server/src/routes/system-routes.ts:616` | operate + `networkGuard` | Y | config |
| GET | `/api/auth/diagnostics` | `packages/server/src/routes/system-routes.ts:784` | operate + `networkGuard` | N | info |
| DELETE | `/api/config/auth/providers/:id` | `packages/server/src/routes/system-routes.ts:808` | control + `networkGuard` | Y | config |
| GET | `/api/tunnel-readiness` | `packages/server/src/routes/system-routes.ts:858` | observe + `networkGuard` | N | info |
| GET | `/api/tunnel-status` | `packages/server/src/routes/system-routes.ts:875` | observe | N | info |
| GET | `/api/tunnel-status-detail` | `packages/server/src/routes/system-routes.ts:903` | observe + `networkGuard` | N | info |
| POST | `/api/tunnel-connect` | `packages/server/src/routes/system-routes.ts:921` | operate | Y | exec/spawn |
| POST | `/api/tunnel-reserved-name` | `packages/server/src/routes/system-routes.ts:996` | operate + `networkGuard` | Y | state |
| POST | `/api/tunnel-disconnect` | `packages/server/src/routes/system-routes.ts:1093` | operate | Y | exec/spawn |
| GET | `/api/health` | `packages/server/src/routes/system-routes.ts:1141` | observe | N | info |
| POST | `/api/shutdown` | `packages/server/src/routes/system-routes.ts:1523` | operate + `networkGuard` | Y | exec/spawn |
| POST | `/api/electron/reextract` | `packages/server/src/routes/system-routes.ts:1552` | operate + `networkGuard` | Y | exec/spawn |
| POST | `/api/restart` | `packages/server/src/routes/system-routes.ts:1571` | operate + `networkGuard` | Y | exec/spawn |
| GET | `/api/spawn-failures` | `packages/server/src/routes/system-routes.ts:1665` | observe | N | info |
| GET | `/api/network-interfaces` | `packages/server/src/routes/system-routes.ts:1676` | operate + `localhostGuard` | N | info |
| GET | `/api/doctor` | `packages/server/src/routes/doctor-routes.ts:212` | observe | N | info |
| GET | `/api/grep` | `packages/server/src/routes/grep-routes.ts:46` | observe + `networkGuard` | N | fs-read |
| POST | `/api/live-server/start` | `packages/server/src/routes/live-server-routes.ts:189` | operate + `networkGuard` | Y | exec/spawn |
| POST | `/api/live-server/start-static` | `packages/server/src/routes/live-server-routes.ts:229` | observe + `networkGuard` | Y | state |
| GET | `/api/live-server/list` | `packages/server/src/routes/live-server-routes.ts:256` | operate + `networkGuard` | N | info |
| GET | `/api/live-server/policy` | `packages/server/src/routes/live-server-routes.ts:266` | observe + `networkGuard` | N | info |
| DELETE | `/api/live-server/:id` | `packages/server/src/routes/live-server-routes.ts:278` | operate + `networkGuard` | Y | state |
| POST | `/api/live-server/:id/capability` | `packages/server/src/routes/live-server-routes.ts:296` | observe + `networkGuard` | Y | state |
| POST | `/api/live-server/:id/touch` | `packages/server/src/routes/live-server-routes.ts:335` | observe + `networkGuard` | Y | state |
| GET | `/api/live-server/:id/egress` | `packages/server/src/routes/live-server-routes.ts:390` | control + `networkGuard` | N | info |
| POST | `/api/live-server/:id/allow-once` | `packages/server/src/routes/live-server-routes.ts:415` | control + `networkGuard` | Y | state |
| POST | `/api/live-server/:id/egress-grant-request` | `packages/server/src/routes/live-server-routes.ts:467` | control + `networkGuard` | Y | state |
| GET | `/api/preferences/display` | `packages/server/src/routes/preferences-display-routes.ts:31` | observe + `networkGuard` | N | info |
| PATCH | `/api/preferences/display` | `packages/server/src/routes/preferences-display-routes.ts:39` | control + `networkGuard` | Y | state |
| GET | `/api/acp/agents` | `packages/server/src/routes/acp-routes.ts:15` | control | N | info |
| GET | `/api/canvas-types` | `packages/server/src/routes/canvas-types-routes.ts:56` | observe + `networkGuard` | N | info |
| PATCH | `/api/canvas-types` | `packages/server/src/routes/canvas-types-routes.ts:67` | control + `networkGuard` | Y | state |
| GET | `/api/browse` | `packages/server/src/routes/file-routes.ts:615` | observe + `networkGuard` | N | fs-read |
| GET | `/api/browse/flags` | `packages/server/src/routes/file-routes.ts:648` | observe + `networkGuard` | N | fs-read |
| POST | `/api/browse/mkdir` | `packages/server/src/routes/file-routes.ts:669` | control + `networkGuard` | Y | fs-write |
| POST | `/api/browse/create-project` | `packages/server/src/routes/file-routes.ts:700` | control + `networkGuard` | Y | fs-write |
| GET | `/api/file` | `packages/server/src/routes/file-routes.ts:725` | observe + `networkGuard` | N | fs-read |
| GET | `/api/file/digest` | `packages/server/src/routes/file-routes.ts:814` | observe + `networkGuard` | N | fs-read |
| POST | `/api/open-in-system` | `packages/server/src/routes/file-routes.ts:925` | operate + `networkGuard` | Y | exec/spawn |
| POST | `/api/reveal-in-file-manager` | `packages/server/src/routes/file-routes.ts:931` | operate + `networkGuard` | Y | exec/spawn |
| GET | `/api/file/tree` | `packages/server/src/routes/file-routes.ts:944` | observe + `networkGuard` | N | fs-read |
| POST | `/api/file/write` | `packages/server/src/routes/file-routes.ts:1016` | control + `networkGuard` | Y | fs-write |
| GET | `/api/file/md-candidates` | `packages/server/src/routes/file-routes.ts:1052` | observe + `networkGuard` | N | fs-read |
| GET | `/api/file/md-read` | `packages/server/src/routes/file-routes.ts:1077` | observe + `networkGuard` | N | fs-read |
| GET | `/api/file/exists` | `packages/server/src/routes/file-routes.ts:1117` | observe + `networkGuard` | N | fs-read |
| POST | `/api/file/resolve-mention` | `packages/server/src/routes/file-routes.ts:1204` | observe + `networkGuard` | Y | state |
| GET | `/api/pinned-dirs` | `packages/server/src/routes/file-routes.ts:1226` | observe | N | info |
| GET | `/api/favorite-models` | `packages/server/src/routes/file-routes.ts:1232` | observe | N | info |
| GET | `/api/file/raw` | `packages/server/src/routes/file-routes.ts:1241` | observe + `networkGuard` | N | fs-read |
| GET | `/api/file/render` | `packages/server/src/routes/file-routes.ts:1416` | observe + `networkGuard` | N | fs-read |
| GET | `/api/file/rendered-pdf` | `packages/server/src/routes/file-routes.ts:1558` | observe + `networkGuard` | N | fs-read |
| GET | `/api/file/sheet` | `packages/server/src/routes/file-routes.ts:1603` | observe + `networkGuard` | N | fs-read |
| GET | `/api/file/eml` | `packages/server/src/routes/file-routes.ts:1657` | observe + `networkGuard` | N | fs-read |
| GET | `/api/file/eml-attachment` | `packages/server/src/routes/file-routes.ts:1715` | observe + `networkGuard` | N | fs-read |
| POST | `/api/diagram/render` | `packages/server/src/routes/file-routes.ts:1783` | control + `networkGuard` | Y | exec/spawn |
| GET | `/api/models` | `packages/server/src/routes/models-introspection-routes.ts:69` | observe | N | info |
| GET | `/api/custom-event-groups` | `packages/server/src/routes/custom-event-groups-routes.ts:27` | observe + `networkGuard` | N | info |
| GET | `/api/openspec/config` | `packages/server/src/routes/openspec-routes.ts:256` | observe + `networkGuard` | N | info |
| POST | `/api/openspec/config` | `packages/server/src/routes/openspec-routes.ts:402` | control + `networkGuard` | Y | fs-write |
| POST | `/api/openspec/update` | `packages/server/src/routes/openspec-routes.ts:449` | control + `networkGuard` | Y | exec/spawn |
| GET | `/api/openspec/dependencies` | `packages/server/src/routes/openspec-routes.ts:706` | observe + `networkGuard` | N | info |
| PUT | `/api/openspec/dependencies` | `packages/server/src/routes/openspec-routes.ts:781` | control + `networkGuard` | Y | fs-write |
| POST | `/api/openspec/init` | `packages/server/src/routes/openspec-routes.ts:835` | control + `networkGuard` | Y | exec/spawn |
| GET | `/api/openspec/update-status` | `packages/server/src/routes/openspec-routes.ts:985` | observe + `networkGuard` | N | info |
| GET | `/api/openspec-archive` | `packages/server/src/routes/openspec-routes.ts:1003` | observe + `networkGuard` | N | fs-read |
| GET | `/api/pi-resources` | `packages/server/src/routes/openspec-routes.ts:1020` | observe + `networkGuard` | N | info |
| GET | `/api/pi-resources/commands` | `packages/server/src/routes/openspec-routes.ts:1070` | observe + `networkGuard` | N | info |
| GET | `/api/pi-resource-file` | `packages/server/src/routes/openspec-routes.ts:1103` | observe + `networkGuard` | N | fs-read |
| GET | `/api/openspec/tasks` | `packages/server/src/routes/openspec-routes.ts:1145` | observe + `networkGuard` | N | info |
| POST | `/api/openspec/tasks/toggle` | `packages/server/src/routes/openspec-routes.ts:1173` | control + `networkGuard` | Y | fs-write |
| GET | `/api/openspec/groups` | `packages/server/src/routes/openspec-group-routes.ts:110` | observe + `networkGuard` | N | info |
| POST | `/api/openspec/groups` | `packages/server/src/routes/openspec-group-routes.ts:127` | control + `networkGuard` | Y | fs-write |
| PATCH | `/api/openspec/groups/:id` | `packages/server/src/routes/openspec-group-routes.ts:155` | control | Y | fs-write |
| DELETE | `/api/openspec/groups/:id` | `packages/server/src/routes/openspec-group-routes.ts:200` | control + `networkGuard` | Y | fs-write |
| PUT | `/api/openspec/groups/assignments` | `packages/server/src/routes/openspec-group-routes.ts:221` | control + `networkGuard` | Y | fs-write |
| PUT | `/api/openspec/groups/change-order` | `packages/server/src/routes/openspec-group-routes.ts:250` | control + `networkGuard` | Y | fs-write |
| GET | `/api/pi/installs` | `packages/server/src/routes/pi-runtime-routes.ts:101` | observe + `networkGuard` | N | info |
| POST | `/api/pi/runtime` | `packages/server/src/routes/pi-runtime-routes.ts:112` | operate + `networkGuard` | Y | exec/spawn |
| ALL | `/live/:id/*` | `packages/server/src/live-server/live-server-proxy.ts:304` | n/a | Y | proxy (live preview) |
| ALL | `/live/:id` | `packages/server/src/live-server/live-server-proxy.ts:305` | n/a | Y | proxy (live preview) |
| GET | `/api/services` | `packages/server/src/services/routes.ts:84` | observe + `read`=[networkGuard] | N | info |
| GET | `/api/services/offers` | `packages/server/src/services/routes.ts:85` | observe + `read`=[networkGuard] | N | info |
| GET | `/api/services/runtimes` | `packages/server/src/services/routes.ts:86` | observe + `read`=[networkGuard] | N | info |
| GET | `/api/services/:id` | `packages/server/src/services/routes.ts:87` | observe + `read`=[networkGuard] | N | info |
| GET | `/api/services/:id/logs` | `packages/server/src/services/routes.ts:89` | operate + `write`=[networkGuard, mutationGuard] | N | info |
| POST | `/api/services` | `packages/server/src/services/routes.ts:91` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| DELETE | `/api/services/:id` | `packages/server/src/services/routes.ts:100` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| POST | `/api/services/:id/ensure` | `packages/server/src/services/routes.ts:104` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| POST | `/api/services/:id/start` | `packages/server/src/services/routes.ts:119` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| POST | `/api/services/:id/retry` | `packages/server/src/services/routes.ts:120` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| POST | `/api/services/:id/stop` | `packages/server/src/services/routes.ts:121` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| POST | `/api/services/:id/pin` | `packages/server/src/services/routes.ts:124` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| POST | `/api/services/:id/unpin` | `packages/server/src/services/routes.ts:125` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| POST | `/api/services/:id/prefetch` | `packages/server/src/services/routes.ts:126` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| POST | `/api/services/:id/reset-data` | `packages/server/src/services/routes.ts:127` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| POST | `/api/services/prune` | `packages/server/src/services/routes.ts:128` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| PUT | `/api/services/:id/secrets/:name` | `packages/server/src/services/routes.ts:135` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn, secrets/credentials |
| GET | `/api/vault` | `packages/server/src/vault/vault-routes.ts:168` | operate + `manage`=[networkGuard, vaultManageGuard] | N | secrets/credentials |
| GET | `/api/vault/projects` | `packages/server/src/vault/vault-routes.ts:181` | operate + `manage`=[networkGuard, vaultManageGuard] | N | secrets/credentials |
| POST | `/api/vault/accounts` | `packages/server/src/vault/vault-routes.ts:198` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| PUT | `/api/vault/accounts/:id/value` | `packages/server/src/vault/vault-routes.ts:202` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| DELETE | `/api/vault/accounts/:id` | `packages/server/src/vault/vault-routes.ts:206` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| POST | `/api/vault/bindings` | `packages/server/src/vault/vault-routes.ts:208` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| PUT | `/api/vault/bindings/:name/default` | `packages/server/src/vault/vault-routes.ts:212` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| DELETE | `/api/vault/bindings/:name` | `packages/server/src/vault/vault-routes.ts:217` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| POST | `/api/vault/grants` | `packages/server/src/vault/vault-routes.ts:222` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| DELETE | `/api/vault/grants` | `packages/server/src/vault/vault-routes.ts:227` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| POST | `/api/vault/confirmations` | `packages/server/src/vault/vault-routes.ts:233` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| DELETE | `/api/vault/confirmations` | `packages/server/src/vault/vault-routes.ts:238` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| PUT | `/api/vault/plugin-approvals/:pluginId/:bindingName` | `packages/server/src/vault/vault-routes.ts:244` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| DELETE | `/api/vault/plugin-approvals/:pluginId/:bindingName` | `packages/server/src/vault/vault-routes.ts:248` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| GET | `/api/vault/import/candidates` | `packages/server/src/vault/vault-routes.ts:253` | operate + `manage`=[networkGuard, vaultManageGuard] | N | secrets/credentials |
| POST | `/api/vault/import/propose` | `packages/server/src/vault/vault-routes.ts:254` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| POST | `/api/vault/import/confirm` | `packages/server/src/vault/vault-routes.ts:263` | operate + `manage`=[networkGuard, vaultManageGuard] | Y | secrets/credentials |
| GET | `/api/session/:id/vault-bindings` | `packages/server/src/vault/vault-routes.ts:268` | observe + `networkGuard` | N | secrets/credentials |
| GET | `/api/questions` | `packages/server/src/questions/question-routes.ts:76` | observe + `guard` | N | info |
| GET | `/api/questions/:id` | `packages/server/src/questions/question-routes.ts:81` | observe + `guard` | N | info |
| POST | `/api/questions/:id/answer` | `packages/server/src/questions/question-routes.ts:87` | control + `guard` | Y | state |
| POST | `/api/questions/:id/summarize` | `packages/server/src/questions/question-routes.ts:120` | control + `guard` | Y | network-egress |
| POST | `/api/session/:id/prompt` | `packages/server/src/session/session-api.ts:120` | control | Y | exec/spawn (agent) |
| POST | `/api/session/:id/abort` | `packages/server/src/session/session-api.ts:206` | control | Y | exec/spawn (agent) |
| POST | `/api/session/:id/shutdown` | `packages/server/src/session/session-api.ts:221` | control | Y | exec/spawn (agent), exec/spawn |
| POST | `/api/session/:id/rename` | `packages/server/src/session/session-api.ts:242` | control | Y | state |
| POST | `/api/session/:id/archive` | `packages/server/src/session/session-api.ts:267` | control | Y | state |
| POST | `/api/session/:id/unarchive` | `packages/server/src/session/session-api.ts:288` | control | Y | state |
| POST | `/api/session/spawn` | `packages/server/src/session/session-api.ts:302` | control | Y | exec/spawn (agent) |
| POST | `/api/session/:id/resume` | `packages/server/src/session/session-api.ts:374` | control | Y | exec/spawn (agent) |
| POST | `/api/session/:id/flow-control` | `packages/server/src/session/session-api.ts:532` | control | Y | state |
| POST | `/api/session/:id/model` | `packages/server/src/session/session-api.ts:556` | control | Y | state |
| POST | `/api/session/:id/thinking-level` | `packages/server/src/session/session-api.ts:576` | control | Y | state |
| POST | `/api/session/:id/lifecycle` | `packages/server/src/session/session-api.ts:601` | control + `networkGuard` | Y | exec/spawn (agent) |
| POST | `/api/session/:id/extension-ui-response` | `packages/server/src/session/session-api.ts:650` | control + `networkGuard` | Y | state |
| POST | `/api/session/:id/attach-proposal` | `packages/server/src/session/session-api.ts:679` | control | Y | state |
| POST | `/api/session/:id/detach-proposal` | `packages/server/src/session/session-api.ts:708` | control | Y | state |
| POST | `/api/pi-trust/query` | `packages/server/src/routes/pi-trust-query-routes.ts:307` | operate + `onRequest:admit` | Y | state |
| POST | `/api/paired-devices/rotate` | `packages/server/src/routes/pairing-routes.ts:232` | observe | Y | secrets/credentials |
| POST | `/__pi/csp-report/:policy` | `packages/server/src/auth/csp-report-sink.ts:271` | n/a + `admit+screen` | Y | state |
| POST | `/api/services/:id/heartbeat` | `packages/server/src/services/routes.ts:110` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
| POST | `/api/services/:id/release` | `packages/server/src/services/routes.ts:110` | operate + `write`=[networkGuard, mutationGuard] | Y | exec/spawn |
