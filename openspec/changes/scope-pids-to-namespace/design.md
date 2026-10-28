# Design

## Context

Line numbers refer to `origin/develop` at planning time.

The server stores `session_register.pid` as `session.pid`, with `pidRecordedAt`
(`packages/server/src/session/memory-session-manager.ts:479-482`). It records
nowhere which pid namespace that number belongs to.

**Where `session_register` is built and read:**
- built at:
  - `packages/extension/src/session-sync.ts:154,298`
  - `packages/extension/src/bridge-handlers/lifecycle.ts:585`
  - `packages/extension/src/bridge.ts:1695` (provisional)
  - `packages/server/src/acp-bridge/acp-session-adapter.ts:134`
- read through `pi-gateway.ts:808-825` (the provisional path, via the field
  whitelist in `pi/provisional-registration.ts:53-62`) and `:929,991`.

**Server consumers that treat `session.pid` / `msg.pid` as a local pid:**

| Consumer | Location | Use |
|---|---|---|
| terminator | `spawn-process/session-terminator.ts:128,147-163,169,178` | `signalZero`, `processStartedAt`, `killProcess` |
| shutdown | `browser-handlers/session-action-handler.ts:1063-1085` | orphan signal |
| force-kill | `session-action-handler.ts:1316-1345` | WS close, `killProcess`, mark ended |
| carrier-loss reason | `session/death-reason.ts:24-33`, called at `pi/pi-gateway.ts:367,400,417,476` | `signalZero` |
| idle-reaper probe | `embed-lifecycle/idle-reaper.ts:153-157` | `deps.probe(s.pid)` |
| registry linking | `event-wiring.ts:1725-1738`, `spawn-process/headless-pid-registry.ts:441-464` | `linkByPid`, cwd-FIFO |
| register watchdog | `pi-gateway.ts:958-961` → `spawn-process/spawn-register-watchdog.ts:209-215` | `clearByPid` |
| process-list classification | `spawn-process/process-classifier.ts:43-49`, called at `event-wiring.ts:2793` | `pidIndex` |
| bridge contention | `pi/bridge-contention.ts:93-99` | same-pid fast-accept |

**The existing bugs** (remote origin on any OS, WSL on a Windows server,
container bridges) are listed in the proposal.

## Decisions

### D1 — Bridge evidence: `pidNamespace`

One builder, `buildPidNamespace()`, lives in `packages/shared`. It is used at
every bridge register site, and the ACP bridge process calls it in-process. It
returns:
`{ platform, kind: "host" | "wsl", distro?, nsId?, hostId? }`

| Field | Value |
|---|---|
| `platform` | `process.platform` |
| `kind` / `distro` | `"wsl"` with `distro` when `WSL_DISTRO_NAME` is non-empty, else `"host"` |
| `nsId` | Linux only: the `/proc/self/ns/pid` link |
| `hostId` | Linux: `/proc/sys/kernel/random/boot_id` (per boot, per kernel; WSL2 distros share the VM's). Elsewhere: `os.hostname()`, a weak discriminator, documented. |

Unreadable fields are omitted.

The server computes its own `ServerPidContext` once, at startup, with the same
fields.

It stores `pidNamespace` atomically with `pid` / `pidRecordedAt`, on both the
direct and the provisional path. `provisional-registration.ts`'s whitelist gains
the field. A register that sets `pid` replaces it. A register without `pid`
clears both.

### D2 — `resolvePidTarget(session, ctx, ownEntryPid?)` → `host | {wsl, distro} | foreign | unknown`

The first matching rule wins:

1. `session.originDeviceId` ⇒ `foreign`.
2. A report is present:
   1. `platform` ≠ the server's platform ⇒ `foreign`. Exception: a
      `platform: "linux", kind: "wsl"` report to a **win32** server ⇒
      `{wsl, distro}`.
   2. The server is Linux:
      - either side lacks `hostId` or `nsId` ⇒ `unknown` (never `foreign`);
      - `hostId` differs ⇒ `foreign` (another machine or VM);
      - `nsId` differs ⇒ `foreign` (a container, or another WSL distro);
      - otherwise ⇒ `host`. This covers a dashboard in the same WSL distro.
   3. The server is macOS or Windows (a `host` report): either side lacks
      `hostId` ⇒ `unknown` (S1); `hostId` differs ⇒ `foreign`; otherwise ⇒ `host`.
3. No report (a legacy bridge):
   - `ownEntryPid` (the pid of the headless registry entry already linked to
     **this** session) equals `session.pid` ⇒ `host`, because the server spawned it;
   - on win32, a POSIX-style `cwd` (leading `/`) ⇒ `legacy-wsl`, which is handled
     exactly like `{wsl}` but with no distro known (no signal is ever possible);
   - win32, otherwise ⇒ `unknown`;
   - POSIX ⇒ `host`, as today.

**Link time** (`linkByPid`, cwd-FIFO, `clearByPid`) evaluates the same rules
without `ownEntryPid`, so it is never circular.

**The terminator resolves once, before the registry rung.** It captures
`registryPid = getPid(sessionId)` and uses it as `ownEntryPid`. A registry kill
that deletes the entry therefore cannot change the verdict.

### D3 — Consumer semantics

`T` = the target. "Non-local" = `{wsl}`, `legacy-wsl` or `foreign`.

| Consumer | `host` | non-local | `unknown` |
|---|---|---|---|
| terminator, unattended (`operator: false`) | today | `refused-identity` before liveness | `refused-identity` before liveness |
| terminator, operator shutdown (`operator: true`) | today | `not-local`, no signal | win32: today's signal (D4); POSIX: `not-local` |
| shutdown result handling | today | `session_orphaned` with the pid (it survived; unchanged requirement) + log | today |
| force-kill | today | **refused**: no signal, no WS close, not marked ended, `success: false`, "process not on this host — use Shutdown" | win32: today's signal (D4); POSIX: refused |
| `classifyCarrierLoss(session, target)` | `signalZero` | `unknown` | `unknown` |
| idle-reaper probe | `deps.probe` | `{ok: false}` | `{ok: false}` |
| registry `linkByPid` | allowed | skipped | only when `entry.cwd === msg.cwd` |
| registry cwd-FIFO | allowed | skipped | allowed |
| watchdog `clearByPid` | allowed | skipped | allowed |
| process-list `pidIndex` | indexed | not indexed | not indexed |
| bridge-contention same-pid fast-accept | allowed | decided as contention | win32: allowed; POSIX: contention |

- `TerminateOptions` gains an explicit `operator: boolean`. `shutdownSession`
  sets it; the reaper, caps and automation do not. It replaces any inference
  from `verifyIdentity`.
- `not-local` occurs only on the operator path.
- Unattended refusals reuse `refused-identity`, so `reclaim-give-up.ts` and
  `caps.ts` handle them unchanged.

### D4 — Q8: `unknown` on operator paths (Windows only)

Decided (Q8, option A): keep today's signal. The `legacy-wsl` rule above removes the WSL case,
so `unknown` on win32 now means "a legacy native Windows pi", whose pid is a
Windows pid. Refusing would make every pre-upgrade session unstoppable from the
dashboard until its bridge reloads. Unattended paths refuse `unknown`. On Linux and
macOS servers, `unknown` comes only from unreadable `/proc` fields on either side,
so it is refused on operator paths too.

### D5 — Enforcement: deny by default

A repo test scans `packages/server/src` for calls to `signalZero`, `killProcess`,
`killPidWithGroup`, `killProcessGroup`, `isProcessAlive` and `processStartedAt`,
and to the reaper `probe`, whose argument expression reads a `.pid` member. Every
match must be in a file on an allowlist. A file joins the allowlist only together
with a `resolvePidTarget` call in the same module. New consumers therefore fail
until they are reviewed.

### D6 — Descendant wording

The stale sentence in *Unattended reclamation* ("no termination path signals a
process group on Unix today…") is replaced with the minimal true statement: "This
requirement does not assert descendant termination." No new claim is added.

### D7 — Ordering with `guard-restored-headless-identity` (#914)

Both changes edit the terminator ladder. The order is:
1. resolve the target (this change);
2. registry rung, honouring #914's `refused-identity`;
3. liveness and escalation by target.

There is no dependency file: each change is self-consistent alone. The
implementer of the second change to land follows this order.

### D8 — Gate decisions (Q8, S1–S11; all accepted)

Q8 is recorded in D4. The rest refine D1–D5:

- **S1** A macOS or Windows report that lacks `hostId`, or a server context that
  lacks it, ⇒ `unknown`, as on Linux (rule 2.3). Spec follow-up: see the chain note below.
- **S2** Force-kill with no recorded pid runs the existing no-pid branch (WS close,
  `success: true`, WS-only message) BEFORE target resolution. Nothing is signalled,
  so a remote-origin session without a pid keeps today's behaviour.
- **S3** The same-pid fast-accept requires the incumbent's stored target AND the
  newcomer's target to be both `host`, or both `unknown` on Windows. Otherwise
  the register is decided as a contention. The incumbent target uses the same
  resolver on the incumbent's stored `pid` / `pidNamespace`.
- **S4** The D5 scan flags a helper call in a non-allowlisted server file
  whatever its argument shape (aliases such as `const {pid} = s` cannot slip
  through). The allowlist has two kinds of entry: `resolves` (must contain a
  `resolvePidTarget(` call) and an explicit `own-spawn` tag (exempt from that
  rule: `headless-pid-registry`, `home-lock`, `server.ts`, `cli.ts`,
  `keeper-manager`, `terminal-manager`, … — files that signal only pids of
  processes the server itself spawned). `__tests__` directories are excluded. The call
  must be real code: a match in a comment or string literal does not count.
- **S5** `pidNamespace` is persisted with `pid` wherever `DashboardSession.pid`
  is persisted. A restored session therefore resolves by its recorded report,
  not as legacy, in the window before its bridge re-registers.
- **S6** `pidNamespace` is server-internal. It is stripped from every browser
  payload (`session_list`, `session_updated`, REST) and every paired-peer
  payload, because `boot_id` is a host identifier the UI does not need.
- **S7** A malformed `pidNamespace` (wrong types, `kind: "wsl"` without a
  `distro`, an array or `null`, strings over the caps) is treated as an
  unusable report: the resolver returns `unknown` (never legacy `host`, never
  `foreign`). The register itself still succeeds. Caps: `distro` 64
  characters, `hostId` / `nsId` 128. A bridge that sent nothing is still
  "no report" (rule 3).
- **S8** An operator `not-local` shutdown still runs the registry rung: a token
  links the server's own spawn, which is local by construction. Target
  resolution gates only the pid rungs. `terminate("", { spawnToken })` has no
  session to resolve, so it runs the registry rung by token and no pid rung.
- **S10** There is no timing threshold for the resolver or builder. The resolver
  performs no I/O per call: `ServerPidContext` is computed once at startup.
  This is asserted structurally (no `fs` / `child_process` import in
  `pid-target.ts`), not timed.
- **S11** The watchdog's `clearByCwd` stays for non-local registers (a
  dashboard-spawned WSL session legitimately clears by cwd). Only the `pid` tier
  is skipped.

**Chain note (S1).** Spec Resolution 4 (`force-kill-handler`, ADDED here, re-stated
by the MODIFIED block of `add-windows-process-identity`) still reads "`hostId`
differs ⇒ foreign, otherwise host". The S1 wording change belongs in both
blocks; it is not applied here because a later change restates that block.

## Risks

- **A legacy Linux container on a POSIX server** (no report) resolves `host`, as
  today. This residual ends when bridges upgrade. A report-bearing container is
  `foreign` by `nsId`.
- **macOS and Windows tunnels with the same hostname** are trusted as `host`
  (weak `hostId`).
- **Linux with unreadable `/proc` fields** resolves `unknown`, so unattended
  reclaim is refused for it.
