## Context

The dashboard runs as three coupled components (bridge extension, Node server, React client) against a pi runtime the user may install anywhere and at any version. The server declares a compatibility window (`piCompatibility` in `packages/server/package.json`, read by `pi-version-skew.ts`): `minimum 0.78.0`, `recommended 0.81.1`, `maximum null`. We are moving `recommended` to `0.83.0` and adopting four new-in-0.82/0.83 APIs, but the `minimum` MUST stay `0.78.0` — the dashboard is expected to keep running on any pi ≥ minimum. That forces every adoption to be **feature-detected at runtime**, never assumed from the version string.

Upstream `0.83.0` also carries a breaking TypeBox 1.3.7 bump. A repo audit shows zero usage of the removed APIs (`Type.Base/Awaited/Promise/AsyncIterator/Iterator/Options`, `Value.Mutate`), so this is a verify-not-migrate concern, with one watch item: the release fixed compiled validation of nullable-array tool arguments, which touches how discriminated unions (our `ask-user` schema) emit.

## Goals / Non-Goals

- Goals: bump the recommended pin across the single-source locations; adopt scoped models, bash session env, streaming bash RPC, and outputPad; guarantee graceful degradation on older pi; add the `"pending"` stop-reason guard.
- Non-Goals: raising `minimum` above `0.78.0`; migrating any TypeBox API (none used); redesigning the model catalogue, bash card, or renderer registry; touching the `@mariozechner/*` legacy fork pins.

## Decisions

- **Feature-detection over version-gating.** Detect capability by presence of the concrete surface (`typeof ctx.scopedModels !== "undefined"`, subscription accept for `bash_execution_update`, env var readback), not by comparing the pi version. Version strings lie across custom builds and forks; the audit already proved presence-checks are the reliable signal. Each new path has an explicit `else` that is the current 0.81 behavior verbatim.
- **`scopedModels` narrows, never replaces.** `list_models` keeps sourcing from `cachedModelRegistry.getAvailable()` (the exact Model-Selector path, per the `agent-role-model-tools` spec). When `ctx.scopedModels` is available it is applied as a **filter/intersection** on that catalogue so `ref`s stay assignable and the `registryReady` discriminator is untouched. Absent → no filter, identical output to today.
- **Streaming bash is additive.** `bash_execution_update` chunks are forwarded as a new incremental signal; the terminal `bash_output` card contract (`bash-execution` spec) is preserved so the client renders identically when streaming is unavailable. No client breaking change — streaming is progressive enhancement on top of the existing card.
- **`"pending"` = normal.** Add `"pending"` to the set of stop reasons that classify as `normal` in `turn-actionability.ts` (a mid-stream partial has produced no terminal output but is NOT an empty completion). Error precedence is unchanged; newly-raw provider terminal reasons still resolve via the existing `error`/truncation branches.
- **`outputPad` gated behind a spike.** The extension registers no pi custom message renderer today (grep: no `registerRenderer`/`outputPad`). Rather than invent a renderer to consume `outputPad`, task 5 is a feasibility spike: if a renderer is warranted it wires `outputPad`; otherwise the requirement is met as a documented no-op with a note in the spec. This avoids dead code while honoring the adoption request.

## Risks / Trade-offs

- TypeBox 1.3.7 nullable-array validation change silently alters `ask-user` union emission → **Mitigation:** run `ask-user-schema-discriminator.test.ts` + full extension suite against the resolved 0.83.0 before merge; the test already asserts `anyOf` shape.
- Streaming forward doubles bash event volume on the wire → **Mitigation:** forward chunks only; keep the terminal `bash_output` as the source of truth; the client coalesces chunks into the existing card.
- Version pins drift across the four single-source files → **Mitigation:** `verify-release-deps.mjs` is itself one of the pins and already gates release; update it in the same change so CI enforces coherence.
- Electron bundle resolves a different pi than the server dep → **Mitigation:** electron bundles the server via `bundle-server.mjs`, which resolves the server's own `^0.83.0`; no independent electron pin exists to drift.

## Migration Plan

1. Edit the four pins (server dep, `piCompatibility.recommended`, `verify-release-deps.mjs`, `docker/Dockerfile`); refresh lockfile.
2. Run the extension test suite against 0.83.0 (TypeBox + ask-user + turn-actionability).
3. Land feature-detected adoptions one capability at a time, each with its fallback test.
4. Rollback = revert the pin edits + lockfile; adoptions are inert on older pi and can ship independently.

## Resolved Decisions

- **outputPad → no renderer (documented no-op).** Decided: the dashboard will NOT register a pi-TUI custom message renderer; web-client rendering stays the only surface. `outputPad` adoption therefore resolves to a documented no-op — no renderer is introduced solely to consume it, and the absence is not a gap. Task 5 collapses to recording that outcome; no code lands.
- **bash session env → both consumers.** Decided: BOTH factory bash tools AND worktreeInit-style hooks are in-scope consumers of `PI_SESSION_ID`/`PI_SESSION_FILE`/`PI_PROVIDER`/`PI_MODEL`/`PI_REASONING_LEVEL`. Each variable is read as optional and treated as absent on older pi; neither consumer fails when the vars are unset.
