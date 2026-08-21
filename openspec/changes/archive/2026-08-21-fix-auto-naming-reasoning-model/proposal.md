# Fix auto session naming: token-starved title calls, loud failure, `@naming` role

## Why

Automatic session topic-naming has **never produced a single name** on this install, and it
fails with zero diagnostics.

Measured evidence (live system, 2026-08-20):

| Check | Result |
|---|---|
| Sessions with `nameSource: "auto"` (`GET /api/sessions`) | **0 of 3380** |
| `"nameSource":"auto"` in any `~/.pi/agent/sessions/**/*.meta.json` | **0** (174 × `"user"`) |
| `auto_name_error` lines in `~/.pi/dashboard/server.log` (6.8 MB) | **0** |
| `preferences.json#autoNameSessions` | `true` (feature enabled) |
| Sessions with no name at all | 2239 |

**Root cause: the title call is token-starved by reasoning tokens, and the bridge discards the
signal that says so.** Measured against the configured `@fast` model
(`deepseek/deepseek-v4-flash`) with the bridge's exact summarizer prompt:

```
max_tokens=16    finish_reason=length  content=''                      reasoning_tokens=16
max_tokens=64    finish_reason=length  content=''                      reasoning_tokens=64
max_tokens=256   finish_reason=length  content=''                      reasoning_tokens=256
max_tokens=512   finish_reason=length  content=''                      reasoning_tokens=512
max_tokens=1024  finish_reason=stop    content='NULL'                  reasoning_tokens=24
max_tokens=2048  finish_reason=stop    content='Bridge Auto-Namer Fix' reasoning_tokens=724
```

`TITLE_MAX_TOKENS = 16` (`packages/extension/src/auto-session-namer.ts`) is consumed entirely
by reasoning tokens, so the stream ends **truncated** (`done` event `reason: "length"`)
carrying no text. `parseTitle("")` returns `{ wait: true }` — the same verdict as a legitimate
`NULL` sentinel — so the namer applies no name, emits no error, and retries on the next
terminal turn, **forever**. Every upstream gate is healthy: the `agent_end` hook fires
(`bridge.ts:1620`), the pre-filter passes, `@fast` resolves, credentials resolve. The failure
is structurally invisible: zero successes AND zero errors.

Three further facts, established by measurement and adversarial review, shape the fix:

- **Reasoning consumption is nondeterministic and unbounded.** The same input starved at 512
  and succeeded at 1024 and 2048. **No fixed cap can guarantee a title**, so the fix cannot be
  "pick a bigger number" alone — starvation must be a first-class, *bounded* outcome.
- **The stream's stop reason is the correct discriminator, not emptiness.** pi-ai normalizes
  provider finish reasons into `StopReason` and carries it as `reason` on the `done` event
  (`types.d.ts:296`). Truncation is knowable exactly; "empty" merely correlates with it and also
  collides with content-filter refusals and provider flakes.
- **A separate, pre-existing bug can mask this fix.** `seed()` is never called in production and
  `lastSelfApplied` is not carried across reload, so after a reload the bridge observes its OWN
  auto-name, classifies it as external, and latches `nameSource: "user"` with a permanent
  lockout. A session named by this change would be relabelled `user` on the next reload, and the
  "user" counts cited above are plausibly inflated by it. It has a different root cause from
  token starvation and is tracked as its **own investigation** — but it is a known masking risk,
  so live verification here MUST check provenance after a reload, not only right after naming.

Two design defects underlie the naming failure: the model call has no budget headroom, and
**`wait` is unobservable** — a structurally impossible configuration is indistinguishable from
"no clear topic yet". Nothing reaches the log, the toast, or the UI.

Separately, the naming model is **hard-wired to `@fast`**, shared with `compact` and subagent
routing, so making naming work should not force a global model downgrade.

## What Changes

- **Adaptive budget headroom.** Replace the flat 16-token cap with **1024 on a session's first
  attempt, escalating to 2048 once that session has recorded a `starved` verdict**. `max_tokens`
  is a **ceiling, not a charge** — a non-reasoning model still bills ~2 output tokens — so the
  escalation is free on the common path and targets headroom at the sessions that prove they
  need it. (Measured: 512 starved; a success consumed 724 reasoning tokens.)
- **Truncation is a distinct verdict.** Parsing keys on the stream's stop `reason` BEFORE
  inspecting text: `length` yields a `starved` verdict whose text is **never** applied as a
  title (a truncated "Working on" must not become a permanent session name). `toolUse` is
  likewise never applied. This requires `generateTitle` to return the stop reason, not just text.
- **A single bounded attempt budget per session — 3 attempts.** Because starvation is
  nondeterministic AND the raised ceiling would otherwise make a no-topic session burn up to
  2048 tokens per turn forever, `starved` and `waiting` attempts share ONE total budget. Exhausting it stops naming
  permanently with an actionable `auto_name_error` naming the role slot, the resolved model
  reference, and the cause. Transient errors do not consume the budget.
- **Advancing transcript window.** The window is built from the **latest** turn rather than
  permanently from the first, so a retry carries new information. Slice bounds are preserved
  exactly as today (user 200 chars, assistant 2000) — the *which* turn changes, the *how much*
  does not. The pre-filter reads the same advancing window, so a session that opens with a
  greeting is no longer skipped forever.
- **Dedicated `naming` role.** Add `naming` to `DEFAULT_ROLE_NAMES`; resolve via
  `lookupRole("@naming")` with fallback to `@fast`, so existing installs are unchanged. Reuses
  the roles stack — no new persistence, no new REST route, no new source of truth.
- **Inline selector.** Settings renders the single `naming` role row beneath the "Auto-name
  sessions" toggle, driven by the existing roles handlers, degrading to unavailable when no
  session is connected.
- **Durable stop, cleared by re-resolution — including across a process restart.** The stop and
  the attempt count are persisted, so "permanent" is genuinely permanent rather than
  per-process. Clearing happens when the *resolved naming reference changes* (or the blocking
  cause — missing credentials, absent registry entry — is resolved), evaluated at the next
  attempt: this works across every bridge, unlike a roles-event listener that only reaches the
  one session that handled the write. **Clearing resets the spent budget and re-arms error
  emission**, without which the operator's remedy yields one retry and a silent re-stop.
- **No in-flight clobber.** Eligibility is re-checked *after* the model call returns, so a
  rename landing mid-stream is not overwritten, and the re-entrancy guard is latched before the
  first await so two adjacent turns cannot both spend budget.
- **Complete, deduplicated outcome reporting + diagnostics.** Every attempt reports exactly one
  outcome (including today's silent paths), but reports are **deduplicated on the wire** —
  terminal states like `already-named` recur every turn forever, so unconditional reporting
  would trade a bounded model cost for an unbounded wire cost. The server retains the last
  outcome per session in a bounded map that prefers `stopped` entries, retrievable when the
  diagnostics surface mounts.
- **Cause-matched remedy.** A budget exhausted by `starved` verdicts tells the operator to
  change the naming model; one exhausted by `waiting` verdicts reports that no nameable topic
  emerged and does NOT blame a model that behaved correctly.

**Out of scope (follow-ups):**
- **The auto→`user` relabel on reload** — a distinct pre-existing bug with a different root
  cause, tracked as its own investigation (see Why). Noted because it can mask this change.
- Suppressing reasoning at the request level — **not expressible**: `SimpleStreamOptions.reasoning`
  is typed `ThinkingLevel` (`minimal|low|medium|high|xhigh`); `"off"` exists only on
  `ModelThinkingLevel`, which this API path does not accept (`types.d.ts:12-13,132`).
- Re-naming the 2239 already-unnamed historical sessions (backfill).
- Relaxing the external-rename lockout for spawn-named sessions.
- A model-capability registry marking models reasoning / non-reasoning.
- **The anthropic `max_tokens: NaN` path — investigated and dismissed as unreachable.**
  `adjustMaxTokensForThinking` runs only when `options.reasoning` is truthy
  (`anthropic.js:556`), and the naming call passes no `reasoning`. An earlier draft of this
  proposal claimed this bug existed; it does not.

## Capabilities

### Added Capabilities

- `auto-name-diagnostics`: bounded per-session retention of the last auto-naming attempt
  outcome and reason, retrievable on mount and surfaced in Settings → Diagnostics.

### Modified Capabilities

- `bridge-auto-session-namer`: token budget with headroom; stop-reason-keyed truncation verdict;
  a single bounded attempt budget then permanent stop; advancing transcript window; durable stop
  cleared by re-resolution; provenance restore; complete outcome reporting; `@naming`→`@fast`
  resolution.
- `dashboard-roles-ownership`: `naming` joins `DEFAULT_ROLE_NAMES`.
- `model-selector`: the built-in role set includes `naming`, preserving a pre-existing
  user-created role of that name.
- `roles-settings-ui`: the `naming` row is additionally rendered inline beneath the auto-name toggle.

## Impact

- **Behavior change is strictly in the failure direction.** A working configuration behaves as
  today. A configuration that could never work now stops after a bounded number of attempts and
  says why, instead of retrying silently forever.
- **No migration.** `naming` unassigned ⇒ falls back to `@fast` ⇒ identical resolution to today.
- **One new persisted field** in the session's `.meta.json` (alongside `nameSource`), narrowly
  scoped to the stop state. A deliberate exception to this change's otherwise strict "no new
  persistence" rule: without it the stop is process-local, so a restart re-spends a full budget,
  re-emits the error, and the stop is not actually permanent. The naming MODEL remains role-only
  — no new source of truth for it.
- **Spec-suite coherence:** `session-rename` pins the pre-change semantics (attempt every
  terminal turn, first-message gate, empty-treated-as-NULL) and is delta'd here; leaving it
  would make the suite self-contradictory in a way `validate` does not catch.
- **Cost.** Per-attempt ceiling rises 16 → ≥2048 (a ceiling, not a spend: the successful
  observed call billed 724 reasoning + 5 content tokens). Per-session cost becomes **bounded**
  where it is unbounded today. An earlier draft claimed cost strictly decreases; that was wrong
  for the no-topic path, which is why the attempt budget covers `waiting` as well as `starved`.
- **Touched code:** `auto-session-namer.ts`, `bridge.ts`, `bridge-context.ts` (window),
  `role-manager.ts`, `packages/shared/src/protocol.ts` + `browser-protocol.ts`, server
  `event-wiring.ts`, `packages/roles-plugin/` + client settings.
- **Security surface unchanged:** still at most two slices, still 200 / 2000 characters.
- **Known residual risk:** a model may ignore the summarizer prompt — observed returning a
  900-character chat reply on a longer input. The 40-char / 6-word guards reject it; with more
  headroom this becomes more likely, so those guards are load-bearing, the rejection is
  reported rather than silent, and the attempt budget bounds the retries.

## Discipline Skills

- `systematic-debugging` — the root cause was found by evidence, and TWO proposed fixes were
  falsified by measurement (256/512 still starved; the anthropic NaN path proved unreachable).
  Verify against a live reasoning model, not only unit tests.
- `observability-instrumentation` — the loud-failure work and the diagnostics readout exist so
  this class of silent failure is diagnosable at runtime; instrument every exit path.
- `review-code` — the change modifies a permanent-lockout state machine where an over-eager stop
  silently disables a working feature; review the `starved` / `NULL` / soft-error discrimination,
  the stop-reset re-resolution, and the provenance restore before commit.
- `security-hardening` — the transcript window now advances to later turns; confirm the slice
  bounds still cap what leaves the process and that no full history can be sent.
