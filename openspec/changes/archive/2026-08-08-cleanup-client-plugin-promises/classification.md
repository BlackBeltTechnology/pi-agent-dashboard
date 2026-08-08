# Fix-type classification record — cleanup-client-plugin-promises

Deliverable of D5 (classify before editing) and task 4.9. Input to
`add-typeaware-lint-gate`'s `error`-vs-`warn` severity decision for
`packages/client`.

Derived from the change's own diff, not from memory: every added `void` discard
was checked to carry a `.catch` (or a two-arg `.then`) in the same statement.

## Distribution across the 88 floating sites

| Fix | Sites | Share |
|---|---|---|
| `.catch(handler)` (discard form `void p.catch(logRejection(…))`) | 86 | 98% |
| `await` (test-idiomatic, D8) | 2 | 2% |
| return the promise | 0 | 0% |
| `Promise.all` / `allSettled` | 0 | 0% |
| bare `void` (banned by D1) | **0** | 0% |

Product-code tally (D5 scope — excludes the 2 test-file sites per D8): **86 of 86
sites took `.catch(handler)`.**

## Why the distribution is so one-sided

Every non-test site lives in a React lifecycle or event path:

- `useEffect` callbacks must return `void` or a cleanup function, so "return the
  promise" is structurally unavailable (D1's React carve-out).
- DOM/React event handlers (`onClick`, `onKeyDown`) discard return values, so the
  same applies.
- No site had load-bearing ordering that `await` would fix; adding `await` in
  these paths would have introduced the update-after-unmount and stale-closure
  risks the proposal warned about, for no benefit.
- No site was a parallel fan-out leaking promises individually, so `Promise.all`
  never applied.

## Evidence for the severity decision (the proposal's open question)

The open question was: *is a floating promise in a React event handler actually a
defect?*

**The tally is evidence for `warn`, not `error`, in `packages/client`** — under
D5's own rule ("a tally dominated by `.catch(log)` is evidence for `warn`; one
dominated by `await`/`return` is evidence for `error`"), 86/86 is as dominated as
it gets. Not one client site turned out to need ordering or caller ownership.

Two qualifiers `add-typeaware-lint-gate` should weigh before deciding:

1. **The handlers are not inert.** Each routes through `reportError` with a
   site-naming context string, so the rule still bought per-site attribution that
   the process-global handler cannot give. The value was in the reporting seam,
   not in restructured control flow.
2. **The one genuine defect was not in this bucket.** `tunnel-core.ts:167`
   (a hang-class async-executor bug) came from `noMisusedPromises`, not
   `noFloatingPromises`. That is a point in favour of keeping *misused* at
   `error` regardless of what floating gets.

## Sites by package (all cleared)

| Package | Floating | Misused |
|---|---|---|
| `packages/client` | 70 (68 product + 2 test) | 3 |
| `packages/flows-plugin` | 7 | — |
| `packages/roles-plugin` | 5 | — |
| `packages/shell` | 3 | — |
| `packages/server` | — | 2 |
| `packages/subagents-plugin` | 1 | — |
| `packages/automation-plugin` | 1 | — |
| `scripts/` | 1 | — |
| **total** | **88** | **5** |

Plus one site not in the original claim: `packages/server/src/tunnel/tunnel-core.ts:160`
(the sibling's floating `promise.finally()`). Restructuring the executor at
`:167` made `createTunnel` able to reject, which turned that latent floating
promise into a live unhandled rejection — so it had to be fixed here. Shipped
total is therefore **89 floating + 5 misused**, and the sibling drops to 54
floating. Both ladder ledgers updated.

## Shared seams introduced

Three call sites repeated the same discard, so the handler was extracted rather
than duplicated:

- `packages/client/src/lib/report-error.ts` — `reportError` / `logRejection` /
  `installUnhandledRejectionReporter`.
- `packages/flows-plugin/src/client/send-safe.ts` — `makeSafeSend`, covering all
  7 flows sites.
- `RolesSettingsSection.tsx`'s single `dispatch` seam, covering all 5 roles sites.

## Note for whoever re-derives these counts

Biome's type-aware rules **silently undercount in a worktree with no
`node_modules`** — inference degrades and whole packages report zero. This run
first measured 95 floating (vs the true 143) for exactly that reason. Run
`pnpm install` before trusting any re-derivation, and count from Biome's own
diagnostic total (including `.cjs`).
