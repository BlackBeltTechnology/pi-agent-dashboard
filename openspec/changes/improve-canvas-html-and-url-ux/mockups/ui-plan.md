# UI plan: improve-canvas-html-and-url-ux

Mode: **preserve** (`anti-slop-redesign`). Profile: `product-ui`. Contract: root `ui-contract.md`.
Board: `index.html` (7 surfaces, as-built vs proposed). Serve or open the `mockups/` directory; `?theme=base-dark|base-light|nord-dark&width=375|768|full&view=both|asbuilt|proposed#<surface-id>` preselects the toolbar.

## Files

| File | Purpose |
|---|---|
| `index.html` | Board shell: theme (base dark / base light / nord dark), frame width (375 / 768 / full), view (side by side / as-built / proposed), left nav, per-surface probe badge. |
| `surfaces.js` | `SURFACES[]` (7). Per surface: lead, cited files with lines, findings, realized spec requirements (exact `### Requirement:` titles), AS-BUILT replica (shipped classes as inline styles), PROPOSED states. Also the fake Fleetwise login page used in S2, S3, S4, S7. |
| `canvas.css` | PROPOSED component classes (`c-*` incl. `c-chip`, `lv-*`, `eg`, `pk`, `ac`, `ws`, `tabs`), token-only. Only literal: `#fff` on `--accent-solid`. |
| `probe.js` | Contrast + size probe copied from `align-ui-contract-recipes`; patched to call `renderSurface` and to skip `RECIPES` when absent. `__probeAll()` returns proposed failures and an as-built failure count per surface. |
| `tokens.css` | Copied unchanged (base dark, base light, nord dark). |
| `mockup.css`, `board.css` | Copied unchanged (board chrome, `.pill`, `.seg`). |
| `icons.js` | Copied; 14 MDI glyphs appended from `@mdi/js` (Web, ServerNetwork, ShieldLockOutline, CodeTags, ScriptTextOutline, ChevronLeft, ArrowLeft, FileCodeOutline, LanguageHtml5, Circle, ChatOutline, ImageBrokenVariant, EyeOffOutline, HelpCircleOutline). |
| `AGENTS.md` | Per-file record for this directory. |

## Surfaces → tokens → states → requirements

| Surface | Tokens | Proposed states | Realizes |
|---|---|---|---|
| S1 Canvas tool card | `--link`, `--text-primary`, `--text-secondary`, `--bg-secondary`, `--bg-tertiary`, `--border-subtle`, `--border-secondary` (chip), `--severity-error-fg`, `--severity-success-fg`, `--severity-neutral-*`, `--elevation-rim`, `--shadow-card` | active file, active URL, active server chip, superseded (plain text + Superseded pill), rejected (error line), loopback URL declare awaiting confirm (card), canvas confirm chip "Open localhost:54321/app?", chip after failed tap | tool-renderers: CanvasToolRenderer shows the declared target; Only the active canvas card opens its target; Tool renderer registry. auto-canvas: canvas() declare-tool normalizes into a real ViewTarget. live-server-preview: Declared servers are dashboard-probed for loopback, never auto-detected |
| S2 Viewer header | `--bg-tertiary`, `--bg-secondary`, `--border-secondary`, `--border-primary`, `--severity-info-*` (selected segment, notices), `--severity-neutral-*` (Restricted pill), `--severity-error-{fg,border}`, `--accent-solid` (Add), `--focus-ring` | static scripts on, static no-scripts, port (agent-declared, Restricted pill), inline confirm, remote refused, root-absolute hint (no button), invalid path refused, restricted + exposed with scripts off (Run scripts), active tab updated by the agent (Reload) | live-server-preview: The viewer header is an editable address bar; Address bar paths are validated before use; The viewer reloads on demand and on canvas re-declare; Root-absolute pages explain how to view them; Embedded content SHALL be origin-isolated via sandbox. preview-egress-grants: Scripts on restricted previews depend on exposure; Egress policy is fixed by provenance |
| S3 Egress banner | notice recipe `--severity-warning-*`, `--severity-success-*`, `--severity-neutral-*` (source label), `--bg-tertiary` buttons | blocked list (markup, shared host, runtime, private), access prompts disabled (Allow once only + footnote), collapsed allowed-once pill | preview-egress-grants: The viewer offers non-modal enablement for blocked origins; Egress policy is fixed by provenance; Blocked external origins are detected in markup; Runtime-blocked origins are reported where the browser delivers reports; Only public https origins are grantable |
| S4 Rendered page | none (page content owns its colours) | served static target, styled | live-server-preview: Static targets resolve a capped document root; Static targets serve only contained web assets; Capability responses enforce the sandbox themselves. file-and-url-preview: HTML preview is sandboxed without script execution |
| S5 Target picker | `--severity-success-{fg,bg,border}` (live dot + word), `--tint-red-*` (Clear all, Remove), `--bg-tertiary` (confirm row), `--text-secondary`, `--accent-solid` (Preview), `--bg-hover` | older collapsed, older expanded, Clear all inline confirm | live-server-preview: The target picker leads with live targets; Targets SHALL be loopback-only and allowlisted (SSRF guard) |
| S6 Access row | `--bg-secondary`, `--border-primary`, `--text-secondary`, `--bg-tertiary` (Revoke) | new store group with 3 rows | access-settings-tab: Unified Access settings surface; Revoking a preview-egress grant takes effect on the next preview load. preview-egress-grants: Project egress grants use the preview-egress access plane |
| S7 Composition | all of the above | split workspace, full width: Restricted pill (auto-open), allowed-once pill | S1 + S2 + S3 + S4 together |

## Gate results (re-measured on the revised board, agent-browser, `__probeAll()`)

Re-measured after the revised design (dev-server control removed, Restricted pill, exposure and updated notices, source-labelled egress rows, prompts-disabled banner, confirm chip, Clear all confirm). Failures = text contrast < 4.5:1 (3:1 large) or text < 11 px (< 12 px inside an interactive element). The probe does not measure target size or iframe content.

| Surface | Proposed (dark / light / nord) | As-built (dark / light / nord) |
|---|---|---|
| S1 tool card | 0 / 0 / 0 | 0 / 0 / 0 |
| S2 viewer header | 0 / 0 / 0 | 0 / 0 / 0 |
| S3 egress banner | 0 / 0 / 0 | 0 / 0 / 0 |
| S4 rendered page | 0 / 0 / 0 | 0 / 0 / 0 |
| S5 target picker | 0 / 0 / 0 | 1 / 2 / 2 |
| S6 access row | 0 / 0 / 0 | 0 / 0 / 0 |
| S7 composition | 0 / 0 / 0 | 0 / 0 / 0 |
| **Total** | **0** | **1 / 2 / 2** |

Same result at frame width 375. No `.frame` overflows horizontally at 375, 768 or full.

As-built defects that are not contrast: header buttons about 20 px high (S2 H3); no remove or reload control (S2, S5); raw `text-green-400` status glyph and `bg-[var(--accent-blue)]` + white text 3.68:1 (S5 P4); uppercase `--text-tertiary` group headings (S6 A2); unstyled page (S4).

## Rubric (boolean, proposed column)

| # | Check | Pass |
|---|---|---|
| 1 | Text contrast >= 4.5:1 in 3 themes | yes (probe 0) |
| 2 | No text < 11 px; < 12 px in interactive | yes (probe 0) |
| 3 | State never by colour alone (Live word + dot, Superseded word, check on selected segment, pill words) | yes |
| 4 | Every control >= 24 px (28 px desktop, 44 px at 375) | yes (`--tap`) |
| 5 | Icon-only buttons have `aria-label` (reload, remove, dismiss, close) | yes |
| 6 | One primary action per row or form (Add, Preview); the Clear all confirm row has one destructive action (Remove) | yes |
| 7 | Errors inline, `role=alert`, field `aria-invalid` + `aria-describedby` | yes |
| 8 | Egress banner is non-modal (`role=status`, no focus move), offers no grant for private addresses, and offers no project grant for page-reported origins | yes |
| 9 | No raw colour in `canvas.css` beyond `#fff` on `--accent-solid` | yes |
| 10 | No em-dash in new UI copy | yes (as-built replicas keep shipped copy; new Access heading uses a middle dot) |
| 11 | No horizontal overflow at 375 / 768 | yes |

## Decisions and open questions

1. **Superseded card carries a "Superseded" neutral pill.** The spec only requires plain text; the pill explains why the target is not a link.
2. **Card body is visible only when the tool row is expanded.** `ToolCallStep` starts collapsed and shows just `canvas`. Open question: expand `canvas` rows by default (as `ask_user` does) or add a `toolSummaries.canvas` entry (title or target). Not in the spec.
3. **Segmented Scripts | Static** uses `role=radiogroup`, info tint plus check icon on the selected option. Applies to static targets only.
4. **Access heading separator.** Existing labels use an em-dash (`Label — store`). New group is drawn with a middle dot to respect the no-em-dash rule. Implementation should either follow the neighbours or retrofit all groups.
5. **Picker as-built row count.** Drawn as 12 rows (9 dead, the live one, 2 manual) so it maps to the proposed 1 active + 2 added + 9 older.
6. **Fake page colours** are literals inside the iframe `srcdoc` (page content, not dashboard UI).
7. **Dev server control removed (revised design D1/D9).** The earlier "Open via dev server" header button and hint button are gone (`live-dev-server`, `live-hint-dev-server`). Opening agent HTML from a localhost origin would give it the dashboard's trusted loopback CORS and mutation-gate standing, so the dashboard never spawns or re-serves through one. The root-absolute hint (S2 f) is guidance only: run a dev server bound to localhost and open its localhost URL in the canvas.
8. **URL declares use the confirm chip.** A loopback `kind:"url"` declare no longer auto-opens. S1 (f) shows the card with the plain target, a "Not opened yet" pill and Confirm and open. S1 (g) is the canvas chip "Open localhost:54321/app?" mirroring `CanvasServerChip`. The tap probes `127.0.0.1` and opens a restricted preset target at the declared path. It consents to connecting only, so the header shows the Restricted pill.
9. **Runtime origins are allow-once only.** A page can post its own CSP reports, so a row labelled "reported by this page" has Allow once and no project grant. Markup rows have both. Shared-hosting hosts add a warning line. With access prompts disabled (the default) the project button is absent and a footnote points to Settings → Access.
10. **Restricted pill and exposure.** Agent-opened previews show a neutral "Restricted" pill in the header. When the dashboard is exposed, scripts stay off until the user clicks Run scripts; that button lives in the exposure notice (S2 h), not also in the header, to avoid two copies of one control.
11. **Active-tab update stays non-modal.** S2 (i) shows "Updated by the agent" with Reload (`live-updated-reload`) and leaves the frame untouched. Background tabs reload silently.
12. **Clear all asks first.** S5 (c) replaces the Clear all button with an inline confirm row ("Remove 9 older targets?", Remove destructive tint, Cancel). The group subtitle reads "Added by earlier automatic launches or before this update".
13. **Access group label** uses `preview-egress.json` (the store file named in design D7) instead of the earlier `config.previewEgress`.
