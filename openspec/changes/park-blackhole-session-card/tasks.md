# Tasks — park-blackhole-session-card

> Written retroactively: the code change was made and deployed before this change was
> scaffolded. Items already done are marked as such.

## 1. Park the gate

- [x] 1.1 `installed-gate.ts` — `shouldRenderMemorySubcard` returns `false`; retain
  `// return installed === true;` directly above it with a TEMP comment naming the reason.
- [x] 1.2 Verify the resolve state machine below the gate is untouched (backoff, slow interval,
  finalization, `bumpSlotClaimsVersion`).
- [x] 1.3 Verify nothing is deleted: `MemorySubcard.tsx`, `PipelineDetailView.tsx`,
  `pipeline-state.ts`, `pipeline-api.ts`, `detail-navigation.ts`, both `package.json` claims,
  and `GET /api/plugins/blackhole/session/:id` all remain.

## 2. Tests

- [x] 2.1 `__tests__/installed-gate.test.ts` — comment out the two `.toBe(true)` gate
  assertions (X1 and X2 success paths).
- [x] 2.2 `__tests__/client-entry.test.ts` — comment out the one `.toBe(true)` gate assertion.
- [x] 2.3 Confirm the adjacent `bumps` / `calls()` assertions still distinguish "resolved" from
  "never resolved", so retry/backoff coverage survives the commenting.
- [x] 2.4 Add a test asserting the parked contract directly: `shouldRenderMemorySubcard`
  returns `false` *after* a successful `installed: true` resolve. Without it, the park is
  enforced by nothing and a restore-by-accident goes unnoticed.
- [x] 2.5 Verify that test **fails closed**: with the gate flipped back to
  `return installed === true;` the suite reports exactly 1 failure and it is the park test.
  Measured: parked `191 passed`; restored `1 failed | 190 passed`.

## 3. Verification

- [x] 3.1 `blackhole-plugin` suite green — 191 passed (190 + the new park test 2.4).
- [x] 3.2 `packages/client` `SessionCard.test.tsx` green — 128 passed.
- [x] 3.3 `tsc --noEmit` clean for `packages/blackhole-plugin`.
- [x] 3.4 `npm run build` + `POST /api/restart`; `/api/health` reports `mode: production`.
- [ ] 3.5 Manual: hard-refresh the dashboard, confirm no MEMORY subcard on any session card and
  that Settings → General still shows the Blackhole section.

## 4. Docs

- [x] 4.1 `packages/blackhole-plugin/src/client/AGENTS.md` — amend the `installed-gate.ts`
  purpose row to state the gate is parked, and append
  `See change: park-blackhole-session-card`.
- [x] 4.2 Same for the `MemorySubcard.tsx` / `PipelineDetailView.tsx` / `detail-navigation.ts`
  rows — note they are dormant, not removed.
- [x] 4.3 `kb dox lint` clean for `packages/blackhole-plugin`.

## 5. Follow-up (not this change)

- [ ] 5.1 Successor change: exception-only render. Bring back **only** the conditional
  advisories (fallback-model cooldown, unflushed pending batches, stale cursor) — the one
  signal that exists nowhere else — and ship the CSS that was never written. Drop the
  compaction-proximity meter entirely; `ContextUsageBar` already renders that badge exactly,
  from the same `contextTokens`, on the same card.
