# UX review — extract-mcp-client-plugin mockups

Reviewed: `global-settings.html` (S1+S2), `folder-page.html` (S3+S4+S5). Both themes, 390 / 1440 widths. `score_mockup` could not capture (Playwright chromium_headless_shell not installed — `npx playwright install`); screenshots taken via agent-browser instead. Rubric = `packages/mockup-loop/references/ux-best-practices.md` §4 protocol + §5 seed.

## Step 1 — Accessibility floor (hard gate)

| Check | Verdict | Note |
|---|---|---|
| Contrast 4.5:1 body / 3:1 UI, dark + light | PASS | All text on `--text-*` tokens; status colors via `--severity-*-fg` (46% mix toward text-primary, the repo's contrast-safe recipe). |
| Target size ≥44px mobile | PASS (with fix) | Rows `min-height:44px`; buttons 32px tall on desktop — mobile rows give a 44px hit region. Chip `✕` is 20×20 — **defect D3**. |
| Focus visible | PASS | `:focus-visible` outline on btn/input/select/switch (`--focus-ring`). |
| Color not sole channel | PASS | off = strikethrough + switch position; error = `✕` glyph + text; warning pill = `!` + text. |
| Reduced motion | PASS | `prefers-reduced-motion` disables transitions. |
| Semantics | PASS | `role=switch` + `aria-checked`, `role=tablist/tab`, `role=alert` summary, `role=status` toast, `aria-invalid` on failing field. |

Gate: **pass**, pending D3.

## Step 2 — Heuristic rubric (assert TRUE)

| # | Rule | S1/S2 | S3/S4 | Evidence / defect |
|---|---|---|---|---|
| 1 | Visibility of status (H1) | ✓ | ✓ | adapter version in header; "Unsaved changes" dot; pill counts. **D1**: header "● adapter 2.31.0" and floor banner "2.18.0" can contradict — must be one source. |
| 2 | Real-world language (H2) | ✓ | ✓ | "Shared" / "Pi global" / "Pi folder" instead of layer indices; file paths shown verbatim. |
| 3 | User control (H3) | ✓ | ✓ | Discard, ✕ close, Undo toast on override removal. |
| 4 | Consistency (H4) | ✓ | ✓ | Same row anatomy on both pages; pill mirrors KB pill (`FolderKbSection`) exactly. |
| 5 | Error prevention (H5) | ✓ | ✓ | Shared servers get *View* not *Edit*; delete is confirm-gated ("Delete server…"); "Renaming creates a new entry" hint. |
| 6 | Recognition > recall (H6) | ✓ | ✓ | Provenance badge + path on row, not tooltip; folder rows say "inherited · no folder override". |
| 7 | Flexibility (H7) | ~ | ~ | No bulk enable/disable, no search — acceptable at ≤10 servers; **note N1** for >10. |
| 8 | Minimalist, one primary CTA (H8) | ✓ | ✓ | "+ Add server" is the only primary in the header; "Save" the only primary in the editor. Von Restorff respected. |
| 9 | Error recovery (H9) | ✓ | — | postgres row: cause ("trailing comma, line 41") + two fixes (Open file / Edit). Field error states the fix. |
| 10 | Help in place (H10) | ✓ | ✓ | Per-field hints; layer legend under the section head. |
| 11 | Hick's — progressive disclosure | ✓ | — | 6 core fields, `Advanced` details for the other ~24; transport tabs hide the irrelevant half. |
| 12 | Label above field, no placeholder-as-label | ✓ | — | All fields labelled; placeholders only carry "inherit" hints. |
| 13 | Inline error + linked summary (Baymard / GOV.UK) | ✓ | — | `role=alert` summary links to `#f-command`. |
| 14 | Single column on mobile | ✓ | ✓ | settings grid collapses; editor becomes a bottom sheet. |
| 15 | Undo over confirm (NN/g) | ✓ | ✓ | Remove override → undo toast. Delete server → confirm (destructive, irreversible file edit). |
| 16 | Proximity / common region (Gestalt) | ✓ | ✓ | Row bands; editor in its own surface; legend visually attached to the section head. |
| 17 | Jakob's — matches platform | ✓ | ✓ | Same breadcrumb/header/sticky-footer pattern as KbSettingsPanel; settings-panel spec's discard-confirm on route leave applies. |
| 18 | Tesler's — system absorbs complexity | ✓ | ✓ | Effective/merged view computed by the adapter; user never reads six files. |

## Step 3 — Cognitive walkthrough (key flows)

**Flow A: "turn off `filesystem` in this repo only."** Open folder pill → `→` → find row → flip switch. Will the user know the switch is folder-scoped? Yes — page title "this folder", legend says edits go to `.pi/mcp.json`, and the chip "folder: disabled" appears after. Feedback: chip + toast. **OK.**

**Flow B: "why is `github` prefixed `gh_` here?"** Folder row shows "inherited · global override: toolPrefix". User clicks "Override…" expecting to *see* the global value — the folder page has no read-only reveal of the inherited value before overriding. **D2.**

**Flow C: "adapter too old."** Banner states version + floor + consequence + one action. But the editor drawer stays editable in the mockup. **D1b**: with the floor banner up, list switches and the editor must be read-only (mirrors "listed read-only until you upgrade").

**Flow D: apple-tools user after the split.** Panel shows "MCP entry: Pi global · enabled · directTools on · Manage MCP servers →". The two controls that used to live here are one click away with a labelled link. **OK** — but the installer needs a "mcp-client plugin is disabled" state (dependsOn cascade). **D4.**

## Step 4 — Anti-slop (advisory, Part A only)

No purple gradient / hero; system font stack matches the dashboard; no em-dash-as-style tells (the one in the error text is copy, not decoration); data is real (`iMCP`, `@modelcontextprotocol/server-filesystem`, `@playwright/mcp`), not Acme. **Clean.**

## Step 5 — Prioritised fix list

| ID | Sev | Defect | Fix |
|---|---|---|---|
| D1 | 3 | Header adapter status and floor banner can disagree; editor stays editable under the floor banner. | Single `adapterStatus` object drives header pill, banner, and a global `readOnly` flag that disables switches, Edit → View, and the editor footer. Spec it in `mcp-client-settings`. |
| D2 | 3 | Folder "Override…" gives no view of the inherited value first. | "Override…" opens the editor pre-filled with the effective values, every field showing an "inherited from Pi global" hint; changing a field creates the override for that key only. |
| D3 | 2 (a11y) | Override chip `✕` is 20×20; below 44px on mobile. | Move removal into the row's Edit sheet on mobile (chip becomes display-only <640px), or pad to 32px min and rely on row-level 44px region. |
| D4 | 2 | apple-tools panel lacks the "mcp-client disabled / missing" state that `dependsOn` produces. | Panel reads `PluginStatus.missingDeps`; shows a banner "Requires the MCP client plugin — Enable" linking to `/settings/plugins`, and disables Run installer. Add to the `apple-tools-provisioning` delta. |
| D5 | 1 | Secret masking is described in a hint but not shown. | Editor renders `env`/`headers` values matching `*_TOKEN|*_KEY|Authorization` as `••••` with a reveal toggle; spec as a `security-hardening` scenario. |
| N1 | note | No search/bulk at >10 servers. | Out of scope for v1; note in design. |

## Verdict

Gates pass (D3 is the one a11y item, low-cost). Layout, tokens, and heuristics are sound; the substantive findings are **state-model** gaps (D1, D2, D4) that belong in the specs, not in the pixels. Recommend carrying D1–D5 into `specs/` as scenarios before `design.md`.

Screens: `http://localhost:4173/global-settings.html` (`?theme=light`, `&state=floor`), `http://localhost:4173/folder-page.html` (`?theme=light`). LAN: `http://192.168.16.220:4173/…`.
