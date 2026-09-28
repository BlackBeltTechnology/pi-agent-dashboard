# Review notes — redesign-composer-session-strip

## Task 2.4 — doubt-driven-review checkpoint (protocol fields + `ToolbarGroup`)

Reviewer: isolated `@review` subagent, biased to disprove. Scope: tasks 1.1, 1.6 (protocol, change-detector, scheduler, server pass-through, refresh fan-out) and 2.1–2.2 (`ToolbarGroup`, `ComposerContextGroup`). Verdict before fixes: **BLOCK**. All blocking / should-fix findings resolved below.

| # | Class | Finding | Resolution |
|---|-------|---------|------------|
| 1 | blocking | `event-wiring.ts`: unknown PR number (fields omitted after a fork) cleared number/url but the guarded status fields kept a stale `open · passing`, which could drive Merge emphasis. | Fixed. The tuple is atomic with the number: `gitPrNumber == null` clears state/draft/checks/checkedAt to `null`. Test: `event-wiring-pr-status.test.ts` "doubt-review #1". |
| 2 | blocking | `bridge.ts`: the scheduler was never disposed on reload; a late probe would keep scheduling into the new bridge's timer registry. | Fixed. `alive: isActive` dep; the scheduler self-disposes on the first timer/settle after the incarnation changes. Test "doubt-review #2". |
| 3 | blocking | `pr-status.ts`: a forced request coalesced inside the 30 s window was dropped (Open PR right after Push lost). | Fixed. Coalesced requests collapse into ONE pending forced probe that runs after the in-flight probe or at the window edge; `pr` wins over `push`. Rate bound (≤ 1 forced start / 30 s) kept. Test "doubt-review #3"; P3 now asserts +1 inside the window and exactly one deferred probe at the edge. |
| 4 | should-fix | `pr` retries called `start()` directly; a retry firing mid-flight was discarded. | Fixed. Retries set `pendingStart` and run right after the in-flight probe settles. Test "doubt-review #4". |
| 5 | should-fix | `dispose()` left the active probe timeout alive. | Fixed. Handle kept and cleared. Test "dispose clears every timer". |
| 6 | should-fix | `ToolbarGroup` actions variant lacked D1 hairline separators. | Fixed. `[&>*+*]:border-l` on actions content. |
| 7 | should-fix | No ≥ 24 px target enforcement for plugin children. | Fixed. `[&>button]:min-h-6 min-w-6`, `[&>a]:min-h-6` on content. |
| 8 | should-fix | `customContent: boolean` let plugins pass arbitrary nodes that break the `:empty` contract. | Fixed. Replaced by `contentAs: "div" \| "fieldset"` + typed `contentProps`; the primitive always renders the content element with `data-group-content`. |
| 9 | should-fix | The `:has(> [data-group-content]:empty)` rule was documented but absent. | Fixed. Added to `packages/client/src/index.css` (D8). Verified by Playwright task 9.1. |
| 10 | refuted | Widening `gitPrNumber` / `gitPrUrl` to `null` breaks old clients. | Refuted: every client reader uses `!= null` / truthiness. |
| 11 | refuted | Stale-generation / late-resolve races in the scheduler. | Refuted: generation key check + per-probe `settled` latch. |
| 12 | refuted | Register ordering (git update before register). | Refuted: `session_register` precedes the first `git_info_update` on both paths. |
| 13 | refuted | Refresh fan-out over-/under-targets. | Refuted: realpath-normalized boundary-aware containment, ended sessions excluded; tested incl. symlink + sibling prefix. |
| 14 | refuted | `role="group"` naming. | Refuted: `useId` label + `aria-labelledby`; string and node labels tested. |
| 15 | refuted | Plugin source compatibility of `ComposerContextGroup`. | Refuted: signature unchanged. |
| 16 | refuted | `git_info_refresh` harms old bridges. | Refuted: additive, unknown types ignored. |

Test-plan deviation: P3's literal "advance 30 s · counter +1" now reads "+1 strictly inside the window, then exactly one coalesced probe at the window edge". Finding #3 showed the literal forced dropping requests.

## Task 10.1 — real fleet PR-probe cost (manual, post-merge)

_Pending: record the per-session invocation counter (`/dashboard-where` → `pr-probe:`) and the `gh api rate_limit` GraphQL point delta for 20 idle sessions over 60 min._
