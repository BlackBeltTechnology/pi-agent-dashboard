# Design — session-independent default-model catalogue

## Context

Three questions look like one question, and conflating them is what produced the bug:

```
  QUESTION                            AUTHORITATIVE SOURCE          SEES ENV CREDS?
  ──────────────────────────────────  ────────────────────────────  ───────────────
  "what can THIS pi process run?"     bridge → models_list (per      yes
                                      session, from pi's registry)

  "what can THIS MACHINE run?"        no single source today         —
                                      (union of the two below)

  "what can the PROXY route?"         InternalRegistry.getAvailable  NO
                                      → GET /api/models
```

The Settings default-model picker asks the **middle** question. It is currently wired to the
first source, which is empty with no sessions. The obvious fix — wire it to the third — is wrong
for a second reason discovered in review: `getAvailable()` filters on `auth.json` + synthetic
custom-provider keys only (`internal-registry.ts:265-285`), and nothing under
`packages/server/src/model-proxy/` reads `process.env` or pi-ai's `getEnvApiKey`. A machine
running pi off an exported `ANTHROPIC_API_KEY` has an empty catalogue and a working pi.

So the middle question has no single source, and this change composes one.

## Decisions

### D0 — The default-model picker reads the UNION; the proxy editors read the catalogue

**Chosen:** `defaultModelOptions = dedupe(catalogue ∪ ⋃ models_list)`, keyed on
`"provider/id"`, **session row wins on collision**. `ModelProxySection` receives the catalogue
alone, as a separate prop.

Rationale: the two consumers ask different questions. The proxy's preferred-models list,
aliases, and availability pills describe what the proxy will route — `getAvailable()` is that set
by construction, and offering an env-credentialed model there would be a lie. The default-model
setting describes what pi will run, which is strictly larger.

Properties:
- **Zero sessions** → union = catalogue. The bug is fixed.
- **Sessions live** → union ⊇ today's list. No option disappears; no regression.
- **Env-credentialed providers** → visible via the session side whenever any session is live, and
  invisible only in the zero-session + env-only-credentials case, which is *no worse than today*
  (today that case shows nothing at all).

**Session row wins** because it is strictly richer: it carries `name` (which `ModelSelector`
renders as `m.name ?? label`), a real `metadataSource`, and `supportedThinkingLevels`. Preferring
the catalogue row would silently drop display names for models that are in both.

**Rejected — catalogue only:** empty picker for env-credentialed installs, i.e. the original bug
in a new costume.
**Rejected — fix `InternalRegistry` to merge `getEnvApiKey`:** this is the *principled* fix and
would let the union collapse to the catalogue. It also corrects `/v1/models`, proxy routing, and
the `list_models` agent tool. Deferred deliberately as a follow-up: it is a server behaviour
change with a wider blast radius than this UI bug warrants, and it should be reviewed on its own
terms rather than smuggled in.

**Accepted cost:** two sources for one control, which is the mush this change set out to remove.
The union is a *workaround for a server-side gap*, and the follow-up above is the exit. That is
recorded here so it is not mistaken for the intended end state.

### D1 — The row → `ModelInfo` mapper lives in `shared/`

Pure, synchronous `(row) => ModelInfo`, beside `ModelInfo`'s own definition
(`packages/shared/src/types.ts:581`). The deferred surfaces (`OpenSpecRunConfigContext`, spawn
composer) will want the same projection, and a second copy of the `input[] → vision` rule is
exactly the drift the repo already guards against for thinking-levels (D-X1).

**Note on the guard:** `single-derivation-guard.test.ts` scans the extension and the server only.
A `deriveSupportedThinkingLevels` copy in `shared/` would **not** trip it. The mapper must not
derive one — held by spec and review, not by the guard. Extending the guard to `shared/` is a
cheap follow-up worth considering.

### D2 — `metadataSource` is OMITTED for catalogue rows

Originally this design emitted `"catalog"`, reasoning that registry rows are authored data.
Review disproved it: `internal-registry.ts:228` floors `reasoning:false`, `input:["text"]`,
`contextWindow:128000` when neither discovery nor `models.json` supplies capabilities — precisely
the case the bridge labels `"fallback"` and renders with uncertain `?` badges
(`provider-register.ts:197`). The wire row does not distinguish authored caps from floored
defaults, so the client cannot honestly claim either grade.

**Chosen:** omit `metadataSource` → no capability badge rendered. Honest silence.
**Rejected:** `"catalog"` (false confidence on floored custom models); `"fallback"` (false
uncertainty on genuinely authored ones).

Union interaction: a model present in a live session keeps that session's real `metadataSource`,
because the session row wins. Badges degrade only for catalogue-only rows.

### D3 — Catalogue is fetched filtered (no `?annotated=1`)

`getAvailable()` (credential-filtered) rather than the annotated set. A *default model* should be
runnable; annotated rows would need a disabled-row state and a reason affordance that the union
already makes largely redundant.

Note this decision is weaker than it was before D0: since the union supplies env-credentialed
models from the session side, the filtered catalogue's blind spot is covered where it matters.
`?annotated=1` remains the natural follow-up if operators want to see *why* something is missing.

### D4 — Refetch is an explicit callback, and OAuth is a trigger

The server already invalidates its own cache on every catalogue-changing write
(`refreshModelRegistry()`, three call sites). Only the browser is unaware — browsers never
receive `credentials_updated` (verified: no reference in `packages/client/` or
`browser-protocol.ts`).

**Chosen:** a `refetchCatalogue` callback owned by the settings surface and threaded into the
components that perform credential writes. `ProviderAuthSection` is currently rendered with **no
props** (`SettingsPanel.tsx:1472`), so this is a real signature change, not a hand-wave.

Triggers: API-key save, custom-provider save, **and OAuth / device-code completion**. The last
was missing from the first draft — those flows complete server-side and change the catalogue just
as much as an API-key save, and omitting them leaves a freshly-authorized provider invisible.

**Rejected:** broadcasting `credentials_updated` to the browser gateway. Correct in the large,
but a protocol change serving one panel. It becomes justified when the deferred surfaces need
live invalidation too.

**Ordering hazard (unchanged):** `refreshModelRegistry()` is fire-and-forget (`.catch(() => {})`)
at all three call sites, so a refetch issued on the save's success response may observe the
*pre-refresh* registry. The refetch must not be implemented as a fixed delay; the selector's
manual refresh remains the escape hatch, and this is pinned as a spec scenario.

### D5 — Registry-unavailable renders as a SIBLING callout, not an in-picker row

`ModelSelector` renders its trigger `disabled={!hasModels}` with `onClick={() => hasModels && …}`
(`:310-316`) and keeps the refresh control inside the popover footer (`:408`). While the list is
empty the popover cannot open, so **any** in-picker state — error row or refresh control — is
unreachable. The first draft's "explicit error row inside the picker" was unsatisfiable.

**Chosen:** render the unavailable state as a callout **above** the picker, owned by
`SettingsPanel`. No change to `ModelSelector.tsx`, hence no merge collision with the concurrent
`open-empty-model-selector` change, which owns that file.

**Follow-up:** once `open-empty-model-selector` lands (openable-when-empty + in-popover refresh),
an in-picker error row and a session-independent `onRefresh` become reachable. Recorded as a
follow-up, not a dependency.

**Scope of the state:** it covers `503 MODEL_PROXY_RUNTIME_MISSING` *and* any other non-2xx or
network failure. Mapping only 503 would reproduce the indistinguishable-empty failure this
decision exists to prevent, just for a narrower set of status codes.

### D6 — Identity comes from the row's `provider` field, not from splitting

The wire row carries both `provider` and `id: "<provider>/<model>"` (`toRow`). Splitting on the
first `/` is right for slashed *model* ids (`openrouter/meta-llama/llama-3-70b`) but wrong for a
provider name containing `/`, which nothing in `providers.json` forbids.

**Chosen:** take `provider` from the row field and derive the bare id by stripping the
`"<provider>/"` prefix. Ground truth is already in the row; do not re-derive it.

Dedupe for the union keys on the reassembled `"provider/id"`. No client-side dedupe of the
catalogue itself is needed — `InternalRegistry` already dedupes by fqid keeping the first
occurrence (`internal-registry.ts:246-260`).

## Review record

Doubt-driven review ran on the first draft: a single-model fresh-context reviewer plus an
automatic cross-model pass on `@propose-review-1` (`deepseek/deepseek-v4-flash`, probe-gated).
Findings that changed this design: the env-credential gap (→ D0 union), the unreachable
in-picker states (→ D5 sibling callout), the `ModelProxySection` second consumer (→ D0 two
props), the false "reads only four fields" claim / `name` regression (→ D0 session-row-wins), the
floored-capability grade (→ D2 omit), the optional `input` crash (→ mapper spec), the missing
OAuth refetch trigger (→ D4), and the 503-only error mapping (→ D5 scope). One finding was
classified noise: client-side dedupe is unnecessary because the registry already dedupes.

## Non-goals restated

- No change to when the bridge pushes `models_list`.
- No second `deriveSupportedThinkingLevels`.
- No server change — including the env-credential fix, which is the named exit from D0's union.
