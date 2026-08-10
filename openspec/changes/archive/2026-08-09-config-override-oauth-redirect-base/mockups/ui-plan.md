# UI Plan — operator surfaces for this change

Covers every operator-facing surface the change adds: **D9** (provider deletion),
**D10** (diagnostics), **D12** (one gateway action), **D13** (drift + Fix), and
the Settings ▸ Security input. Tokens are the dashboard theme layer
(`packages/client/src/index.css`); no raw hex below the `:root` block.

## Surfaces

| § | Surface | Home | Component | Scenario |
|---|---|---|---|---|
| 1 | Gateway list + status + Fix | Gateway page (persistent) | shared `GatewayList` | F5, F8 |
| 2 | Add-gateway dialog | Gateway page + `GatewaySetupGuide` | shared `GatewayDialog` | F5, F6 |
| 3 | Remove confirmation | modal over the list | shared `GatewayConfirm` | F7 |
| 4 | Fix confirmation (delta) | modal over the list | shared `GatewayConfirm` | F8 |
| 5 | Fix — **Ineligible** (re-choose modes) | modal over the list | shared `GatewayDialog` | D13 |
| 6 | Settings ▸ Security redirect base | `SettingsPanel.tsx` | — | F10 |
| 7 | Remove provider + last-provider lockout | Settings ▸ Security | — | G11, G12 |
| 8 | Diagnostics (web + `doctor`) | `GET /api/auth/diagnostics` | — | S3–S6 |
| 9 | First-run setup step | `GatewaySetupGuide.tsx` | shared `GatewayDialog` | F12 |

One shared component per surface, rendered from both entry points (D12) — two
implementations would drift, and F12 asserts the markup is identical.

## Tokens used (existing; nothing new required)

| Role | Token |
|---|---|
| page / panel / card / input | `--bg-primary` / `--bg-secondary` / `--bg-tertiary` / `--bg-surface` |
| headings / body / labels / hints | `--text-primary` / `--text-secondary` / `--text-tertiary` / `--text-muted` |
| borders | `--border-primary`, `--border-secondary`, `--border-subtle` |
| status: OK / warn / error / info | `--accent-green` / `--accent-yellow` / `--accent-red` / `--accent-blue` |

**One token added:** `--accent-green-text` (`#22c55e` dark / `#166534` light).
The shipped `--accent-green` is only **4.40:1** on `--bg-tertiary` in light
theme. A colour used as *status text* has to clear 4.5:1 on every surface it can
land on, not just the one it happens to sit on today — so status text gets its
own darker token rather than a per-site override. Per the theme-system rule, this
goes in the theme layer first, then here.

**Drift found while grounding (report, do not fix here):**

1. `GatewayEndpoints.tsx:154,163` uses `var(--border)` and
   `var(--danger,#ef4444)` — neither token is defined in `index.css`; both
   silently ride their fallback. The defined names are `--border-primary` and
   `--accent-red`.
2. White on `--accent-blue` is **3.68:1** — a live WCAG-AA failure anywhere the
   dashboard fills a primary button with it. This mockup uses `--bg-primary` as
   the label colour (5.38:1).

## States per surface

**Gateway row** — `OK` · `Incomplete` · `Conflicting` · `Ineligible` (D13).
Status is computed on read, never stored.

**Add dialog** — driven by the URL's scheme (D12):

| scheme | trusted network | QR pairing | OAuth | CORS |
|---|---|---|---|---|
| `http://` | required, CIDR pre-filled | disabled + reason | disabled + reason | always written |
| `https://` | optional | selectable | selectable | always written |

Save is refused when no auth mode is selected, and when an `http://` gateway has
no trusted network.

**Remove** — lists every field it will revert, from the gateway's `wrote`
provenance record, before writing.

## Cited UX rules

Each decision names a public source; no decision rests on taste.

| Decision | Rule | Source |
|---|---|---|
| Status badge on every gateway row | Visibility of system status (heuristic 1) | NN/g 10 Usability Heuristics |
| Badge = icon + text, never colour alone | WCAG 1.4.1 Use of Color | W3C WCAG 2.2 |
| Scheme disables ineligible modes instead of erroring after save | Error prevention (heuristic 5) | NN/g |
| Disabled control states *why* inline | Help users recognise, diagnose, recover (heuristic 9) | NN/g |
| "This will write / This will revert" summary before commit | Recognition rather than recall (heuristic 6) | NN/g |
| Blocking errors collected at the top of the dialog, each linking to its field | Error summary pattern | GOV.UK Design System |
| Auth modes capped at 3 checkboxes | Hick's Law — choice count drives decision time | lawsofux.com/hicks-law |
| Destructive Remove is confirmed and reversible-by-record | User control and freedom (heuristic 3) | NN/g |
| Fix restores only the delta and says what it restores | Match between system and the real world (heuristic 2) | NN/g |
| Interactive targets ≥ 24×24 CSS px (44 on coarse pointers) | WCAG 2.5.8 Target Size (Minimum), AA | W3C WCAG 2.2 |
| Visible focus ring on every control | WCAG 2.4.7 Focus Visible | W3C WCAG 2.2 |
| Body/label contrast ≥ 4.5:1, both themes | WCAG 1.4.3 Contrast (Minimum) | W3C WCAG 2.2 |
| Ineligible Fix re-asks instead of auto-picking a replacement mode | Error prevention (5) + user control and freedom (3) | NN/g |
| Settings field shows the value **in force**, not just the stored one | Recognition rather than recall (6) | NN/g |
| Settings links to the gateway action rather than duplicating it | Consistency and standards (4) | NN/g |
| Last-provider delete states the consequence in plain language | Error prevention (5); "help users recognise" (9) | NN/g |
| Destructive confirm uses an explicit acknowledgement, not a second "Are you sure?" | Confirmation dialogs are click-through-prone; require an action that encodes understanding | NN/g — *Confirmation Dialogs Can Prevent User Errors* |
| Diagnostics names which tier **won**, and shows the losers struck through | Visibility of system status (1) | NN/g |
| Diagnostics reachable over loopback + terminal, not remote-only | Help users recognise, diagnose, recover (9) — the tool must work in the failure it diagnoses | NN/g |
| First-run step embeds the same component it will meet later | Jakob's Law — users expect this to work like the thing they already know | lawsofux.com/jakobs-law |
| Status colour token clears AA on every surface, not just its current one | WCAG 1.4.3 | W3C WCAG 2.2 |

## Scored rubric — result

| Criterion | Verdict | Evidence |
|---|---|---|
| Contrast (WCAG 1.4.3) | PASS | 54 computed checks, 0 fail. Min **4.65:1** dark / **4.54:1** light |
| Responsive | PASS | 375 / 768 / 1440 captured; no overflow (`pre.term` scrolls rather than breaking layout); 44px targets on coarse pointers |
| Hierarchy | PASS | Section → caption-with-cited-rule → surface; scan path per row is URL → status → reason → action |
| Spacing | PASS | Token scale, consistent with shipped Gateway spacing |
| Token fidelity | PASS | All values are CSS vars; raw hex only in the `:root` theme block |
| Anti-slop | PASS | No AI-purple, no gradient hero, no Inter; realistic data (`pi.example.com`, `10.4.0.9/32`), not Acme/Jane Doe |
| Console | PASS | Clean |
| Use of colour (1.4.1) | PASS | Badges are glyph + word; diagnostics losers use strike-through, not colour alone |
| Focus visible (2.4.7) | PASS | `:focus-visible` ring at 5.01:1 |
| Destructive-action a11y | PASS | "Remove anyway" exposed `disabled` until the acknowledgement is checked; full sentence is the checkbox's accessible name |
