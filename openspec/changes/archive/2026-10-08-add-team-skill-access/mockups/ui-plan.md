# UI plan: add-team-skill-access (team-app)

Token authority: repo `ui-contract.md` → `packages/client/src/index.css`. `tokens.css` and `mockup.css` are verbatim copies of the add-team-plugin mockup (`openspec/changes/archive/2026-10-06-add-team-plugin/mockups/`). New rules live in `skills.css` and reference `var(--…)` only. No new tokens are added.

Mockup: `index.html` + `mockup.js` + `skills.css`. Hash routes: `#/` grid excerpt · `#/skills` · `#/skills/new` · `#/skills/:name` · `#/personas/:key` · `#/agent/:key`. The dashed "Mockup controls" bar is not part of the app; it switches role, mode and catalog state.

Probe: `NODE_PATH=$PWD/node_modules node openspec/changes/add-team-skill-access/mockups/ux-probe.cjs <url> <out>`. Last run: **85/85**. It covers:
- axe WCAG 2.2 AA on 9 screens in both themes, plus 5 variants;
- reflow at 375, 768 and 1440 px;
- 44 px targets at 375 px;
- i18n parity;
- 10 decision flows.

## Surfaces → tokens → states

| # | Surface (future component) | Tokens | States |
|---|---|---|---|
| S1 | Grid entry: "Képességek" secondary button next to "Új persona" (admin / operator only) | secondary button recipe | hidden for members |
| S2 | Agent card additions: skills chip (count, names in `title`); skill-block callout | chip recipe; `--severity-warning-*` callout | `skillBlock.reason` ∈ invalid/missing/targets/users → specific text. Admin action: Fix skill (invalid/missing) or Fix persona (targets/users). Member: "Szólj az adminisztrátornak". The card is **not** dimmed, because dimming already means "retired". |
| S3 | Skills panel list `SkillsPanel`: page head (back, title, subtitle, primary "Képesség hozzáadása"), column head (≥768 px), one card row per entry | card recipe; source chip `config` = `--tint-purple-*`, `managed` = `--tint-blue-*`; invalid row border + chip `--severity-warning-*` | populated · empty (dashed card + CTA) · invalid path (warning chip + consequence) · single-user ("Nem korlátozott") · usage line "N persona · M élő munkamenet". Name is a link to details. Managed rows have a ⋮ menu (Szerkesztés, Eltávolítás). Config rows show a lock with sr text. Below 768 px: stacked with visible cell labels. |
| S4 | Add skill `SkillForm` (new): Forrás radio cards (Telepített képesség / Útvonal megadása) → searchable radio picker, or path input | radio-card recipe; picker `--bg-secondary`, checked `--tint-blue-bg`; path line `--bg-code` | Save disabled until a pick. A skill already in the catalog is disabled ("Már a katalógusban"). A pick prefills name and path. Search filters. Path error inline plus error summary. |
| S5 | Edit / view `SkillForm` (existing): static path, users radio + check-list, targets radio + check-list, **impact preview** | `--severity-warning-*` callout `role=status` | The name is static (not an input). Changing users or targets shows the impact: live sessions that end, plus personas that become blocked, with lost targets and a count of other users' private personas. Save with live sessions opens a confirm dialog (focus on Cancel; Escape returns focus to Save). A config entry is read-only (info callout, no Save). An empty user or target list gives an error summary that receives focus. |
| S6 | Remove confirm (native `<dialog>`) | overlay `--bg-overlay`, destructive `--tint-red-*` | states persona count and live-session count; conversations are kept |
| S7 | Persona editor Skills fieldset | check-list recipe; reason line `--text-secondary` + lock icon; note `--severity-info-*` | An option that is not allowed in every ticked target is disabled, and its reason is linked with `aria-describedby`. A target change auto-unticks ineligible skills and shows an info note (announced); focus stays on the project checkbox. Empty catalog: admins see a hint with a link to the Skills panel; members see no field. |
| S8 | Conversation additions: header skill chips; blocked banner; composer pre-check | chip recipe; `--severity-error-*` banner and composer error | `409 skill_not_allowed` → reason-specific banner, history readable, composer disabled, admin fix action. `/skill:<other>` → not sent, text kept, `aria-invalid`, available skills listed. |

## Cited rules driving the design

- **Error prevention (H5).**
  - The editor disables and auto-unticks skills that are not allowed instead of failing on save (strict D5).
  - The impact preview names what a catalog edit will block before it is saved.
  - The composer refuses an unavailable `/skill:` before sending.
- **Visibility of system status (H1).**
  - Usage and live-session counts appear on every row.
  - Invalid paths are flagged in the list.
  - Blocked personas are visible on the card before the user clicks.
- **Help users recognise, diagnose, recover (H9).** Each block reason has its own text and its own route to the fix: a skill problem goes to Fix skill, a persona problem to Fix persona. Members get a next step ("ask your administrator").
- **Recognition over recall (H6).**
  - Installed skills are picked from a list, not typed.
  - Allowed targets show as "Csak itt: …".
  - The skill name links to its details.
- **User control (H3).** Confirmation that names the sessions that will end; Cancel is focused by default.
- **Consistency (H4, Jakob).** Same page, form, radio-card, check-list, menu and dialog recipes as the shipped team app. The form uses one column at most 40 rem wide, like the persona editor.
- **Color not the sole channel (WCAG 1.4.1).** Every warning and invalid state pairs an icon with text, and source is shown as a text chip.
- **Target size (WCAG 2.5.8).** At least 44 px at 375 px (probe check `target44:*`).
- **Reflow (WCAG 1.4.10).** No horizontal scroll at 375 px. List rows stack and show visible cell labels.
- **Focus management (WCAG 2.4.3).** The error summary receives focus. Focus returns to the opener after dialogs and menus, and stays on the project checkbox after an auto-untick.

## Findings fixed during the loop

1. Users and targets chips stretched to full column width; fixed with `align-items: flex-start`.
2. Config rows showed an ambiguous "🔒 …" control. The name is now the details link, and the row keeps only the lock.
3. In edit mode the read-only name looked like an editable input. It is now static.
4. A blocked card said "not allowed" when the real cause was an invalid path. **Spec gap:** the 409 response and the agent listing now carry `{skill, reason}` (team-skill-catalog "Skill state in agent listings", team-agent-sessions 409 body).
5. An invalid-path block sent the admin to the persona. Fixed: it now goes to the skill.
6. The composer pre-check and header chips need the effective skills on the client. **Spec gap:** `effectiveSkills` is now in the listing, and a new team-app requirement, "Skill availability feedback", covers it.
7. Contrast failures: the dimmed avatar on blocked cards (fixed by not dimming them) and the link inside the info callout (now inherits the callout colour and is underlined).
8. A probe bug: same-document hash navigation kept the theme state between runs, so the light pass could silently test dark. Fixed by loading `about:blank` first and asserting the theme.
