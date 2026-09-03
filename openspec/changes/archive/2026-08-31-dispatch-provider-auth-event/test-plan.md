# Test Plan — dispatch-provider-auth-event

Stage: proposal/design (`tasks.md` absent at generation)   Generated: 2026-08-12

HARD gate CLEARED. Three unfillable slots were resolved by decision before this
file was written:

1. **L3 coverage of the user-visible defect — declined.** The real observable
   (save a credential in the desktop settings overlay → the `LandingPage`
   checklist live behind it flips ① to done, no reload, no focus) requires a
   harness with **no** provider credential. `tests/e2e/global-setup.ts:152` seeds
   a fake one on purpose to clear the onboarding gate, and it is shared by every
   spec. Rather than add a per-spec unseeded path, the L1 wiring row (D5) is the
   proof; the overlay-underlay rendering is covered by existing specs.
2. **"No call site repeats the literal" — dropped from the spec.** It has no
   observable a test can assert. The shared `PROVIDER_AUTH_EVENT` constant stays
   as an implementation choice recorded in `proposal.md`, with no manifest row.
3. **Out-of-scope staleness paths — no negative scenarios.** Post-unmount OAuth /
   device completion, external writes (`pi auth login`, curl), and second-window
   staleness stay a prose boundary in `proposal.md`. No rows, automated or manual.

Every Triple below is concrete; no `[NEEDS CLARIFICATION]` markers remain.

All rows are **L1** (vitest + jsdom) and **automated**. No L2: nothing here is a
process/install/multi-OS concern. No L3, per decision 1. No `manual-only` rows,
per decisions 1 and 3 — so `ship-change` has nothing to defer post-merge.

---

## Scenarios

### Edge-case — dispatch coverage (decision table over the six write paths)

The requirement is "each credential write that succeeds dispatches". The reachable
combinations are `path × outcome`. `D1`–`D6` walk every path on its success edge;
`X1`–`X3` walk the failure and non-write edges.

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| D1 | Dispatch on successful credential write — API-key save | decision-table (path × success) | L1 | automated | `ProviderAuthSection` mounted; `PUT /api/provider-auth/api-key` mocked `res.ok` | the user submits the save **once** | exactly one `provider-auth-event` dispatched on `window` |
| D2 | Dispatch — OAuth sign-in completion | state-transition (legal edge) | L1 | automated | `ProviderAuthSection` mounted; auth-code status poll mocked to report `authenticated` | the poll observes completion | one `provider-auth-event` dispatched |
| D3 | Dispatch — device-code completion | state-transition (legal edge) | L1 | automated | `ProviderAuthSection` mounted; `/device-status/<flowId>` mocked to report `complete` | the poll observes completion | one `provider-auth-event` dispatched |
| D4 | Dispatch — custom-LLM-provider save | decision-table (path × success) | L1 | automated | `SettingsPanel` with a dirty LLM-provider list; `PUT /api/providers` mocked `{ success: true }` | the save is submitted | one `provider-auth-event` dispatched |
| D5 | **Wiring end-to-end — the defect itself** | state-convergence | L1 | automated | `useProvidersReady()` mounted; `/api/providers` + `/api/provider-auth/status` both mocked unconfigured, then re-mocked to report one authenticated provider | a save path dispatches `provider-auth-event`; **no `focus` event is fired** | both endpoints refetched and the hook converges to `ready=true` — this is the only row that fails on a revert of the change |
| D6 | Dispatch — event carries no credential material | EP (payload partition) | L1 | automated | any dispatching path from D1–D4 | the event is captured by a `window` listener | the `CustomEvent` has no `detail` payload; no key, provider id, or credential string is present |

### Edge-case — decrement direction

The spec makes decrements first-class ("writes that DECREASE the credential count
SHALL dispatch on the same terms"). These are separate rows because the *only*
thing that makes them work is `useAsyncAction`'s `onSuccess` reaching the same
funnel — a different code path from the save.

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Decrement — API-key removal | state-transition (reverse edge) | L1 | automated | `ProviderAuthSection` mounted with exactly one keyed provider; no OAuth provider authenticated and no `/api/providers` entry with a non-empty `apiKey`; removal mocked to succeed | the user removes the key | `provider-auth-event` dispatched, **and** `useProvidersReady()` subsequently reports `ready=false` |
| E2 | Decrement — OAuth sign-out | state-transition (reverse edge) | L1 | automated | `ProviderAuthSection` mounted with one authenticated OAuth provider; sign-out mocked to succeed | the user signs out | `provider-auth-event` dispatched |
| E3 | Decrement — custom provider deleted | EP (replace-semantics partition) | L1 | automated | `SettingsPanel` with an existing custom provider; the `PUT /api/providers` that omits it mocked `{ success: true }` | the save is submitted | `provider-auth-event` dispatched |

### Edge-case — over-dispatch is permitted, under-dispatch is not

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E4 | A successful write that changes nothing still dispatches | EP (invalid-looking but legal partition) | L1 | automated | an existing custom provider whose API key is unchanged and round-trips as the redaction sentinel; only its **base URL or api type** edited; `PUT` mocked `{ success: true }` | the save succeeds | `provider-auth-event` dispatched **and** the resulting readiness is unchanged — over-dispatch is legal |
| E5 | The event is idempotent | state-convergence (repetition) | L1 | automated | `useProvidersReady()` mounted, endpoints mocked to a fixed configured state | the event is dispatched 3× in succession | the hook converges to the same `ready`/`count` as a single dispatch; no state oscillation, no error |

### Error-handling — fault injection on the success gate

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | A transport-failed write dispatches nothing | fault-injection (abort) | L1 | automated | `ProviderAuthSection` mounted; API-key `PUT` mocked non-2xx | the user saves the key | **no** `provider-auth-event` dispatched; the existing error message still renders |
| X2 | A body-level failure dispatches nothing | fault-injection (poisoned success) | L1 | automated | `SettingsPanel`; `PUT /api/providers` mocked 200 with `{ success: false, error: "…" }` | the save is submitted | **no** `provider-auth-event` dispatched |
| X3 | A mount is not a credential write | fault-injection (false-positive guard) | L1 | automated | `ProviderAuthSection` newly mounted; no user action; status fetch mocked to resolve | the initial `refresh()` completes | **no** `provider-auth-event` dispatched — this row is the executable form of the code comment at `ProviderAuthSection.tsx:104-106` |
| X4 | A rejected status refetch does not wedge the hook | fault-injection (delay + abort) | L1 | automated | `useProvidersReady()` mounted; `/api/providers` mocked to reject while `/api/provider-auth/status` resolves with one authenticated entry | `provider-auth-event` dispatched | the hook still derives `ready=true` from the surviving endpoint and reports `loading=false` |

### Regression

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| R1 | The owner callback contract is untouched | regression | L1 | automated | `ProviderAuthSection` mounted with an `onCredentialsChanged` spy | any dispatching write from D1–D3, E1–E2 | `onCredentialsChanged` still fires exactly as before, and the section's own `refresh()` still runs — the dispatch is additive to `handleChanged`, not a replacement |
| R2 | The existing suites still pass | regression | L1 | automated | the current `ProviderAuthSection`, `SettingsPanel`, and `useProvidersReady` suites | full run | pass unchanged, except `useProvidersReady.test.ts:138`, which adopts the shared constant in place of its literal |

## New infra needed

None. Every row lands in an existing vitest suite alongside the component or hook
it exercises. The declined L3 row would have required a per-spec unseeded harness
path in `tests/e2e/global-setup.ts` — recorded here as the cost that decision
avoided, not as work to do.

## Known limitations encoded in this plan

- **D1 counts one submission, not one save-intent.** `ApiKeyRow.handleSave` has no
  synchronous in-flight guard (`disabled={busy}` covers only the Save button, and
  the Enter handler at `:537` can re-enter), so a double activation legitimately
  produces two writes and two dispatches. D1 stages exactly one submission. The
  race is pre-existing and out of scope; E5 covers why a duplicate is harmless.
- **No row asserts the absence of the string literal** — see HARD-gate decision 2.
- **No row covers post-unmount completion, external writes, or a second window** —
  see HARD-gate decision 3; the boundary is prose in `proposal.md`.
