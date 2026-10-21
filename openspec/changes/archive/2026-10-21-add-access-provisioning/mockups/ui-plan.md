# UI plan: add-access-provisioning

Mode: **preserve** (`anti-slop-redesign`). Profile: `product-ui`. Contract: root `ui-contract.md`. Image direction: off.
Board: `index.html` (7 state sections). Open the `mockups/` directory over any static server. `?theme=base-dark|base-light|nord-dark&width=375|768|full` preselects the toolbar. Static files, no server run against `:8000`.
Task: `tasks.md` 3.1. **Operator approval of this board is the gate for 3.2; not given yet.**

## Files

| File | Purpose |
|---|---|
| `index.html` | Board shell + all state renderers (inline JS). Toolbar: theme (base dark / base light / nord dark), frame (375 / 768 / full), probe badge. Ticking an Approve box updates the count and enables the button (demo only). |
| `prov.css` | Proposed recipes: `dlg*` (Dialog panel), `ln` (folder line), `pt` (PiTrustCheckbox replica), `goal`, `csq` (consequence block), `card/row/subj/meta/b` (Access page), `banner`, `tag`. Tokens only, no colour literal. Container queries so the 375 / 768 frame behaves like a viewport. |
| `tokens.css`, `mockup.css`, `probe.js` | Board kit copied unchanged from `improve-canvas-html-and-url-ux/mockups` (tokens verified in step with `packages/client/src/index.css`). |
| `icons.js` | Copied from the same kit; 7 MDI glyphs appended (ShieldAlertOutline, FolderCheckOutline, Cancel, FolderOffOutline, LanConnect, ShieldCheckOutline, FolderAlertOutline). |
| `AGENTS.md` | Per-file record. |

## Grounding (as-built sources read)

| Source | Reused |
|---|---|
| `access-grant/GrantPromptDialog.tsx` | `Dialog` panel (`bg-secondary`, `border-secondary`, `rounded-xl`), info icon tile (`--severity-info-*`), plane/status pills, subject as mono headline, consequence line (`text-xs text-secondary`), footer note + neutral verdict buttons, initial focus on built-in close, no answer emphasised |
| `access-grant/PiTrustCheckbox.tsx` | Checkbox + label + consequence copy, verbatim strings |
| `settings/AccessPromptsSection.tsx` | `CARD`, `ROW`, `SUBJECT`, `META`, `BTN`, `WARN_BANNER`, heading `text-xs font-bold uppercase`, inert-not-hidden toggle, `Pending requests (n)` shape |
| `settings/AccessSection.tsx` | Store group heading, entry row, meta spans (`Scope`, `Granted`, `Origin`, `Agent prompt`, `via prompt`), `hash only` badge shape reused for the `Provisioned` tag, Revoke button |
| `remote-access/RemoteAccessDialog.tsx` | Not redrawn. The hand-off opens it on its landing (spec); the board shows only the `handed-off` state in the provisioning dialog |

## Surfaces → tokens → states → requirements

| Surface | Tokens | States on the board | Realizes |
|---|---|---|---|
| S0 Line classes | `--severity-{info,neutral,success,warning,error}-{bg,fg,border}`, `--text-*`, `--border-secondary` | table of the 7 classes (check order, pill, explanation, approve control) | Each line is resolved and classified before the operator sees it; Credential folders are not provisionable |
| S1 Dialog, 6 lines | `--bg-secondary`, `--bg-tertiary`, `--bg-overlay`, `--border-secondary`, `--border-primary`, `--border-subtle`, `--severity-info-*` (icon tile, Expires pill, Needs your approval), `--severity-neutral-*`, `--severity-success-*`, `--severity-error-*`, `--focus-ring`, `--accent-solid` (checkbox only), `--text-primary/secondary/tertiary`, `--shadow-card`, `--elevation-rim` | open nothing selected, with queued count and close focused | The provisioning dialog asks per line and preselects nothing; A project-root line offers the pi-trust choice; Reasons are bounded and inert |
| S2 Dialog, 32 lines | as S1 | 32 lines of all classes, 200-char cut + `… cut`, markup / log-forging reason rendered literally, wrapped long path, one scroll region | Provisioning requests are bounded, rate limited and expire; Reasons are bounded and inert |
| S3 Dialog, remote only | as S1 + `--severity-success-*` (Remote access opened pill) | `lan` only; after tap with `lan` + `device` | Remote-access goals are handed off to the remote-access wizard; A provisioning request proposes and never writes |
| S4 Access, answerable | `--bg-primary`, `--bg-secondary`, `--border-primary`, `--text-*`, `--accent-solid` (switch on), plus S1 tokens | 2 pending requests, toggle on, `Dismiss all pending` enabled | The Access page lists and answers pending provisioning requests; The Access page dismisses all pending provisioning requests at once |
| S5 Access, read-only | `--severity-warning-{bg,fg,border}` (banner), `--text-tertiary` (Read-only) | no capability; observe tier | same + Only a capability-holding connection can settle a request |
| S6 Grant label + notices | `--severity-info-*` (Provisioned tag), `--bg-surface`, `--border-secondary`, `--severity-warning-*` | provisioned vs agent-prompt vs prompt rows; prompting off banner + toggle off + empty pending | Provisioned grants are labelled with their project; Prompting is on by default and can be disabled outright; The Access page reviews and revokes; it does not create grants |

## Copy proposed (for operator review)

| Where | Copy |
|---|---|
| Dialog title | `Allow folders for this project?` (folders), `Open Remote access for this project?` (goals only) |
| Claim | label `requested for`, path in mono; `The project name is the requester's claim; nothing has verified it. Only the folders you tick are approved.` |
| Reach | **`Approved folders become readable and writable by every session on this machine`** `until you revoke them in Settings → Access.` |
| Limit (consent, not protection) | `Approving records your consent. It does not protect against a program on this machine that changes access by other means.` |
| Footer | note `Dismissing rejects every folder.`; buttons `Reject all`, `Approve selected (n)`; remote-only: `Dismissing closes this request.`, `Dismiss` |
| Per-line control | checkbox `Approve` (unchecked), `aria-label="Approve <path>"`; omitted = reject (D9 wire) |
| Reason | `Reason: <text>`; empty → italic `no reason given`; over 200 → first 200 + `…` + `cut` tag |
| Resolved path | `resolved from <as written>` (symlink / relative / `~`); invalid → `as written <input>` |
| Classes | see S0 table; internal class names never shown |
| Remote goals | heading `Remote access (n)`; note `These open the Remote access wizard. This request changes nothing there.`; per goal `In Remote access, choose “<task>”.` lan → `Allow devices on my network`, internet → `Share over the internet`, device → `Let a phone or laptop in`; button `Open Remote access`; after tap pill `Remote access opened` |
| Access group | `Provisioning requests (n)`; `Dismiss all pending`; `Dismissing a request counts toward that project's cooldown, so it can't ask again straight away.` |
| Read-only (no capability) | `Read-only: this browser can't answer provisioning requests` + `The server issued it no prompt capability (only a same-origin dashboard browser connection gets one). …` |
| Read-only (observe) | `Read-only: this connection is view-only` + `An observe-tier connection can't answer provisioning requests, even with a prompt capability. …` |
| Provisioned grant | tag `Provisioned` + `requested for <project root>` (replaces `Origin:` on that row) |
| Prompting off banner | `Prompting is off. No dialog will be raised, and project provisioning requests are refused. Recorded denials remain listed and answerable below.` |
| Toggle hint | `On by default. Existing grants stay in force when off; denials are still recorded.` (was `Off by default. …`) |

## Gate results (headless Chromium via Playwright, `window.__probeRoot` from `probe.js`)

Probe = text contrast < 4.5:1 (3:1 large) or text < 11 px (< 12 px inside an interactive element). It was verified to fire on a deliberately bad element. Failures per frame, all sections S0-S6:

| Frame width | Base dark | Base light | Nord dark |
|---|---|---|---|
| 375 | 0 | 0 | 0 |
| 768 | 0 | 0 | 0 |
| 1440 | 0 | 0 | 0 |

No `.frame` overflows horizontally and the document does not overflow at 375, 768 or 1440 in any theme. No page errors. `node scripts/theme-token-guard.mjs`: no new violations (it scans `packages/`; the mockup adds no colour literal: `grep` for hex / `rgb(` / `hsl` in `prov.css` and `index.html` is empty). The probe does not measure target size or focus order.

## Rubric (boolean)

| # | Check | Pass |
|---|---|---|
| 1 | Text contrast >= 4.5:1 in 3 themes | yes (probe 0) |
| 2 | No text < 11 px; < 12 px in interactive | yes (probe 0) |
| 3 | State never by colour alone (class pill = icon + word; `Read-only`, `no reason given`, `cut`, `Provisioned` are words) | yes |
| 4 | Controls >= 24 px; 36 px desktop, 44 px below 640 px container | yes |
| 5 | Icon-only buttons have `aria-label` (Close says it rejects every folder) | yes |
| 6 | No answer preselected or focus-defaulted; both footer buttons share the neutral intent; no `Select all` | yes |
| 7 | Reach and limit sentences stay visible without scrolling the folder list | yes (pinned; consent sentence moves into the body below 640 px) |
| 8 | Approve control only on `grantable` lines | yes |
| 9 | No colour literal; tokens only | yes (one theme-invariant exception avoided: no white-on-`--accent-solid` button is used) |
| 10 | No em-dash in new UI copy | yes (`Path grants — access-grants.json` is the as-built label kept verbatim) |
| 11 | No horizontal overflow at 375 / 768 | yes |

## Decisions and open questions (for the 3.1 review)

1. **Pinned footer, one scroll region.** As-built `GrantPromptDialog` scrolls the whole panel. A 6-line request plus a goal already passes a 900 px viewport, and 32 lines is far past it, so buttons would scroll away. Proposal: flush `Dialog` mode, title fixed, body scrolls (`tabindex=0`, labelled region), reach sentence + buttons fixed. At 375 x 800 the pinned block leaves room for about 1.5 lines, so below 640 px the consent sentence moves to the end of the body. Judge fit in 3.10; if too tight, raise the narrow cap to `max-h-[92dvh]`.
2. **Neutral buttons, no primary.** Follows the as-built "no answer emphasised" rule. `Approve selected (n)` is disabled at 0.
3. **No bulk `Select all`.** A bulk approve is a preselect by another route. Open question: add `Select all that need approval` as a deliberate, unchecked-by-default action?
4. **pi-trust checkbox enabled before the line is ticked.** Spec stores the choice only for a `granted` line. Open question: disable it until the line is ticked, or leave it as drawn.
5. **Read-only keeps `Open Remote access` enabled.** It answers nothing and the wizard enforces its own access. Open question: disable it too.
6. **`Dismiss all pending` has no confirm** (spec). It is a small neutral button, inert when read-only or when none are pending.
7. **Consequence block repeats per request card** on the Access page: an answer there must not be less informed than in the dialog. Cost: two requests make a long page.
8. **Provisioned label replaces `Origin:`** on that row (it would repeat the project root) and uses an info-tone `Provisioned` tag plus `requested for <path>`. The word carries the meaning.
9. **No countdown ticking.** `Expires in 9 min` is a static pill (10-minute life); the held-dialog seconds countdown of the as-built dialog is not copied.
10. **Remote access dialog not redrawn.** Its landing is unchanged by this change.

## Operator decisions (2026-10-19, mockup review)

- Verdict: approved as shown.
- Add a "Select all grantable" control (unchecked by default, applies only to `grantable` lines; never preselected). Mockup S1/S2 to be read with this control added above the line list.
- pi-trust checkbox is always enabled (not gated on the line's approve box); it only takes effect for lines that end `granted`.
- "Open Remote access" stays enabled in the read-only state (it only opens a dialog).
