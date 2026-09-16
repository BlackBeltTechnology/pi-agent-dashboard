## Context

See `proposal.md` — Why. Four independent server surfaces, each with a stricter sibling already in the tree:

| Surface | Today | Stricter sibling that exists |
|---|---|---|
| `openspec_refresh` (`browser-handlers/directory-handler.ts` → `directoryService.refreshOpenSpec`) | only `openspec.enabled` gate; force-polls any `cwd` | `getOrPollOpenSpec` gate chain: enabled → `isOptedOutCwd` → `isTrackedCwd` → `hasOpenSpecRoot` |
| `DELETE /api/paired-devices/:id`, `POST /api/pair/approve` (`routes/pairing-routes.ts`) | `networkGuard` (admits `authVia === "device"`) | `createOperatorGuard` on `POST /api/paired-devices` |
| `git-operations.ts` `addWorktree`, `addWorktreeFromPr`, `mergeWorktree`, `pushBranch`, `createPullRequest`, `worktreeDiffStat`, fetch, hint verifies, `run`/`tryRun` | `execSync(string)` + `shellEscape` | `removeWorktree` / branch delete / `pruneWorktrees` already argv via `execFileSync` / `spawnSync` (#512) |
| Host gate default (`auth/host-gate.ts` `resolveHostGateMode`) | `report` | `enforce` mode fully implemented and spec'd, opt-in |

Constraints: no protocol change and no shared *type* change (one shared *default value* moves — see D4); every **synchronous** child process goes through the `platform/exec.js` wrappers for `windowsHide` (the file also holds one `ban:child_process-ok` `node:child_process` import for the async HEAD read, because the wrapper's `execFileAsync` loses the `util.promisify.custom` shape — that import stays); tests spy `platformExec.execFileSync` / `spawnSync` (pattern in `__tests__/git-worktree-lifecycle-ops.test.ts`).

## Goals / Non-Goals

**Goals:**
- Each surface uses the guard its sibling already uses; no new guard concept.
- Argv migration is behaviour-preserving: same exit-code → error-code mapping, same timeouts, same stdout trimming.
- Host-gate flip is a one-constant change plus the copy/docs that describe the default; the opt-out already exists.

**Non-Goals:**
- Tightening `approve` to session-only (dropping the genuinely-local admission `qr-device-pairing` already forbids in prose). That is a pre-existing spec/impl gap and a separate decision.
- `X-Forwarded-Host` handling; per-hostname tightening of `*.local`.
- Migrating `tryRun` call sites whose command is a constant string beyond what the signature change forces.
- Any change to `getOrPollOpenSpec`.

## Decisions

### D1 — a new `refreshOpenSpecGated` service method; `refreshOpenSpec`'s contract is untouched

Add `directoryService.refreshOpenSpecGated(cwd): Promise<OpenSpecData | null>` that applies the gate chain in `getOrPollOpenSpec`'s order — opt-out → tracked → root, after the same `cfg.enabled` check — and returns `null` on any gate failure **without** writing the cache, spawning, or probing the filesystem. On a pass it delegates to `refreshOpenSpec`. `handleOpenSpecRefresh` becomes its only caller and skips the broadcast on `null`.

*Why a new method rather than gating `refreshOpenSpec` itself:* `refreshOpenSpec` has **four** internal callers, and a `null` return breaks three of them —
`server.ts:1555` (group re-order) broadcasts the resolved value directly, so `null` would put `data: null` on the wire (a protocol violation);
`session/session-bootstrap.ts:132` (cold-boot poll) broadcasts over `knownDirectories()`, which does **not** filter opted-out cwds, so `null` would ship on every boot and would break the "Initial poll on server startup" scenario this change must preserve;
`routes/openspec-routes.ts:441` (`POST /api/openspec/init`) reads `data.readiness`, which would throw a `TypeError` swallowed by the route's `catch` into a silently degraded response;
`routes/openspec-routes.ts:611` (task toggle) ignores the result and is benign only by luck.
None of the four takes a caller-supplied cwd, so none needs the gate. A separate method keeps the gate at a service-level choke point — a future browser-facing caller reaches for the gated name — without changing a contract four callers depend on.

*Note:* an earlier draft asserted `handleOpenSpecBulkArchive` was `refreshOpenSpec`'s other caller. It is not: it calls `pollDirectoryGated`, and its own comment says it deliberately skips `refreshOpenSpec`.

*Why `null` instead of a placeholder broadcast:* the client only renders folders for tracked cwds, so a broadcast for an untracked cwd has no consumer; silence matches `openspec_get`'s "no broadcast" rule for gated answers.

*Alternatives rejected:* gating in the handler only (no service-level choke point); returning the finalized `OPTED_OUT`/`ABSENT` placeholder from `refreshOpenSpec` (no signature change, but internal callers would then observe placeholder data for gated cwds).

Tracked-cwd gate runs BEFORE `hasOpenSpecRoot` (an `fs.stat`) so a hostile cwd never touches the filesystem — same X8 ordering as `getOrPollOpenSpec`.

*Accepted trade-off:* `isTrackedCwd` is strict string equality against session cwds and pins, so a non-canonical spelling of a genuinely tracked cwd (trailing slash, symlink, case variant) gates silently. Identical to `openspec_get` today; matching it is the point of the change, and diverging here would be the surprise.

### D2 — Swap `preHandler` to `operatorGuard` on revoke and approve; refuse a device credential outright; validate label at the route

`pairing-routes.ts` already builds `operatorGuard` from `createOperatorGuard({ localToken, hostAdmission })`; the two routes swap `networkGuard` → `operatorGuard`. The operator guard also applies Host admission in enforce semantics on these routes regardless of the global mode — accepted, since D4 makes enforce the default anyway.

**The guard itself needs one fix first.** `createOperatorGuard` computes `via === "session" || validLocalToken || isGenuinelyLocal(...)`, so a paired-device bearer arriving over loopback is admitted by the third clause. The guard therefore does **not** currently hold the "refuses `authVia === "device"`" property its own docblock claims, and both `bearer-device-auth` ("a request authenticated only by a paired-device bearer SHALL NOT revoke any registry row") and `qr-device-pairing` ("independent of the caller's network position") assert it unqualified. Add a short-circuit: `via === "device"` → `401`, evaluated before the three admission clauses. This also tightens `POST /api/paired-devices`, which asserts the same property — intended, not collateral.

This is narrower than the out-of-scope item: the genuinely-local admission stays for a caller with **no** credential; only an explicit device bearer is refused.

Label bound: validate in the route handler, mirroring the mint route's existing check (~`pairing-routes.ts:219-226`) — `trim`, then `400` when `trimmed.length === 0 || Buffer.byteLength(trimmed, "utf8") > MAX_DEVICE_LABEL_BYTES`. A non-`string` `label` already degrades to `undefined` via the route's existing `typeof label === "string" ? label : undefined` guard (`:166`), i.e. it is treated as absent — acceptable under "label absent keeps the pending label"; no new type check is needed. The **lower** bound is the load-bearing part: `pairing.ts:250` does `registry.add(label ?? pending.label, …)`, and `"" ?? x` is `""`, so a whitespace-only label would silently overwrite the redemption label with an empty string and violate the normative "1..64 bytes". Pass the trimmed value to `pairing.approve`; validation stays out of `PairingManager.approve` — the manager has no HTTP status vocabulary and the bound is a transport-level concern the mint route already owns.

*Residual (recorded, not fixed):* `qr-device-pairing` also says approval "SHALL NOT honor any loopback/tunnel exemption"; after the device short-circuit `operatorGuard` still admits a genuinely-local caller with no credential at all. Filed as an open question below.

### D3 — Argv migration: change `run`/`tryRun` to take `string[]`, delete `shellEscape`

`run(argv: string[], cwd)` → `execFileSync(argv[0], argv.slice(1), { cwd, encoding, stdio, timeout, env })`; `tryRun` unchanged in shape. Every caller becomes an array literal (`["git", "rev-parse", "--verify", `refs/heads/${base}`]`). The sites that concatenate `args.map(shellEscape).join(" ")` (`createPullRequest`, `pushBranch`, `listPullRequests`, `addWorktree`) already hold an argv — they just stop joining it. `worktreeDiffStat` passes `${base}..${branch}` as one element. `mergeWorktree`'s three `execSync` calls (`checkout`, `merge --no-ff`, `branch -d`) become `execFileSync` with the same `stdio`/`timeout` options.

**`env` must stay in the forwarded option set.** `createPullRequest` passes `GH_PROMPT_DISABLED: "1"` and the fetch passes `GIT_TERMINAL_PROMPT: "0"`; dropping `env` would let `gh`/`git` block on an interactive credential prompt until the 15 s timeout and the "terminal prompts disabled" stderr classifier would never fire — a silent regression of both the timeout and the error-code contract.

**Full site inventory** (all must migrate, or the zero-`execSync` assertion below fails): the `run` helper itself (`:55`), `getDirtyFiles` (`:81`, constant command), the `tryRun` verifies in `checkoutMode` (`:669`)/`resolveDefaultBase` (`:1170`)/the origin hint (`:1201`)/`@{upstream}` (`:1388`)/`git log -1` (`:1452`), the arg-join site at `:716`, `mergeWorktree`'s three (`:1247`, `:1260`, `:1287`), `worktreeDiffStat` (`:1320`), `pushBranch` (`:1357`), `createPullRequest` (`:1418`), `listPullRequests` (`:1771`), the fetch (`:1875`), and `addWorktreeFromPr`'s add step (`:1912`). `shellEscape` is deleted with its last caller **and its two remaining comment mentions (`:1097`, `:1118`) rewritten**, otherwise the source-token assertion trips on a comment.

**Windows binary resolution — do NOT route through `buildSafeArgv`.** `platformExec.execFileSync` is a thin `nodeExecFileSync(file, args, withHide(options))` and does not apply `buildSafeArgv`; that is correct here and must stay that way. `buildSafeArgv` routes an extensionless name or a `.cmd`/`.bat` shim through `cmd.exe /d /s /c` — **a shell interpreter, with the args unquoted for cmd syntax**. Using it would re-expose `&`, `|`, `%`, `^` in a branch name or PR title to cmd.exe and directly violate this change's own new requirement ("no shell interpreter on any platform", "no process other than git SHALL be started").

Instead, argv[0] is the **already-resolved absolute binary path** the route layer passes in: `createPullRequest` and `listPullRequests` take `opts.ghPath`, which `git-routes.ts:915,962` fills from `getDefaultRegistry().resolve("gh")`, and the existing `args` arrays already start with `ghPath`. An absolute path carrying an extension bypasses PATHEXT entirely, which is why the already-migrated argv sites (`removeWorktree`, `pruneWorktrees`) work today. Tests therefore assert argv[0] is the injected `ghPath`, not the literal `"gh"`.

*Residual (recorded):* if `resolve("gh")` yields a bare name or a `.cmd` shim on Windows, `execFileSync` fails `ENOENT` where the old shell path would have run it. That is a **fail-closed** regression, not an injection, and it is the correct trade against re-introducing a shell; the QA VM layer covers the Windows path.

Error mapping: for a **non-zero exit** `execFileSync` throws the same `{ status, stderr, stdout }` shape as `execSync`, so `classify*`/stable-code logic is unchanged. Two deltas to verify rather than assume: (a) a **missing binary** throws `ENOENT` with `status: null` and no `stderr`, where the shell previously produced `status 127` plus a stderr line — the git-missing classification path must still land on its stable code; (b) `mergeWorktree` already concatenates `err.stdout` with `err.stderr` because git writes conflict notices to stdout, and that concatenation must be preserved verbatim (it is satisfied by the error object, not by any shell redirection — no site needs `2>&1`).

A repo grep for `execSync(` in `git-operations.ts` must return zero hits — pinned by a test that imports the module source and asserts the token is absent, so the property cannot silently regress.

*Alternative rejected:* keep `execSync` and fix `shellEscape` for `cmd.exe` — there is no quoting scheme that is safe for both `sh` and `cmd.exe`; argv is the only platform-neutral form, and it is what the rest of the file already uses.

### D4 — Flip the default in the shared config layer; do not touch mode resolution order

**`resolveHostGateMode`'s `configMode ?? "report"` is unreachable, so flipping it alone is a no-op.** The call sites (`server.ts:1325`, `:1353`) pass `liveHostGateMode()`, which is `getConfigSnapshot().hostGate?.mode ?? "report"` over a snapshot produced by `loadConfig` — and `loadConfig` always materializes `hostGate: { mode: parseHostGateMode(parsed.hostGate?.mode) }` while `DEFAULT_CONFIG` pins `{ mode: "report" }`. `configMode` is therefore never `undefined` in production. The operative default lives in `packages/shared/src/config.ts`.

The flip is **one function**. `parseHostGateMode` at `config.ts:41` is the only place the default is produced — the module-private `DEFAULTS` object (`:964`) carries a `hostGate` entry that nothing reads, because `loadConfig` (`:1565`) hardcodes `hostGate: { mode: parseHostGateMode(parsed.hostGate?.mode) }` with no `defaults.hostGate` fallback. Editing `DEFAULTS` would be an inert no-op; it is left alone.

- `parseHostGateMode(raw)` learns to distinguish **absent** from **unrecognised**, which it currently collapses: `raw === undefined` (the loader passes `parsed.hostGate?.mode`, so absent is exactly `undefined`) → `enforce`; a recognised string → itself; any other value → `report`. Signature grows an optional `absentDefault: HostGateMode = "enforce"` so tests can pin both arms without touching globals. No exported **type** changes.
- `liveHostGateMode(fallback = "enforce")` and `resolveHostGateMode`'s `?? "enforce"` are aligned for consistency, even though both are now belt-and-braces (`configMode` is never `undefined` in production).
- `openspec/specs/shared-config/spec.md`'s "`hostGate.mode` config field" requirement pins "An absent object or an unrecognised `mode` SHALL load as `{ mode: "report" }`" and owns the *Absent defaults to report* / *Unrecognised mode falls back* scenarios. It is this change's loader being flipped, so the change carries a `shared-config` delta splitting that clause — absent → `enforce`, unrecognised → `report`. Without the delta, spec and implementation diverge permanently.

Env still wins; config still applies live; resolution **order** is untouched.

**Boot-line source detection needs plumbing.** The spec requires `source` ∈ `env` | `config` | `default`, but `resolveHostGateMode` returns only `{ mode, envOverridden }`, and `envOverridden` is `false` for an *unrecognised* env value — so `envOverridden ? "env" : configMode ? "config" : "default"` mislabels `PI_DASHBOARD_HOST_GATE=yes` as `default`, and after the flip `configMode` is always defined so `default` would never be reported at all. `source` must be derived from whether the **raw** config file carried `hostGate.mode` (a fact `loadConfig` erases), passed explicitly into the boot line. The boot line states mode + source so a locked-out operator reading `server.log` sees why. Client `?? "report"` fallbacks in `SettingsPanel.tsx` (3 sites: lines 335, 336, 1985) become `?? "enforce"`. These are **defensive only** — `GET /api/config` returns the materialized config in which `hostGate.mode` is always present, so the fallbacks never fire in practice; they are aligned so a future un-materialized payload does not display a lie. The user-visible client work is the `AllowedHostsSection` copy that says the default is report-only, and the `docs/faq.md` line documenting default `"report"`.

*Why now:* `add-host-allowlist-admission` said "flipping the default to enforce is a later, separate change once report-only logs are clean". The admitted set already covers every population the harness, docs, and tunnel flows use (loopback, IP literal, `.local`, `publicBaseUrls`, live tunnel, `allowedHosts`), and the refusal page is self-describing. There is no telemetry that would ever declare logs "clean" across installs; the opt-out is the safety valve.

*Alternative rejected:* a one-release "enforce with soft-fail" mode — adds a third mode and a second flip; the refusal page already tells the operator what to do.

## Risks / Trade-offs

- [Operator locked out after upgrade on an unadmitted hostname (e.g. internal proxy name)] → 403 page names `allowedHosts`/`publicBaseUrls` and `localhost:<port>`; boot log names the mode; CHANGELOG breaking note names `hostGate.mode: "report"` as the rollback. Loopback always works.
- [`openspec_refresh` from a browser whose folder is tracked by a session that just ended and is unpinned] → `isTrackedCwd` includes ended sessions (any status), so the folder stays refreshable until it leaves the registry; matches `openspec_get`.
- [Argv migration changes an error message string that a test or the client matches on] → tests pin argv shape, not stderr text; the stable-code mapping inspects git's stderr which is unchanged by invocation form.
- [A `gh` `.cmd` shim on Windows becomes `ENOENT` under `execFileSync`] → accepted as a **fail-closed** regression, not an injection (see D3 *Residual*); `gh` sites SHALL NOT route through `buildSafeArgv`, which would re-interpose `cmd.exe`. The QA VM layer exercises the Windows path.
- [An unrecognised `hostGate.mode` in `config.json` locks the operator out after the flip] → `parseHostGateMode` keeps `report` for an unrecognised value; only an *absent* value resolves to `enforce`.
- [`operatorGuard` on approve now also refuses a non-admitted Host even in `report` mode] → same as the mint route today; with D4 the global default is enforce anyway.
- [A device that was self-revoking (e.g. a "forget this dashboard" button on a phone UI) breaks] → no such client exists in the repo; the mobile shell's settings drive revocation through the operator's dashboard session.

## Migration Plan

1. Land D1–D3 (no user-visible behaviour change for admitted callers).
2. Land D4 with the CHANGELOG `[Unreleased]` entry under a **Breaking** heading naming the opt-out.
3. Rollback for D4 is config-only (`hostGate.mode: "report"` or `PI_DASHBOARD_HOST_GATE=report`); no code rollback needed.
4. Docker harness + Playwright E2E reach the dashboard on `localhost`/IP literal — verify the suite is unchanged before merge (task).

## Open Questions

- Should `POST /api/pair/approve` drop the genuinely-local admission to match `qr-device-pairing`'s "no loopback exemption" clause? Deferred: does not change this change's specs (only narrows the gate further) and needs a decision on how a no-auth local operator approves at all.
