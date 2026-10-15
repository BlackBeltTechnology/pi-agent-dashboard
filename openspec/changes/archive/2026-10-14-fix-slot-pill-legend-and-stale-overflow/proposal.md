## Why

`retro-ux-plugin-settings-forms` (#888) raised the capsule legend of `SlotPill` and `SessionSubcard` from 9 px to 12 px uppercase + `tracking-wider` but kept the `-top-1.5` overhang. The legends now dominate their panels: "KNOWLEDGE BASE" fills most of a ~150 px sidebar pill, and the taller capsule crowds the content row. Separately, the KB pill's count line (`19,397 chunks ⚠ 3 stale`) has no shrink/truncate path — the stale `PILL` is `whitespace-nowrap` and nothing in the line may shrink — so the stale badge renders past the pill's border in both the sidebar 2-column grid and the session-card placement. The capture probes check contrast, size and focus but not overflow, so neither regression was caught.

## What Changes

- Capsule legend drops to `text-[11px]` uppercase `tracking-wide` (from 12 px `tracking-wider`) on `SlotPill`, `SessionSubcard`, and the hand-mirrored inert pill in `FolderOpenSpecSection` (still at 9 px today).
- One shared legend class constant (`SLOT_PILL_LEGEND`) exported by the plugin runtime, used by `SlotPill` and the OpenSpec mirror.
- Legend overhang `-top-1.5 → -top-2` so the capsule centres on the border; `SessionSubcard` panel `py-1.5 → pt-2.5 pb-1.5` and `mt-1.5 → mt-2.5` (and the session-card worktree card-slot wrapper `mt-1.5 → mt-2.5 flex flex-col gap-2.5`, so stacked KB/MCP claims no longer collide — measured 5 px overlap on the live build) so content and neighbouring panels clear it.
- KB stale marker becomes compact: an MDI alert icon + `N` (replacing the `⚠` text glyph, per `mdi-icon-system`), full "N stale" as screen-reader text and hover `title`; `data-testid="folder-kb-stale"` unchanged. The folder-menu MAINTENANCE badge keeps "N stale".
- KB count line gets an overflow guard: the stale marker and the numbers never shrink; only the unit words, state words and error text truncate with an ellipsis.
- The UI capture harness gains an **overflow probe** (opt-in per surface) and skips `sr-only` text in its contrast sweep. The KB pill is probed with it in the sidebar (all states) and in the session-card placement (a real worktree session, `populated` + `stale`). E2E is opt-in, so the probe guards when `npm run test:e2e` runs.
- Mockup: mockups/slot-pill-legend-stale.html (in this change) — approved as-built vs proposed board.
- `ui-contract.md`: capsule-legend row → 11 px recipe; aligned-action-surface paragraph names capsule legends (SlotPill / SessionSubcard / SlotPill mirror) as its one bounded 11 px exception.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `directory-card-layout`: "Folder slot pill legend meets the type floor" — 12 px → 11 px meta step, `-top-2` overhang, OpenSpec mirror included; "Folder slots render as single-concern pills in a responsive grid" — KB inline stale marker reads `⚠ N`.
- `session-card-subcards`: ADDED "Worktree card-slot claims are spaced like subcards"; subcard legend class tokens `text-[12px]` → `text-[11px]`, overhang token updated; still matches the SlotPill legend.
- `ui-state-capture`: "Capture reports contract probes per state" — adds the opt-in `overflow` list; contrast sweep ignores `.sr-only` text.
- `kb-plugin-folder-section`: stale marker visible form `⚠ N stale` → `⚠ N` with full text as sr-only + `title`; truncation order; probes add overflow (sidebar).

## Impact

- `packages/dashboard-plugin-runtime/src/SlotPill.tsx` + `src/index.ts` (export `SLOT_PILL_LEGEND`) (+ `__tests__/SlotPill.test.tsx`)
- `packages/client/src/components/session/SessionSubcard.tsx` (+ `components/__tests__/SessionSubcard.test.tsx`)
- `packages/client/src/components/openspec/FolderOpenSpecSection.tsx` (mirror uses `SLOT_PILL_LEGEND`)
- `packages/client/src/components/session/SessionCard.tsx` (card-slot wrapper `mt-2.5 flex flex-col gap-2.5`)
- `packages/kb-plugin/src/client/FolderKbSection.tsx` (+ `__tests__/FolderKbSection.test.tsx`), `packages/kb-plugin/src/i18n.ts` (new short/aria keys if needed)
- `tests/e2e/helpers/ui-capture.ts` / `computed-contrast.ts` (overflow probe), `tests/e2e/fixtures/retro-ux/kb-pill.ts` (overflow root, wide stale state), new `tests/e2e/fix-slot-pill-legend-overflow.spec.ts`
- `ui-contract.md` capsule-legend row
- Visual only; no API, protocol or persistence change. Rollback = revert the commit.

## Discipline Skills

- `review-code` — non-trivial cross-package UI change before commit.
- No security, performance, observability or irreversible-step triggers apply (presentation-only, no endpoints, no migration).
