# DOX — packages/agent-teams-plugin/src/shared

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `plugin-id.ts` | `AGENT_TEAMS_PLUGIN_ID` ("agent-teams", = manifest id) and the `AGENT_TEAMS_EVENT_*` constants (= manifest `emits`). |
| `policy.ts` | Teammate policy: `extensionConfig` keys + `PI_EXT_AGENT_TEAMS_*` env names, `serializePolicy`/`parsePolicy` (fail closed), `policyHash` (what `hello` must report), `skillGrantsFromPaths`, `CONFINING_ENV_KEYS`. |
| `clock.ts` | `Clock` interface (`now`/`setTimeout`/`clearTimeout`) + `systemClock`. Every plugin timer goes through it so tests inject `FakeClock`. |
| `index.ts` | The `shared` entry: re-exports everything below (later changes import from here, never copy). |
| `constants.ts` | Single-source constants: `SCHEMA_VERSION`, member-name regexp/max/reserved list, text caps, `MAX_MAIL_LINES`/`STEER_BLOCK_MAX_LINES`/`PLAN_MAX_LINES`, `truncationMarkerLine`, `MAX_FINAL_TEXT_CHARS`, `NOTIFY_COALESCE_MS`, REST rate constants, `MAIL_BUCKET`, `ENVELOPE_LIMITS`, `compareMailIds`. |
| `types.ts` | Data model: `Team`, `Member`, `Task`, `Mail`, status/close-reason unions, `SessionBinding`. |
| `protocol.ts` | Lane type names, `TEAM_OPS`, `TEAM_TOOLS_BY_ROLE` (+ `LEAD_ONLY_OPS`/`LEAD_ONLY_TOOLS`), `ERROR_CODES`/`OpResult`, tool args/results, hello/busy/idle/ack payloads, `WireMail`/`MailEventPayload`. |
| `text.ts` | `sanitizeText` (C0/C1/ANSI/bidi stripped, `\n`/`\t` kept for bodies), `codePointLength`, `truncateCodePoints`. |
| `mail-format.ts` | `formatEnvelope`/`parseEnvelope`, mail-kind registry (`registerMailKind`, `customTypeForKind`), `capMailLines`/`collapseBlankRuns` (150-line cap, marker counted inside), `formatMail`, `neutralizeEnvelopeLines`, `formatNoticeItem`. |
| `__tests__/` | → see `__tests__/AGENTS.md`. |
