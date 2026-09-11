# Fix chat-pane bottom clipping (quota bar cut in half)

## Why

The quota bar at the bottom of the chat pane renders half-height — cut by the
pane's bottom edge.

**This is a chat-pane height-budget bug, not a quota-plugin bug.** An earlier pass
on this change diagnosed it as a `flex-shrink` distribution problem and added
`flexShrink: 0` to the widget. That was measured in a live browser and **proved to
be a no-op** — the change has been reverted. Recording why, so it is not
re-proposed:

- The widget's height is `13px` at *every* pane height, with `flex-shrink: 1` and
  with `flex-shrink: 0` alike. It never shrinks, so a shrink floor cannot help it.
  A sweep from `pane=220` down to `pane=140` produced `DIFF=0.0` in visible pixels
  between the two variants.
- Every row in the pane is `flex-shrink: 1`, but `min-height: auto` floors each one
  at its min-content height, so **none of them can actually shrink**.

The real mechanism: `split-chat-pane` is `flex-col overflow-hidden`. `ChatView` is
`flex: 1 1 0%`, so it absorbs a shrinking pane by surrendering its *grow*
allocation — measured `23 → 13 → 3 → 0`. The instant it bottoms out at `0`, there
is no space left to give, the fixed furniture below it overflows the pane, and
`overflow-hidden` guillotines whatever hangs past the bottom edge. The quota bar is
the last child, so it is the first victim (measured: `6px` of `13px` visible at
`pane=190` — the reported half-bar).

Measured budget (live pane `457px`, chrome overhead `120px`):

| row | empty composer | 40-line draft |
| --- | --- | --- |
| `ChatView` (`flex:1 1 0%`) | 260 *(slack)* | 125 *(slack)* |
| `composer-context-strip` | 32 | 32 |
| `status-bar` | 25 | 25 |
| `composer-root` | 127 | **262** (textarea capped at 120px) |
| quota widget | 13 | 13 |
| **fixed furniture** | **197** | **332** |

Clipping therefore begins at `viewport height < furniture + 120`: below **~317px**
with an empty composer, below **~452px** once a draft grows the composer. The
second threshold is an ordinary short browser window, which is why this is
reachable in normal use.

On **mobile `split`** the exposure is much worse: `split-editor-workspace` requires
the split to stack *vertically* below the mobile breakpoint (chat top, editor
bottom), so the chat pane gets roughly **half** the content height. The `332px`
furniture ceiling is then reachable on a normal phone viewport, with no unusual
window size involved.

A second defect shares the same root cause: **`ChatView` is allowed to collapse to
`0px`** — the transcript disappears entirely — *before* the quota bar starts
clipping. Same budget, same fix, so it is in scope here.

## What Changes

Host-side layout only. The quota plugin is **not** modified.

- **Cap the composer relative to the pane** (`max-height: 40%`) so the fixed
  furniture can never outgrow the pane, and `ChatView` is always left a share.
  This is what prevents both the clipping and the collapse-to-zero.
- **Let the composer yield gracefully** — `min-h-0` plus internal `overflow-y:auto`,
  so hitting the cap scrolls the composer instead of clipping it.
- **Floor the thin rows** — `flex-shrink: 0` on `composer-context-strip`,
  `status-bar`, and the `content-inline-footer` slot wrapper, so the rows that
  cannot usefully shrink are never chosen as the clip victim.

Affected: `packages/client/src/components/chat/CommandInput.tsx`,
`packages/client/src/App.tsx` (slot wrapper), and the chat-pane furniture.

## Non-goals

- **Relocating the widget next to the `88% context` indicator.** Ruled out earlier
  and still ruled out: `composer-footer` is gated on
  `footerVisible = focused || text.trim() || pendingImages.length`
  (`CommandInput.tsx:852`), so the quota bar would vanish whenever the composer is
  blurred and empty — which is most of the time.
- **Touching `packages/quota-plugin/`.** The widget renders correctly; the host
  region is what fails to budget for it. Fixing it host-side also fixes every other
  `content-inline-footer` contribution.
- **Making the pane scroll** (a furniture-stack `overflow-y:auto`). Considered;
  rejected as odd UX for a composer area.

## Accepted limitation

At a genuinely tiny pane, the floors still cannot all fit and something must clip.
The `40%` cap makes the degradation proportional rather than sacrificial — at
`pane=190` the budget becomes composer `≤76` + strip `32` + status `25` + quota `13`
= `146`, leaving `44px` of transcript, all rows visible. This is a much lower
threshold than today's, not a mathematical guarantee at every size.

## Capability impact

This change **no longer modifies `provider-quota-surfacing`** — that delta has been
removed, since the widget's own rendering contract is unchanged. The behavior now
belongs to `split-editor-workspace`, which owns the chat-pane layout contract.

## Discipline Skills

- `systematic-debugging` — the first diagnosis was wrong and shipped a no-op fix;
  the corrected root cause is evidence-first (live measurement sweeps), and the
  tasks require reproducing the defect before and after.
- `review-code` — host layout change touching shared chat furniture.
