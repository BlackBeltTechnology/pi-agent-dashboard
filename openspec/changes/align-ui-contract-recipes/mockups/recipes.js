/* Recipe board data. AS-BUILT variants reproduce shipped classes verbatim as
   inline styles (raw literals there ARE the finding). PROPOSED states use only
   recipes.css classes (token-only). Line refs are to develop @ 2026-10-18. */
const ic = (n, cls = "") => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[n] || ""}"/></svg>`;
const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
let _id = 0; const nid = (p) => `${p}-${++_id}`;

/* ── proposed helpers (one per recipe) ── */
const PILL_IC = { success: "CheckCircleOutline", info: "InformationOutline", warning: "AlertOutline", error: "AlertCircleOutline", neutral: "CircleOutline" };
const pill = (tone, word, icon) => `<span class="r-pill ${tone}" data-state="${tone}">${ic(icon ?? PILL_IC[tone], icon === "Loading" ? "spin" : "")}<span>${word}</span></span>`;
const btn = (kind, label, icon = "", extra = "") => `<button class="p-btn ${kind}" ${extra}>${icon ? ic(icon) : ""}${label}</button>`;
function note(tone, { title, why, remedies = [], acts = "", detail = "" }) {
  const role = tone === "error" ? 'role="alert"' : 'role="status"';
  return `<div class="r-note ${tone}" ${role}>${ic(PILL_IC[tone])}<div class="b"><strong class="t">${title}</strong>${why ? `<p>${why}</p>` : ""}${
    remedies.length ? `<ul>${remedies.map(([i, t]) => `<li>${ic(i)}<span>${t}</span></li>`).join("")}</ul>` : ""}${
    acts ? `<div class="acts">${acts}</div>` : ""}${
    detail ? `<details class="r-details"><summary>${ic("ChevronRight")}Technical details</summary><pre>${esc(detail)}</pre><button class="p-btn ghost r-btn-sm">${ic("ContentCopy")}Copy details</button></details>` : ""}</div></div>`;
}
const errLine = (id, msg) => `<p class="r-err" id="${id}" role="alert">${ic("AlertCircleOutline")}<span>${msg}</span></p>`;

/* ── as-built helper: a labelled variant with verbatim inline styles ── */
const v = (src, note_, demo) => `<div class="variant"><div class="src"><code>${src}</code><span>${note_}</span></div><div class="demo">${demo}</div></div>`;
const RAW = { green400: "#4ade80", yellow400: "#facc15", red400: "#f87171", red600: "#dc2626", blue400: "#60a5fa", blue500: "#3b82f6", blue600: "#2563eb" };
const svgS = (n, px) => `<svg viewBox="0 0 24 24" width="${px}" height="${px}" aria-hidden="true" style="fill:currentColor;flex:none"><path d="${ICON[n]}"/></svg>`;

const RECIPES = [
/* ───────────────────────────── R1 ───────────────────────────── */
{ id: "pill", title: "Status pill", icon: "CheckCircleOutline", verdict: "consolidate",
  lead: "7 shipped implementations → 1. The plugin-facing `ui:status-pill` paints raw `rgba()` behind a dark/light switch, so non-base palettes get the wrong colours. One recipe: severity triple + icon + human word.",
  cites: [["WCAG 1.4.1 Use of Color", "https://www.w3.org/WAI/WCAG22/Understanding/use-of-color"], ["Nielsen #2 match the real world", "https://www.nngroup.com/articles/ten-usability-heuristics/"], ["Nielsen #4 consistency", "https://www.nngroup.com/articles/ten-usability-heuristics/"]],
  finds: [
    ["P1", "`client-utils/src/StatusPill.tsx:20-36` raw `rgba()`/`rgb()` palettes + `data-theme` switch; ignores `--severity-*` and 8 extra palettes. No border, `font-medium`."],
    ["P2", "`plugin-row-parts.tsx:44-74` 10 px text, `rounded` (not pill), no icon; idle state uses `--text-muted` (fails AA)."],
    ["P3", "`OpenSpecBoardView.tsx:185` 9 px bold uppercase — below the 11 px floor."],
    ["P4", "`ProviderHealthPill.tsx:79,96` bare `text-green-400` / `text-yellow-400` / `text-red-400` on the surface (light theme ≈ 1.5–2:1)."],
    ["P5", "`services-ui.tsx:14` and `vault-ui.tsx:64` already match the target recipe but are two copies with different padding (`px-2` vs `px-1.5`) and glyph vs MDI icon."],
  ],
  asbuilt: () => [
    v("client-utils/StatusPill.tsx (ui:status-pill)", "raw rgba, no border",
      [["running", "rgba(34,197,94,.15)", "rgb(134,239,172)", "Running"], ["warn", "rgba(234,179,8,.15)", "rgb(253,224,71)", "Waiting"], ["error", "rgba(239,68,68,.15)", "rgb(252,165,165)", "Failed"], ["muted", "rgba(107,114,128,.2)", "rgb(209,213,219)", "Idle"]]
        .map(([, bg, fg, t]) => `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:500;background:${bg};color:${fg}">${t}</span>`).join("")),
    v("packages/plugin-row-parts.tsx:44-74", "10 px, rounded, no icon",
      `<span style="padding:2px 6px;font-size:10px;border-radius:4px;background:var(--bg-tertiary);color:var(--text-tertiary);border:1px solid var(--border-secondary)">disabled</span>
       <span style="padding:2px 6px;font-size:10px;border-radius:4px;background:var(--bg-tertiary);color:var(--text-muted);border:1px solid var(--border-secondary)">not loaded</span>
       <span style="padding:2px 6px;font-size:10px;border-radius:4px;background:var(--severity-warning-bg);color:var(--severity-warning-fg);border:1px solid var(--severity-warning-border)">waiting_peers</span>
       <span style="padding:2px 6px;font-size:10px;border-radius:4px;background:var(--severity-success-bg);color:var(--severity-success-fg);border:1px solid var(--severity-success-border)">enabled</span>`),
    v("openspec/OpenSpecBoardView.tsx:185", "9 px bold uppercase",
      `<span style="display:inline-flex;gap:2px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:1px 6px;border-radius:999px;background:var(--severity-info-bg);color:var(--severity-info-fg)">implementing</span>
       <span style="display:inline-flex;gap:2px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:1px 6px;border-radius:999px;background:var(--severity-success-bg);color:var(--severity-success-fg)">done</span>`),
    v("settings/ProviderHealthPill.tsx:79-96", "bare raw palette text",
      `<span style="display:flex;align-items:center;gap:6px;font-size:12px;color:${RAW.green400}">${svgS("CheckCircleOutline", 12)}Connected</span>
       <span style="display:flex;align-items:center;gap:6px;font-size:12px;color:${RAW.yellow400}">${svgS("AlertOutline", 12)}Rate limited</span>
       <span style="display:flex;align-items:center;gap:6px;font-size:12px;color:${RAW.red400}">${svgS("AlertCircleOutline", 12)}Auth failed</span>`),
    v("settings/services/services-ui.tsx:14 (StatePill)", "on-recipe, glyph, px-2",
      [["success", "●", "Healthy"], ["info", "◐", "Starting"], ["warning", "◆", "Not responding"], ["error", "▲", "Failed"], ["neutral", "□", "Stopped"]]
        .map(([t, g, w]) => `<span style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--severity-${t}-border);border-radius:999px;padding:2px 8px;font-size:12px;font-weight:600;background:var(--severity-${t}-bg);color:var(--severity-${t}-fg)"><span aria-hidden="true">${g}</span>${w}</span>`).join("")),
    v("settings/vault/vault-ui.tsx:64 (StatusPill)", "on-recipe, MDI icon, px-1.5",
      [["success", "CheckCircleOutline", "Granted"], ["warning", "AlertOutline", "Expires soon"], ["error", "AlertCircleOutline", "Revoked"]]
        .map(([t, i, w]) => `<span style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--severity-${t}-border);border-radius:999px;padding:2px 6px;font-size:12px;font-weight:600;background:var(--severity-${t}-bg);color:var(--severity-${t}-fg)">${svgS(i, 12)}${w}</span>`).join("")),
  ],
  proposed: () => [
    ["Five tones · icon + word", `<div class="flex-wrap">${pill("success", "Healthy")}${pill("info", "Starting", "Loading")}${pill("warning", "Not responding")}${pill("error", "Failed")}${pill("neutral", "Stopped")}</div>`],
    ["ui:status-pill state mapping (props unchanged)", `<div class="flex-wrap">${pill("info", "Running", "Loading")}${pill("success", "Done")}${pill("info", "Queued", "ProgressClock")}${pill("warning", "Waiting for peers")}${pill("error", "Auth failed")}${pill("neutral", "Idle")}</div>
      <p class="p-help" style="margin-top:8px">running→info + spinning <code>Loading</code> · warn→warning · muted→neutral. Raw code stays in <code>data-state</code>, never as the visible word.</p>`],
    ["Healthy is silent where a list is mostly healthy", `<div class="r-card"><div class="flex-wrap"><span class="name">Anthropic</span></div><div class="flex-wrap"><span class="name">OpenAI</span>${pill("warning", "Rate limited")}</div><div class="flex-wrap"><span class="name">Gemini</span>${pill("error", "Auth failed")}</div></div>`, true],
  ],
  row: `| status pill | \`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap\` + \`--severity-X-{bg,fg,border}\` (X = success · info · warning · error · neutral); 14 px icon \`aria-hidden\` + a human word (never a raw enum — the code goes in \`data-state\`); \`info\` + spinning \`Loading\` for in-progress; in a mostly-healthy list, healthy renders nothing. One implementation: \`ui:status-pill\` (\`client-utils\`) — services \`StatePill\`, vault \`StatusPill\`, \`ProviderHealthPill\`, \`plugin-row-parts\`, \`BoardStatePill\` and the plugin kit \`SettingsStatusPill\` render through it. See change: align-ui-contract-recipes |` },

/* ───────────────────────────── R2 ───────────────────────────── */
{ id: "notice", title: "Notice / callout", icon: "InformationOutline", verdict: "consolidate",
  lead: "3 callouts with different text sizes and anatomy, plus a raw `<pre>` error box in the plugin list. One anatomy: icon · title · why · remedies · actions · raw detail behind a disclosure.",
  cites: [["NN/g error-message guidelines", "https://www.nngroup.com/articles/error-message-guidelines/"], ["GOV.UK notification banner", "https://design-system.service.gov.uk/components/notification-banner/"], ["Nielsen #9 recover from errors", "https://www.nngroup.com/articles/ten-usability-heuristics/"]],
  finds: [
    ["N1", "`vault-ui.tsx:160` `Callout` is `text-xs`; `OperateRequiredCallout.tsx:56` is `text-sm` + `max-w-[72ch]` — same role, two sizes."],
    ["N2", "`plugin-row-parts.tsx:84-101` load error is a raw `<pre>` at 11 px mono with a 10 px Copy button; no sentence, no retry."],
    ["N3", "No shared role rule: some error callouts are `role=alert`, some none."],
  ],
  asbuilt: () => [
    v("settings/vault/vault-ui.tsx:160 (Callout)", "text-xs",
      `<div style="display:flex;align-items:flex-start;gap:8px;border-radius:6px;border:1px solid var(--severity-warning-border);padding:12px;font-size:12px;background:var(--severity-warning-bg);color:var(--severity-warning-fg)">${svgS("AlertOutline", 14)}<div>The vault server is older than this page. Some actions are unavailable until it restarts.</div></div>`),
    v("settings/vault/OperateRequiredCallout.tsx:56", "text-sm, max 72ch",
      `<div style="display:flex;gap:8px;border-radius:6px;border:1px solid var(--severity-info-border);padding:12px;font-size:14px;max-width:72ch;background:var(--severity-info-bg);color:var(--severity-info-fg)">${svgS("LockOutline", 16)}<div><strong style="display:block">This device can't open the vault</strong><p style="margin:4px 0 0">It is paired with less than Operate access.</p></div></div>`),
    v("packages/plugin-row-parts.tsx:84-101", "raw pre, 11 px, 10 px button",
      `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-radius:4px;font-size:12px;background:var(--severity-error-bg);color:var(--severity-error-fg);border:1px solid var(--severity-error-border);width:100%">${svgS("AlertOutline", 14)}<pre style="flex:1;margin:0;white-space:pre-wrap;overflow-wrap:break-word;min-width:0;font:11px/1.3 ui-monospace,monospace">Error: Cannot find module '@x/plugin/dist/client.js'
    at resolve (node:internal/modules/esm/resolve:264)</pre><span style="display:inline-flex;gap:4px;padding:2px 6px;border-radius:4px;font-size:10px;border:1px solid var(--severity-error-border)">${svgS("ContentCopy", 10)}Copy</span></div>`),
  ],
  proposed: () => [
    ["error · sentence + retry + raw detail", note("error", { title: "The Gmail plugin didn't load", why: "Its client bundle is missing. Reinstalling the plugin usually fixes this.", acts: btn("secondary", "Try again", "Refresh") + btn("ghost", "Reinstall", "Download"), detail: "Error: Cannot find module '@x/plugin/dist/client.js'\n    at resolve (node:internal/modules/esm/resolve:264)" })],
    ["info · remedies list (operate-required)", note("info", { title: "This device can't change services", why: "It is paired with less than Operate access.", remedies: [["Monitor", "Open the dashboard on the computer that runs it."], ["CellphoneKey", "On the host, revoke this device in Paired devices, then pair it again with Operate access."], ["Login", "<a class=\"p-link\" href=\"#\">Sign in with an operator account</a>"]] })],
    ["warning · one action", note("warning", { title: "Restart needed", why: "The vault server is older than this page. Some actions stay unavailable until it restarts.", acts: btn("secondary", "Restart server", "Restart") })],
    ["success · transient confirmation", note("success", { title: "Imported 4 keys", why: "They are available to every project you grant." })],
  ],
  row: `| notice | \`flex items-start gap-2 rounded-md border p-3 text-sm max-w-[72ch]\` + \`--severity-X-{bg,fg,border}\`; 16 px icon → body: title (\`font-semibold\`, one line, says what happened) → why (one sentence, plain words) → optional remedy rows (icon + sentence) → optional actions (secondary "Try again" first, never a second primary) → optional \`<details>\` "Technical details" holding the raw error in \`--bg-code\` mono 12 px + ghost "Copy details". \`role="alert"\` for error, \`role="status"\` otherwise. Raw error text never renders outside the disclosure. See change: align-ui-contract-recipes |` },

/* ───────────────────────────── R3 ───────────────────────────── */
{ id: "inlineerr", title: "Inline action error", icon: "AlertCircleOutline", verdict: "consolidate",
  lead: "An action that fails reports beside its control, not as a toast. Two shipped copies (`ActionFailure`, `ErrorLine`) differ only in the code chip. One recipe, reusing the settings-field error line.",
  cites: [["WCAG 3.3.1 Error identification", "https://www.w3.org/WAI/WCAG22/Understanding/error-identification"], ["NN/g error proximity", "https://www.nngroup.com/articles/error-message-guidelines/"], ["Gestalt proximity", "https://lawsofux.com/law-of-proximity/"]],
  finds: [
    ["E1", "`services-ui.tsx:96` `ActionFailure` prints the server code as a bold mono chip before the sentence (\"`operate_required` …\") — a raw code in the visible message."],
    ["E2", "`vault-ui.tsx:167` `ErrorLine` has no Copy-details path; a long server message wraps unbounded."],
  ],
  asbuilt: () => [
    v("settings/services/services-ui.tsx:96 (ActionFailure)", "raw code first",
      `<div><button style="min-height:32px;padding:0 10px;border-radius:6px;border:1px solid var(--border-secondary);background:var(--bg-tertiary);color:var(--text-primary);font-size:12px;font-weight:600">Stop</button><p role="alert" style="margin:4px 0 0;display:flex;gap:4px;font-size:12px;color:var(--severity-error-fg)">${svgS("AlertCircleOutline", 12)}<span><code style="font-family:ui-monospace,monospace;font-weight:600;margin-right:4px">stop_failed</code>docker stop exited with 1: Error response from daemon: cannot stop container 3f9a…: permission denied</span></p></div>`),
    v("settings/vault/vault-ui.tsx:167 (ErrorLine)", "no detail path",
      `<div><input value="sk-…" style="min-height:36px;border-radius:4px;border:1px solid var(--severity-error-border);background:var(--bg-tertiary);color:var(--text-primary);padding:0 12px;font-size:14px"><p role="alert" style="margin:4px 0 0;display:flex;gap:4px;font-size:12px;color:var(--severity-error-fg)">${svgS("AlertCircleOutline", 12)}That key was rejected by the provider.</p></div>`),
  ],
  proposed: () => {
    const a = nid("e"), b = nid("e");
    return [
      ["Button action failed · sentence + Copy details", `<div><button class="p-btn secondary" aria-describedby="${a}">${ic("Stop")}Stop</button>${errLine(a, "Couldn't stop the service — the container runtime refused. <button class=\"p-btn ghost r-btn-sm copy\">" + ic("ContentCopy") + "Copy details</button>")}</div>`, true],
      ["Field action failed", `<div><label class="p-label" for="k1">API key</label><input id="k1" class="p-input" value="sk-…" aria-invalid="true" aria-describedby="${b}" style="width:100%">${errLine(b, "The provider rejected this key. Check it was copied in full.")}</div>`, true],
      ["Item-scoped (one of many rows fails)", `<div class="r-card"><div class="flex-wrap"><span class="name" style="flex:1">work-profile</span>${pill("error", "Connect failed")}<button class="p-btn secondary r-btn-sm">${ic("Refresh")}Try again</button></div>${errLine(nid("e"), "Chrome closed the debugging pipe. <button class=\"p-btn ghost r-btn-sm copy\">" + ic("ContentCopy") + "Copy details</button>")}</div>`, true],
    ];
  },
  row: `| inline action error | \`<p role="alert">\` \`mt-1 flex items-start gap-1 text-xs text-[var(--severity-error-fg)]\` + 14 px \`AlertCircleOutline\`, directly under the control or row that failed, linked by \`aria-describedby\`; one plain sentence (what failed + what to try) — server codes and raw text only via a ghost "Copy details"; never a toast for a failure the user can act on in place. Same anatomy as the settings-field error line. See change: align-ui-contract-recipes |` },

/* ───────────────────────────── R4 ───────────────────────────── */
{ id: "tabs", title: "Tabs & filter chips", icon: "TabUnselected", verdict: "new row",
  lead: "5 tab styles ship. Two of them are really filters (a toggled set, not panels). Split: APG tablist for panels (vault style), `aria-pressed` chips for filters.",
  cites: [["APG Tabs pattern", "https://www.w3.org/WAI/ARIA/apg/patterns/tabs/"], ["WCAG 1.4.11 Non-text contrast", "https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast"], ["WCAG 2.5.8 Target size", "https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum"]],
  finds: [
    ["T1", "`UnifiedPackagesSection.tsx` tabs `text-xs py-1.5`, no min height (≈ 28 px target)."],
    ["T2", "`ResourceCardGrid.tsx` and `OpenSpecBoardView.tsx:664` pill tabs/filters, 10–12 px; active filter `text-blue-400` raw."],
    ["T3", "`mcp-client-plugin/ServerEditor.tsx:68-70` tabs as 11 px outline buttons; active = `--accent-primary` text with `#60a5fa` fallback (text on accent fails AA in light)."],
    ["T4", "`VaultSection.tsx` is APG-correct and on tokens — the reference. `SkillAtlasPage.tsx` is close (12 px)."],
  ],
  asbuilt: () => [
    v("packages/UnifiedPackagesSection.tsx", "text-xs, ≈28 px",
      `<div style="display:flex;border-bottom:1px solid var(--border-secondary)">${["Installed", "Updates", "Discover"].map((t, i) => `<span style="font-size:12px;padding:6px 12px;margin-bottom:-1px;border-bottom:2px solid ${i ? "transparent" : "var(--accent-primary)"};color:${i ? "var(--text-secondary)" : "var(--text-primary)"}">${t}</span>`).join("")}</div>`),
    v("resource/ResourceCardGrid.tsx", "pill tabs, 12 px",
      ["All", "Skills", "Prompts", "Extensions"].map((t, i) => `<span style="padding:4px 10px;font-size:12px;border-radius:6px;${i === 1 ? "background:var(--bg-tertiary);color:var(--text-primary)" : "color:var(--text-secondary)"}">${t}</span>`).join("")),
    v("mcp-client-plugin/ServerEditor.tsx:68", "11 px outline + accent text",
      ["Form", "JSON"].map((t, i) => `<span style="font-size:11px;padding:4px 8px;border-radius:4px;border:1px solid ${i ? "var(--border-secondary)" : `var(--accent-primary,${RAW.blue400})`};color:${i ? "var(--text-secondary)" : `var(--accent-primary,${RAW.blue400})`}">${t}</span>`).join("")),
    v("openspec/OpenSpecBoardView.tsx:664 (FilterPill)", "10 px, raw blue",
      ["Active", "Archived", "Mine"].map((t, i) => `<span style="font-size:10px;padding:3px 10px;border-radius:999px;border:1px solid ${i ? "var(--border-secondary)" : "rgba(59,130,246,.5)"};color:${i ? "var(--text-tertiary)" : RAW.blue400};background:${i ? "transparent" : "rgba(59,130,246,.08)"}">${t}</span>`).join("")),
    v("settings/vault/VaultSection.tsx (reference)", "APG, tokens, 36/44 px",
      `<div style="display:flex;gap:4px;border-bottom:1px solid var(--border-secondary)">${["Variables", "Accounts", "Import"].map((t, i) => `<span style="display:inline-flex;align-items:center;min-height:36px;padding:0 12px;margin-bottom:-1px;font-size:14px;font-weight:600;border-bottom:2px solid ${i ? "transparent" : "var(--accent-primary)"};color:${i ? "var(--text-secondary)" : "var(--text-primary)"}">${t}</span>`).join("")}</div>`),
  ],
  proposed: () => [
    ["Page tabs (panels) · URL ?tab=", `<div class="r-tabs" role="tablist" aria-label="Add-ons">${[["Installed", "PackageVariantClosed", "12"], ["Updates", "Download", "3"], ["Discover", "EyeOutline", ""]].map(([t, i, n], k) => `<button class="r-tab" role="tab" aria-selected="${!k}" tabindex="${k ? -1 : 0}">${ic(i)}${t}${n ? `<span class="r-pill ${k === 1 ? "info" : "neutral"}" style="padding:0 6px">${n}</span>` : ""}</button>`).join("")}</div><div class="r-tabpanel" role="tabpanel">Panels stay mounted; inactive panels are <code>hidden</code> so a half-typed form survives a switch.</div>`],
    ["In-component tabs (editor Form / JSON)", `<div class="r-tabs" role="tablist" aria-label="Editor mode">${["Form", "JSON"].map((t, k) => `<button class="r-tab" role="tab" aria-selected="${!k}">${t}</button>`).join("")}</div>`],
    ["Filter chips (not tabs) · aria-pressed + check", `<div class="r-chips" role="group" aria-label="Filter changes">${[["Active", true], ["Archived", false], ["Mine", true]].map(([t, on]) => `<button class="r-chip" aria-pressed="${on}">${on ? ic("Check") : ""}${t}</button>`).join("")}</div>`],
  ],
  row: `| tabs | panels: APG tablist — list \`flex flex-wrap gap-1 border-b border-[var(--border-secondary)]\`; tab \`focus-ring -mb-px inline-flex items-center gap-1.5 min-h-[36px] max-sm:min-h-[44px] px-3 border-b-2 text-sm font-semibold\`, selected \`border-[var(--accent-primary)] text-[var(--text-primary)]\`, else \`border-transparent text-[var(--text-secondary)]\`; arrow keys move, panels stay mounted (\`hidden\`); page-level tabs mirror \`?tab=\`. Counts ride as an inline status pill. See change: align-ui-contract-recipes |
| filter chip | a toggled filter is NOT a tab: \`<button aria-pressed>\` \`inline-flex items-center gap-1 rounded-full border px-2.5 min-h-[32px] max-sm:min-h-[44px] text-xs font-semibold\`; off \`bg-[var(--bg-tertiary)] border-[var(--border-secondary)] text-[var(--text-secondary)]\`, on \`--severity-info-{bg,fg,border}\` + a \`Check\` icon (shape, not colour alone). See change: align-ui-contract-recipes |` },

/* ───────────────────────────── R5 ───────────────────────────── */
{ id: "menu", title: "Menu / flyout", icon: "DotsVertical", verdict: "new row",
  lead: "The session actions flyout settled the model (groups, NEXT first, `More…` folding). Its headings are 10 px and plugin items are `--text-tertiary` at 30 px — fix those and write it down so folder menus, plugin menus and wave 3 share it.",
  cites: [["APG Menu pattern", "https://www.w3.org/WAI/ARIA/apg/patterns/menubar/"], ["Hick's law (fold rare items)", "https://lawsofux.com/hicks-law/"], ["Fitts's law (target size)", "https://lawsofux.com/fittss-law/"], ["Von Restorff (one emphasised NEXT)", "https://lawsofux.com/von-restorff-effect/"]],
  finds: [
    ["M1", "`SessionActionsPanel.tsx:263` group heading `text-[10px] uppercase` — below the 11 px floor."],
    ["M2", "`SessionActionsPanel.tsx:27` `ITEM_BASE` `min-h-[30px]` — below the contract's 36 px desktop / 44 px touch."],
    ["M3", "Plugin-group items paint `--text-tertiary` (sub-AA on `--bg-secondary` in several palettes)."],
    ["M4", "Disabled reason renders as a 10 px `--text-tertiary` trailing span (`SessionActionsPanel.tsx:340`) — below the floor and truncated at 320 px."],
  ],
  asbuilt: () => [
    v("session/SessionActionsPanel.tsx", "10 px heading, 30 px items",
      `<div style="min-width:220px;max-width:320px;border-radius:8px;border:1px solid var(--border-secondary);background:var(--bg-secondary);padding-bottom:4px;box-shadow:0 10px 15px rgba(0,0,0,.3)">
        <div style="display:flex;gap:8px;padding:4px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-secondary)">Next</div>
        <div style="display:flex;align-items:center;gap:8px;min-height:30px;padding:6px 12px;font-size:14px;color:var(--text-primary)">${svgS("SourceMerge", 14)}Merge</div>
        <div style="display:flex;gap:8px;padding:4px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-secondary)">Session <span style="text-transform:none;letter-spacing:0;color:var(--text-tertiary)">fix-login</span></div>
        <div style="display:flex;align-items:center;gap:8px;min-height:30px;padding:6px 12px;font-size:14px;color:var(--text-primary)">${svgS("PencilOutline", 14)}Rename</div>
        <div style="display:flex;gap:8px;padding:4px 12px;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text-secondary)">Plugins</div>
        <div style="display:flex;align-items:center;gap:8px;min-height:30px;padding:6px 12px;font-size:14px;color:var(--text-tertiary)">${svgS("Play", 14)}Run flow…</div></div>`),
  ],
  proposed: () => [
    ["Grouped menu · NEXT first · More… fold · visible disabled reason", `<div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap"><button class="r-trigger" aria-haspopup="menu" aria-expanded="true" aria-label="Session actions">${ic("DotsVertical")}</button>
      <div class="r-menu" role="menu" aria-label="Session actions">
        <div role="group" aria-label="Next"><div class="r-mh" aria-hidden="true">Next</div>
          <button class="r-mi next" role="menuitem">${ic("SourceMerge")}<span class="lbl">Merge into develop</span>${pill("info", "Next", "ArrowUp")}</button></div>
        <div role="group" aria-label="Session"><div class="r-mh" aria-hidden="true">Session <span class="sub">fix-login</span></div>
          <button class="r-mi" role="menuitem">${ic("PencilOutline")}<span class="lbl">Rename</span></button>
          <button class="r-mi" role="menuitem">${ic("Plus")}<span class="lbl">New session here</span></button>
          <button class="r-mi" role="menuitem" aria-disabled="true">${ic("SourceBranch")}<span class="lbl">New worktree<span class="why">Commit or stash changes first</span></span></button></div>
        <div role="group" aria-label="OpenSpec"><div class="r-mh" aria-hidden="true">OpenSpec</div>
          <button class="r-mi" role="menuitem">${ic("FileDocumentOutline")}<span class="lbl">Open change</span></button>
          <button class="r-mi" role="menuitem" aria-haspopup="true">${ic("DotsVertical")}<span class="lbl">More…</span><span class="kbd">2</span>${ic("ChevronRight")}</button></div>
        <div role="group" aria-label="Plugins"><div class="r-mh" aria-hidden="true">Plugins</div>
          <button class="r-mi" role="menuitem">${ic("Play")}<span class="lbl">Run flow…</span></button></div>
        <div class="r-msep" role="separator"></div>
        <button class="r-mi danger" role="menuitem">${ic("Close")}<span class="lbl">Exit session</span></button>
      </div></div>`],
  ],
  row: `| menu / flyout | panel \`min-w-[220px] max-w-[320px] max-h-[min(70vh,560px)] overflow-y-auto rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)]\` + raised elevation, \`role="menu"\`; group heading = capsule-legend step (\`sticky text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]\`, optional normal-case subtitle); item \`role="menuitem"\` \`flex items-center gap-2 min-h-[36px] max-sm:min-h-[44px] px-3 text-sm text-[var(--text-primary)]\` + 16 px \`--text-secondary\` icon; disabled = \`aria-disabled\` + a visible 12 px \`--text-secondary\` reason on its own line (never tooltip-only, never a truncated trailing span); at most one emphasised NEXT item (\`font-semibold\` + info pill); a group with ≥ 2 rare items folds them under \`More…\`; destructive items last, after a separator, \`--tint-red-fg\`. Trigger 44/36 px. See change: align-ui-contract-recipes |` },

/* ───────────────────────────── R6 ───────────────────────────── */
{ id: "dialog", title: "Dialog", icon: "DockWindow", verdict: "consolidate",
  lead: "The shared `Dialog` primitive is the only thing every plugin dialog can use, and it is off-contract: raw scrim, page-coloured panel, 26 px action buttons, white on `--accent-primary` (3.68:1), raw `bg-red-600`. Vault and services already settled the better anatomy.",
  cites: [["APG Dialog (Modal)", "https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/"], ["APG Alert dialog", "https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/"], ["NN/g confirmation dialogs", "https://www.nngroup.com/articles/confirmation-dialog/"], ["WCAG 1.4.3 Contrast", "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum"]],
  finds: [
    ["D1", "`client-utils/Dialog.tsx:112` scrim `bg-black/60` — not `--bg-overlay` (light theme wants 0.3)."],
    ["D2", "`Dialog.tsx:124` panel `bg-[var(--bg-primary)] rounded-lg border-[var(--border-primary)]` — not the card recipe; title `text-base` (contract: `text-lg`)."],
    ["D3", "`Dialog.tsx:193-197` primary = white on `--accent-primary` (3.68:1, fails AA); danger = raw `bg-red-600`; actions `text-xs py-1.5` ≈ 26 px; close button 28 px."],
    ["D4", "Hand-built overlays bypass the primitive: goal `CreateGoalDialog`, mcp `ServerEditor` + `ProjectSettings`, system-one `ConfirmDialog` (wave 3)."],
    ["D5", "`add-pi-spec-driven-schema` already moves primary to `--accent-solid` in its `dialog-system` delta — this row adopts that, it does not compete."],
  ],
  asbuilt: () => [
    v("client-utils/Dialog.tsx (ui:dialog)", "raw scrim, 26 px actions, 3.68:1 primary",
      `<div style="background:rgba(0,0,0,.6);padding:24px 12px;border-radius:8px;width:100%;display:flex;justify-content:center"><div style="width:100%;max-width:440px;background:var(--bg-primary);border:1px solid var(--border-primary);border-radius:8px;padding:20px;display:grid;gap:16px;position:relative">
        <span style="position:absolute;top:12px;right:12px;width:28px;height:28px;display:grid;place-items:center;color:var(--text-secondary)">${svgS("Close", 16)}</span>
        <div style="display:flex;gap:12px;align-items:center;padding-right:32px"><span style="width:36px;height:36px;border-radius:6px;display:grid;place-items:center;background:rgba(59,130,246,.15);color:var(--accent-primary)">${svgS("SourceBranch", 18)}</span><span style="font-size:16px;font-weight:600;color:var(--text-primary)">Create worktree</span></div>
        <div style="font-size:14px;color:var(--text-secondary)">A new worktree is created next to the repository.</div>
        <div style="display:flex;justify-content:flex-end;gap:8px"><span style="font-size:12px;padding:6px 12px;border-radius:4px;border:1px solid var(--border-primary);color:var(--text-secondary)">Cancel</span><span style="font-size:12px;padding:6px 12px;border-radius:4px;background:var(--accent-primary);color:#fff">Create</span><span style="font-size:12px;padding:6px 12px;border-radius:4px;background:${RAW.red600};color:#fff">Delete</span></div></div></div>`),
  ],
  proposed: () => [
    ["Standard · one primary", `<div class="r-scrim"><div class="r-dlg" role="dialog" aria-modal="true" aria-labelledby="dl1"><header><span class="tile">${ic("SourceBranch")}</span><h3 id="dl1">Create worktree</h3><button class="r-iconbtn" aria-label="Close">${ic("Close")}</button></header>
      <div class="body"><p style="margin:0">A new worktree is created next to the repository on a fresh branch.</p><div><label class="p-label" for="br1">Branch name</label><input id="br1" class="p-input" value="feat/login-retry" style="width:100%"></div></div>
      <footer>${btn("secondary", "Cancel")}${btn("primary", "Create worktree")}</footer></div></div>`],
    ["Confirm impact · alertdialog · Cancel focused · impact read on open", `<div class="r-scrim"><div class="r-dlg" role="alertdialog" aria-modal="true" aria-labelledby="dl2" aria-describedby="dl2b"><header><span class="tile danger">${ic("KeyOutline")}</span><h3 id="dl2">Revoke the OpenAI account?</h3></header>
      <div class="body" id="dl2b"><p style="margin:0">These stop working right away:</p><ul><li><strong>3 projects</strong> lose <code>OPENAI_API_KEY</code></li><li><strong>1 running session</strong> keeps its key until it restarts</li></ul></div>
      <footer>${btn("secondary", "Cancel", "", "autofocus")}${btn("danger", "Revoke account", "DeleteOutline")}</footer></div></div>`],
    ["Destructive · names every item · risky option unchecked", `<div class="r-scrim"><div class="r-dlg" role="alertdialog" aria-modal="true" aria-labelledby="dl3"><header><span class="tile danger">${ic("DeleteOutline")}</span><h3 id="dl3">Remove the postgres service?</h3></header>
      <div class="body"><p style="margin:0">The container <code>pi-svc-postgres</code> is stopped and removed.</p>
      <label class="r-check"><input type="checkbox"><span>Also delete data volumes<span class="p-help" style="display:block"><code>pgdata</code> · <code>pgwal</code> — this cannot be undone</span></span></label>
      ${note("warning", { title: "Kept: pgshared", why: "Another service also uses this volume." })}</div>
      <footer>${btn("secondary", "Cancel", "", "autofocus")}${btn("danger", "Remove service", "DeleteOutline")}</footer></div></div>`],
  ],
  row: `| dialog | scrim \`bg-[var(--bg-overlay)]\`; panel = card recipe (\`rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)]\` + raised elevation) \`p-5 grid gap-4 max-w-*\`; header: optional 36 px tone tile (severity triple) + title \`text-lg font-semibold\` + 44/36 px close icon button; footer right-aligned: secondary Cancel, then exactly one action — primary (contract primary button, \`--accent-solid\`) or danger (\`--tint-red-{bg,fg,border}\`, \`font-semibold\`); all actions use the contract button heights. Destructive confirms are \`role="alertdialog"\` with Cancel focused, the impact read fresh on open, every affected item named, and any extra-destructive option an unchecked checkbox that names what it deletes. Implemented once in \`client-utils/Dialog.tsx\` (\`ui:dialog\`, \`ui:confirm-dialog\`). See change: align-ui-contract-recipes; aligns with add-pi-spec-driven-schema |` },

/* ───────────────────────────── R7 ───────────────────────────── */
{ id: "states", title: "Loading · empty · first-run", icon: "ProgressClock", verdict: "new row",
  lead: "Vault settled all three states; nothing in the contract says so, so plugin pages spin a bare `Loading…` or render an empty box.",
  cites: [["NN/g skeleton screens", "https://www.nngroup.com/articles/skeleton-screens/"], ["NN/g empty states", "https://www.nngroup.com/articles/empty-state-interface-design/"], ["Nielsen #1 visibility of system status", "https://www.nngroup.com/articles/ten-usability-heuristics/"], ["WCAG 2.3.3 Animation from interactions", "https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions"]],
  finds: [
    ["S1", "`VaultSection.tsx:270` skeleton (`animate-pulse` + `motion-reduce:animate-none`) and `:81` first-run inset with one primary — the reference."],
    ["S2", "Plugin pages (goals board, automation board, skill atlas, KB) each roll their own loading text / empty copy (wave 3 audit)."],
  ],
  asbuilt: () => [
    v("settings/vault/VaultSection.tsx:81,270 (reference)", "skeleton + first-run",
      `<div style="display:grid;gap:8px;width:100%"><div style="height:40px;border-radius:6px;background:var(--bg-tertiary)"></div><div style="height:96px;border-radius:6px;background:var(--bg-tertiary)"></div></div>`),
    v("typical plugin page", "bare text",
      `<span style="font-size:12px;color:var(--text-tertiary)">Loading…</span><span style="font-size:12px;color:var(--text-muted)">No goals.</span>`),
  ],
  proposed: () => [
    ["Loading · skeleton shaped like the content", `<div aria-busy="true" style="display:grid;gap:8px"><span class="sr-only" role="status">Loading goals…</span><div class="r-skel" style="height:40px"></div><div class="r-skel" style="height:40px;width:85%"></div><div class="r-skel" style="height:40px;width:70%"></div></div>`],
    ["Empty (filtered) · say why + how to widen", `<div class="r-empty"><span class="t">${ic("FilterVariant")}No archived goals match "login"</span><p>Try a shorter search, or show active goals too.</p><div class="acts">${btn("secondary", "Clear search")}</div></div>`],
    ["First run · what it is + one primary", `<div class="r-empty"><span class="t">${ic("FlagOutline")}No goals in this folder yet</span><p>A goal keeps an agent working toward one outcome across sessions, with a budget you set.</p><div class="acts">${btn("primary", "Create a goal", "Plus")}${btn("ghost", "How goals work", "OpenInNew")}</div></div>`],
    ["Load failed · notice recipe, not an empty state", note("error", { title: "Goals didn't load", why: "The server didn't answer in time.", acts: btn("secondary", "Try again", "Refresh"), detail: "GET /api/plugins/goal/goals → 504 Gateway Timeout" })],
  ],
  row: `| loading / empty / first-run | loading: \`aria-busy\` container + \`sr-only\` \`role="status"\` label + skeleton blocks shaped like the content (\`rounded-md bg-[var(--bg-tertiary)] animate-pulse motion-reduce:animate-none\`), never a bare "Loading…"; empty: inset panel (\`rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] p-4\`) with a \`text-sm font-semibold\` title saying what is empty and why, one sentence on how to change it, at most one secondary action; first-run: same panel, title + one sentence on what the thing is + exactly one primary action; a load failure is a notice (error), never an empty state. See change: align-ui-contract-recipes |` },

/* ───────────────────────────── R8 ───────────────────────────── */
{ id: "overflow", title: "Row overflow", icon: "ArrowExpandHorizontal", verdict: "new row",
  lead: "compact-session-card-header settled wrap-then-truncate. Rows with a name plus trailing pills elsewhere still `nowrap` and push the pill out of the card at 260–340 px.",
  cites: [["Nielsen #8 minimalist design (truncate, keep title)", "https://www.nngroup.com/articles/ten-usability-heuristics/"], ["WCAG 1.4.10 Reflow", "https://www.w3.org/WAI/WCAG22/Understanding/reflow"]],
  finds: [["O1", "Pattern lives only in `SessionCard.tsx` (git + meta rows); plugin rows (goal chips, automation rows, MCP server list) use `nowrap` + `truncate` without a basis, so pills clip."]],
  asbuilt: () => [
    v("typical plugin row (nowrap)", "pill pushed out at 260 px",
      `<div style="width:260px;border-radius:12px;border:1px solid var(--border-secondary);background:var(--bg-secondary);padding:10px 12px;overflow:hidden"><div style="display:flex;gap:6px;align-items:center;white-space:nowrap;font-size:12px"><span style="font-family:ui-monospace,monospace;color:var(--text-primary)">feature/very-long-branch-name-for-login-retry</span><span class="r-pill warning">3 uncommitted</span><span class="r-pill neutral">#412</span></div></div>`),
  ],
  proposed: () => [260, 340].map((w) => [`${w} px · wrap first, then truncate at 6ch`, `<div class="r-card" style="width:${w}px;max-width:100%"><div class="r-row"><span class="grow6" title="feature/very-long-branch-name-for-login-retry">feature/very-long-branch-name-for-login-retry</span>${pill("warning", "3 uncommitted")}${pill("neutral", "#412", "SourcePull")}</div><div class="r-row"><span class="grow6" title="anthropic/claude-sonnet-4-5">claude-sonnet-4-5</span><span>· high</span></div></div>`]),
  row: `| row overflow | a row of one primary text + trailing chips is \`flex flex-wrap items-center gap-x-1.5 gap-y-1\`; the primary text \`grow basis-[6ch] min-w-0 truncate\` with the full value in \`title\`; chips \`flex-shrink-0\`; the row itself carries \`min-w-0\` when its parent is a grid or flex track (else its min-content width overflows the card). The text truncates first and chips wrap to a second line only when 6 characters no longer fit — never clipped, never pushed out. See change: compact-session-card-header; generalised by align-ui-contract-recipes |` },

/* ───────────────────────────── R9 ───────────────────────────── */
{ id: "rail", title: "Settings rail", icon: "Menu", verdict: "fix",
  lead: "Recorded as contract debt by add-services-settings-ui and left alone: inactive rail items are `--text-muted` (fails AA) and the active item is a raw `bg-blue-600/15`.",
  cites: [["WCAG 1.4.3 Contrast", "https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum"], ["WCAG 1.4.11 Non-text contrast", "https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast"], ["NN/g navigation: show where you are", "https://www.nngroup.com/articles/navigation-you-are-here/"]],
  finds: [
    ["R1", "`SettingsPanel.tsx:1403` inactive `text-[var(--text-muted)]` (2.3–2.6:1)."],
    ["R2", "`SettingsPanel.tsx:1402` active `bg-blue-600/15` — raw palette; the only cue besides weight."],
    ["R3", "`SettingsPanel.tsx:1437,1460` sub-actions 11 px `--text-muted`; disabled rows `opacity-60` on `--text-muted`."],
  ],
  asbuilt: () => [
    v("settings/SettingsPanel.tsx:1399-1404", "text-muted + raw blue",
      `<div style="display:grid;gap:2px;width:220px;padding:8px;background:var(--bg-primary);border-radius:8px">${[["CogOutline", "General", 0], ["Server", "Services", 1], ["ShieldKeyOutline", "Vault", 0], ["PackageVariantClosed", "Plugins", 0]].map(([i, t, a]) => `<span style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;font-size:14px;${a ? "background:rgba(37,99,235,.15);color:var(--text-primary);font-weight:600" : "color:var(--text-muted)"}">${svgS(i, 16)}${t}</span>`).join("")}</div>`),
  ],
  proposed: () => [
    ["Rail · secondary text, tertiary fill + accent bar for current", `<nav class="r-rail" aria-label="Settings"><span class="grp">Dashboard</span>${[["CogOutline", "General", 0], ["Server", "Services", 1], ["ShieldKeyOutline", "Vault", 0]].map(([i, t, a]) => `<a class="r-ri" href="#" ${a ? 'aria-current="page"' : ""}>${ic(i)}${t}</a>`).join("")}<span class="grp">Extensions</span><a class="r-ri" href="#">${ic("PackageVariantClosed")}Plugins</a></nav>`],
  ],
  row: `| settings rail | item \`flex items-center gap-2.5 min-h-[36px] max-sm:min-h-[44px] px-3 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]\`; current \`aria-current="page"\` + \`bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-semibold\` + a 3 px \`--accent-primary\` inset bar (non-text indicator ≥ 3:1); group labels at the capsule-legend step; no \`--text-muted\`, no raw palette. Retires the debt recorded by add-services-settings-ui. See change: align-ui-contract-recipes |` },
];
