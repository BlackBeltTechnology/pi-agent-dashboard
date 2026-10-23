# Spike D: harness and raw results

Throwaway harness behind `design.md` Context. Not product code.

## Run

```bash
mkdir -p /tmp/spike-d && cp openspec/changes/keep-oversized-chat-selection/spike/* /tmp/spike-d/
cd /tmp/spike-d
R=/path/to/pi-agent-dashboard   # repo root
node -e "require('$R/node_modules/esbuild').build({entryPoints:['app.tsx'],bundle:true,outfile:'app.js',nodePaths:['$R/node_modules'],define:{'process.env.NODE_ENV':'\"production\"'},jsx:'automatic'})"
npx playwright install firefox webkit   # once
node drag2.mjs                    # ENGINE=firefox|webkit for other engines (Firefox: use ff.mjs)
node run.mjs selall               # Select-All copy timing, 1x / 6x CPU
ENGINE=webkit node race.mjs       # selectionchange swallowed, with and without live read
node rehl.mjs                     # interior re-highlight after remount
node real.mjs <sessionId>         # per-row mount cost on the running dashboard (read-only)
```

The scripts import Playwright from an absolute repo path; adjust it if the repo lives elsewhere.

URL params for `app.tsx`:

| Param | Meaning |
|---|---|
| `mode=clear\|endpoints` | `clear` reproduces today's behavior: `removeAllRanges` past the cap |
| `cap` | Retained-row ceiling |
| `n` | Row count |
| `h` | Scroller height |
| `noSel=1` | Swallow `selectionchange` |
| `live=1` | Live read of the selection in `rangeExtractor` (persists into `spanRef`) |
| `measureCopy=1` | Attach `measureElement` to copy-only rows |

Versions: `@tanstack/react-virtual` 3.14.10 → `@tanstack/virtual-core` 3.17.8, React 19.2.8. Playwright Chromium, Firefox, and WebKit 26.5. macOS.

## Raw results

Drag test: about 80 rows with a scrolling drag, cap 40, 1000 rows.

| Engine | `clear` | `endpoints` |
|---|---|---|
| Chromium | selection collapsed | anchor 0 → focus 78; 17 mounted; copy 86 mounted, 79 rows, ordered, 8.9 ms |
| Firefox | collapsed | 0 → 76; copy 83 mounted, ordered, 26 ms; native `toString()` 3.9 KB vs copy 32 KB |
| WebKit | **re-anchored 0→33 then 41→78**; copy got rows 41–78 only | 0 → 78; copy ordered, 13 ms |

`selectionchange` swallowed (`race.mjs`):

| Engine | Without live read | `live=1` |
|---|---|---|
| Firefox | anchor → container `DIV` | anchor 0 retained |
| WebKit | anchor → container `DIV` | anchor 0 retained |
| Chromium | re-anchors to visible rows (70→78) | anchor 0 retained |

Re-highlight (`rehl.mjs`): after scrolling back into an unmounted interior, every remounted interior row satisfies `containsNode(row, true)`. Chromium 17/17, Firefox 14/14, WebKit 17/17.

Select-All copy (synthetic rows; copy-only rows unmeasured / measured):

| Rows | 1× total ms | 6× total ms |
|---|---|---|
| 200 | 54 / 64 | 148 / 360 |
| 500 | 61 / 144 | 353 / 882 |
| 1000 | 112 / 322 | 674 / 1855 |

All runs copied every row, ordered, with no missing rows. Measured copy-only rows moved `scrollTop` by 236 px (compensated); unmeasured rows left it unchanged.

Real dashboard per-row mount (`real.mjs`, scroll-jump `flushSync` commits, two ended sessions of 315 and 405 rows): about 0.9–1.0 ms/row at 1× (p90 1.3–2.1) and about 3.5–3.7 ms/row at 6× (p90 5.1–7.7). These figures include unmount, `measureElement` layout, and sync passive effects.

`act.tsx`: `<Activity mode="hidden">` under `flushSync` commits 0 DOM rows. A plain mount runs all 300 passive effects synchronously.

## Cycle-2 follow-up runs (`ab.mjs`, `race2.mjs`)

`app.tsx` gained:

| Addition | Purpose |
|---|---|
| `#before` text | Text before the scroller |
| `#ta` textarea | Paste target |
| `live=2` | Non-persisting live read |
| `decline=1` | `preventDefault` with no `setData` |
| `__reactOnCopyFired` | Records whether the React `onCopy` ran |

| Check | Chromium | Firefox | WebKit |
|---|---|---|---|
| Range from `#before` into transcript row 4: container React `onCopy` fires? / document `copy` listener fires? | no / yes | no / yes | no / yes |
| `selectAllChildren(body)`: React `onCopy` / document listener | no / yes | no / yes | no / yes |
| Declined copy (`preventDefault`, no `setData`) after a native copy of "BEFORE-TEXT sidebar", then paste | prior clipboard kept | prior clipboard kept | prior clipboard kept |
| `noSel=1&live=2` (non-persisting live read, `selectionchange` swallowed): anchor through an ~78-row drag | 0→78, anchor kept | 0→76, anchor kept | 0→78, anchor kept |

The engines are desktop Playwright builds driven by mouse/wheel or `scrollTop`. No touch / iOS run exists.
