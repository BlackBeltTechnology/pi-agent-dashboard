/* Folder-card pill contrast board: SURFACES[] with as-built replica + proposed.
   As-built = 1:1 replica of the shipped Tailwind classes (pills.css "AS-BUILT").
   Proposed = token-only recipes (pills.css "PROPOSED"). Real fixtures only:
   the folder/branch from the reported screenshot, real failure codes from
   packages/server/src/git-worktree/worktree-init.ts, real copy from source. */

let _n = 0;
const nid = (p) => `${p}-${++_n}`;

/* ── fixtures ──────────────────────────────────────────────────────── */
const F = {
  path: "/Users/robson/Project/judo-esm-schema-merge-maven-plugin",
  name: "judo-esm-schema-merge-maven-plugin",
  branch: "feature/JNG-6349_AddZetaValidatiob",
  lastLine: "npm ci --prefer-offline  (added 412 packages in 9s)",
  code: "script_nonzero_exit",
  msg: "exit code 1",
};

/* ── shared chrome ─────────────────────────────────────────────────── */
const cardHead = () => `<div class="hd"><span class="chev">${ic("ChevronDown")}</span><span class="path">${ic("FolderOutline")}/Users…</span><span class="name">${esc(F.name)}</span><span class="tool">${ic("FolderCogOutline")}</span></div>
  <div class="git">${ic("SourceBranch")}${esc(F.branch)}</div>`;
const card = (inner) => `<div class="frame"><div class="card">${cardHead()}${inner}</div></div>`;

/* ── AS-BUILT replicas ─────────────────────────────────────────────── */
const AB = {
  bannerBtn: (sev, label) => `<div class="ab-banner sev-${sev}" role="region" aria-label="Folder action"><div style="flex:1;min-width:0">
    <button type="button" class="ab-initbtn" data-tx data-bd data-fill>${ic("ScriptTextPlayOutline")}${esc(label)}</button></div></div>`,
  running: () => `<div class="ab-banner sev-info" role="region" aria-label="Folder action"><div style="flex:1;min-width:0">
    <div style="display:inline-flex;flex-direction:column;min-width:240px;max-width:420px">
      <span class="ab-chip" data-tx data-bd data-fill style="--tx:var(--tw-amber-400);--bd:var(--tw-amber-500);--ba:35%;--fill:var(--tw-amber-500);--fa:6%"><span class="ab-spin"></span><b>Initializing…</b><span class="mut">· 12s</span></span>
      <div class="ab-bar"><i></i></div><div class="ghost">${esc(F.lastLine)}</div></div></div></div>`,
  done: () => `<div class="ab-banner sev-info" role="region" aria-label="Folder action"><div style="flex:1;min-width:0">
    <span class="ab-chip" data-tx data-bd data-fill style="--tx:var(--tw-green-400);--bd:var(--tw-green-500);--ba:35%;--fill:var(--tw-green-500);--fa:6%">✓ <b>Initialized</b><span class="mut">· 14s</span></span></div></div>`,
  failed: () => `<div class="ab-banner sev-error" role="region" aria-label="Folder action"><div style="flex:1;min-width:0">
    <span class="ab-chip" data-tx data-bd data-fill style="gap:6px;--tx:var(--tw-red-400);--bd:var(--tw-red-500);--ba:40%;--fill:var(--tw-red-500);--fa:7%">✕ <b>Init failed</b><span class="mut mono">· ${F.code} · ${F.msg}</span>
      <button type="button" class="ab-retry" data-tx data-bd data-fill>↻ Retry</button></span></div></div>`,
  setup: () => `<div class="ab-banner sev-info" role="region" aria-label="Folder action">${ic("TextBoxCheckOutline")}<span style="flex:1;font-size:12px;font-weight:500">Not a pi project yet</span>
    <button type="button" class="fab-x" style="border:1px solid currentColor;border-radius:4px;padding:4px 8px;font-size:11px;font-weight:600">Set up →</button></div>`,
  slot: (hue, glyph, label, val, extra = "") => `<div class="sp" role="button" tabindex="0"><span class="lg">${esc(label)}</span>
    <span class="gl ab-gl h-${hue}" data-tx data-fill>${ic(glyph)}</span><span class="val">${val}${extra}</span></div>`,
};

/* ── PROPOSED recipes ──────────────────────────────────────────────── */
const P = {
  banner: (sev, icon, msg, sub, action, extra = "") => `<div class="fab sev-${sev}" role="region" aria-label="Folder action">${icon}
    <span class="msg">${msg}${sub ? `<small>${sub}</small>` : ""}${extra}</span>${action ? `<button type="button" class="act">${action}</button>` : ""}</div>`,
  slot: (cls, glyph, label, val, extra = "") => `<div class="sp" role="button" tabindex="0"><span class="lg">${esc(label)}</span>
    <span class="gl ${cls}">${ic(glyph)}</span><span class="val">${val}${extra}</span></div>`,
};
const unit = (n, u) => `<span>${n}</span><span class="unit">${u}</span>`;

/* ── surfaces ──────────────────────────────────────────────────────── */
const SURFACES = [
  {
    id: "banner", icon: "AlertOutline", title: "Folder action banner",
    lead: "The banner region already paints with the `--severity-*` triple (≥ 6:1). The control re-hosted inside it (`WorktreeInitButton` / `WorktreeInitChip`) brings its own dark-tuned `amber-400` / `green-400` / `red-400` paint, which collapses to ~1.3:1 in every light palette. Proposed: one message + one `border-current` action, the exact shape the shipped setup rung already uses — every descendant inherits the severity `-fg`.",
    cites: [["packages/client/src/components/folder/FolderActionBanner.tsx", "`RUNG_SEVERITY`, `SEVERITY_CLASS`"], ["packages/client/src/components/worktree/WorktreeInitButton.tsx", "L150 button classes"], ["packages/client/src/components/worktree/WorktreeInitChip.tsx", "L83 / L104 / L116 / L124"]],
    finds: [
      ["F1", "`Review & trust changes`: `text-amber-400` on the warning banner → 1.34:1 light (7.69 dark). 10 px text inside a button (12 px floor)."],
      ["F2", "The retrust rung has no explanatory text — just a tinted outlined button inside a tinted box (box-in-box)."],
      ["F3", "Running / failed chips and the Retry button re-tint (amber/red-400) inside info/error banners → 1.29–2.05:1 light."],
      ["F4", "`--text-muted` (`· 12s`, failure code) on the tinted chip — measured in the probe."],
    ],
    rows: [
      ["retrust · warning", () => card(AB.bannerBtn("warning", "Review & trust changes")),
        () => card(P.banner("warning", ic("ShieldAlertOutline"), "Init hook needs your trust before it can run", "", "Review &amp; trust")),
        "Message carries the why without claiming the hook changed (`trusted:false` also covers never-trusted hooks); action keeps the `worktree-init-btn` testid and the trust-confirm dialog. Keys `folders.bannerRetrust` + `folders.bannerRetrustAction`."],
      ["init-needed · info", () => card(AB.bannerBtn("info", "Initialize")),
        () => card(P.banner("info", ic("ScriptTextPlayOutline"), "Init hook hasn’t run in this checkout", "", "Initialize")),
        "Same recipe, info triple. New i18n key `folders.bannerInitNeeded`."],
      ["running · info", () => card(AB.running()),
        () => card(P.banner("info", `<span class="spin" aria-hidden="true"></span>`, "Initializing… · 12s", esc(F.lastLine), "", `<div class="bar" aria-hidden="true"><i></i></div>`)),
        "Spinner + progress bar paint `currentColor`; the ghost line inherits the info `-fg` instead of `--text-muted`."],
      ["done · info", () => card(AB.done()),
        () => card(P.banner("info", ic("CheckCircleOutline"), "Initialized · 14s", "", "")),
        "D2 (recommended): `done` stays on the info rung, icon + text inherit the info `-fg` — no green chip inside a blue box."],
      ["done · success (D2 alternative)", () => card(AB.done()),
        () => card(P.banner("success", ic("CheckCircle"), "Initialized · 14s", "", "")),
        "D2 alternative: own `success` triple. Probe: `--severity-success-fg` on its own bg = 4.47:1 in Nord light (token bug F15 — fails every success pill in that palette, independent of this change)."],
      ["failed · error", () => card(AB.failed()),
        () => card(P.banner("error", ic("AlertCircleOutline"), "Init failed", `${F.code} · ${F.msg}`, `${ic("Replay")}Retry`, `<details open><summary style="font-size:12px">View log</summary><pre style="margin:4px 0 0;padding:6px 8px;border-radius:6px;font:11px/1.4 SF Mono,Menlo,monospace;color:var(--text-secondary);background:var(--bg-code);border:1px solid var(--border-subtle);white-space:pre-wrap">npm ERR! code ELIFECYCLE\nnpm ERR! errno 1</pre></details>`)),
        "Retry (`mdiReplay`) is a `border-current` action like the others; failure code moves to the second line (mono, inherits error `-fg`); the expanded log body keeps code colours (`--text-secondary` on `--bg-code`)."],
      ["setup · info (reference, unchanged)", () => card(AB.setup()),
        () => card(P.banner("info", ic("TextBoxCheckOutline"), "Not a pi project yet", "", "Set up →")),
        "Already token-correct today — the template the other rungs adopt."],
      ["compact chip (folder-banner hidden)", () => `<div class="frame"><div class="card">${cardHead()}<div class="chips">
          <span class="chip-c sev-warning">${ic("AlertOutline")}Re-trust needed</span><span class="chip-c sev-info">${ic("AlertOutline")}Init needed</span><span class="chip-c sev-error">${ic("AlertOutline")}Init failed</span></div></div></div>`,
        () => `<div class="frame"><div class="card">${cardHead()}<div class="chips">
          <button type="button" class="chip-c sev-warning" style="font-size:12px;min-height:24px">${ic("AlertOutline")}Re-trust needed</button><button type="button" class="chip-c sev-info" style="font-size:12px;min-height:24px">${ic("ScriptTextPlayOutline")}Init needed</button><button type="button" class="chip-c sev-error" style="font-size:12px;min-height:24px">${ic("AlertCircle")}Init failed</button></div></div></div>`,
        "Colours already pass; only the label is 11 px inside a `<button>` (12 px floor) and the icon is always ⚠ — proposed matches the rung icon."],
    ],
  },
  {
    id: "slots", icon: "CogOutline", title: "Folder slot pills (SlotPill)",
    lead: "Legend + count text already pass (8.5:1). The glyph chip is `text-<hue>-400` on `bg-<hue>-500/10` — a meaningful graphic (WCAG 1.4.11, 3:1) that fails in light (1.58–2.62:1). The inline state markers (`⚠ 2`, `1 off`, MCP `⚠`) are `amber-400` / `red-400` TEXT on the pill body. Plugins (automation, goal, kb, mcp, team) must paint through host tokens (`host-design.md`), yet SlotPill hands them six raw hues.",
    cites: [["packages/dashboard-plugin-runtime/src/SlotPill.tsx", "`ACCENT` map"], ["packages/automation-plugin/src/client/FolderAutomationSection.tsx", "L103 invalid marker"], ["packages/mcp-client-plugin/src/client/FolderMcpSection.tsx", "L52 error, L163 off"], ["packages/client/src/components/openspec/FolderOpenSpecSection.tsx", "L234 broken-state glyph (inline copy)"]],
    finds: [
      ["F5", "Glyph chips: KB cyan 1.58, Automations blue 2.25, Team/OpenSpec purple 2.34, MCP/Goals indigo 2.62 (light)."],
      ["F6", "Only six hue tokens exist (`--accent-{blue,green,yellow,red,purple,orange}-text`); SlotPill uses indigo / cyan / teal which have none."],
      ["F7", "`FolderOpenSpecSection` broken state re-declares the purple glyph classes inline instead of using SlotPill."],
    ],
    rows: [
      ["six slots · normal", () => `<div class="frame"><div class="card">${cardHead()}<div class="slots">
          ${AB.slot("blue", "CogOutline", "Automations", unit(1, "tasks"))}${AB.slot("indigo", "Target", "Goals", unit(0, "active"))}
          ${AB.slot("cyan", "DatabaseOutline", "Knowledge base", unit("12.4k", "chunks"))}${AB.slot("indigo", "ServerOutline", "MCP", unit(2, "servers"))}
          ${AB.slot("purple", "AccountGroupOutline", "Team", unit(3, "members"))}${AB.slot("purple", "ClipboardTextOutline", "OpenSpec", unit(82, "changes"))}</div></div></div>`,
        () => `<div class="frame"><div class="card">${cardHead()}<div class="slots">
          ${P.slot("pg-blue", "CogOutline", "Automations", unit(1, "tasks"))}${P.slot("pg-blue", "Target", "Goals", unit(0, "active"))}
          ${P.slot("pg-green", "DatabaseOutline", "Knowledge base", unit("12.4k", "chunks"))}${P.slot("pg-blue", "ServerOutline", "MCP", unit(2, "servers"))}
          ${P.slot("pg-purple", "AccountGroupOutline", "Team", unit(3, "members"))}${P.slot("pg-purple", "ClipboardTextOutline", "OpenSpec", unit(82, "changes"))}</div></div></div>`,
        "D3 option A (recommended): `SlotAccent` keeps its six keys for API stability but resolves onto host tokens — blue→blue, indigo→blue, cyan→green, teal→green, purple→purple, red→red; glyph = `--accent-<hue>-text` on `--tint-<hue>-bg`."],
      ["six slots · option B (neutral glyph)", () => `<div class="frame"><div class="card" style="opacity:.6">${cardHead()}<p class="ghost" style="color:var(--text-secondary)">(same as-built as above)</p></div></div>`,
        () => `<div class="frame"><div class="card">${cardHead()}<div class="slots">
          ${P.slot("pg-neutral", "CogOutline", "Automations", unit(1, "tasks"))}${P.slot("pg-neutral", "Target", "Goals", unit(0, "active"))}
          ${P.slot("pg-neutral", "DatabaseOutline", "Knowledge base", unit("12.4k", "chunks"))}${P.slot("pg-neutral", "ServerOutline", "MCP", unit(2, "servers"))}
          ${P.slot("pg-neutral", "AccountGroupOutline", "Team", unit(3, "members"))}${P.slot("pg-red", "ClipboardTextOutline", "OpenSpec", `<span>Broken</span>`)}</div></div></div>`,
        "D3 option B: glyphs neutral (`--text-secondary` on `--bg-tertiary`); hue appears only for a problem state (red). Calmer card; colour = signal. Option C (add indigo/cyan/teal tokens × 9 palettes × dark/light = 54 new values) is not drawn — heaviest, no new meaning."],
      ["state markers", () => `<div class="frame"><div class="card">${cardHead()}<div class="slots">
          ${AB.slot("blue", "CogOutline", "Automations", unit(3, "tasks"), `<span class="mk" data-tx style="--tx:var(--tw-amber-400)">⚠ 2</span>`)}
          ${AB.slot("indigo", "ServerOutline", "MCP", `<span>2 servers</span><span style="color:var(--text-tertiary)">·</span><span data-tx style="--tx:var(--tw-amber-400)">1 off</span>`)}
          ${AB.slot("red", "ServerOutline", "MCP", `<span>.mcp.json</span><span data-tx style="--tx:var(--tw-red-400)" role="img" aria-label="parse error">⚠</span>`)}
          ${AB.slot("red", "DatabaseOutline", "Knowledge base", `<span>Index error</span>`)}</div></div></div>`,
        () => `<div class="frame"><div class="card">${cardHead()}<div class="slots">
          ${P.slot("pg-blue", "CogOutline", "Automations", unit(3, "tasks"), `<span class="mk t-orange">⚠ 2</span>`)}
          ${P.slot("pg-blue", "ServerOutline", "MCP", `<span>2 servers</span><span style="color:var(--text-tertiary)">·</span><span class="t-orange">1 off</span>`)}
          ${P.slot("pg-red", "ServerOutline", "MCP", `<span>.mcp.json</span><span class="t-red" role="img" aria-label="parse error">⚠</span>`)}
          ${P.slot("pg-red", "DatabaseOutline", "Knowledge base", `<span>Index error</span>`)}</div></div></div>`,
        "Markers: `amber-400` → `--accent-orange-text`, `red-400` → `--accent-red-text`. Unit + marker text 10 → 11 px (11 px floor for non-interactive text, D4)."],
    ],
  },
  {
    id: "header", icon: "Pin", title: "Folder header + toolbar",
    lead: "Small paints in the directory-card header and the sidebar toolbar: the pinned glyph and the Add-to-workspace button.",
    cites: [["packages/client/src/components/session/SessionList.tsx", "L2190 pin, L1658 add-to-workspace"]],
    finds: [
      ["F8", "Pinned indicator `text-yellow-400` → 1.57:1 light (it is `aria-hidden`, so it is the only cue for sighted users)."],
      ["F9", "Add-to-workspace menu node `text-blue-500` on `blue-500/5` → measured in probe; spec (`folder-actions-menu`) already calls this item neutral."],
    ],
    rows: [
      ["pinned folder", () => `<div class="frame"><div class="card"><div class="hd"><span class="chev">${ic("ChevronDown")}</span><span data-tx style="--tx:var(--tw-yellow-400);font-size:12px">${ic("Pin")}</span><span class="name">${esc(F.name)}</span></div></div></div>`,
        () => `<div class="frame"><div class="card"><div class="hd"><span class="chev">${ic("ChevronDown")}</span><span class="t-yellow" style="font-size:12px">${ic("Pin")}</span><span class="name">${esc(F.name)}</span></div></div></div>`,
        "`--accent-yellow-text` (light #7c5f04)."],
      ["add to workspace", () => `<div class="frame"><button type="button" class="ab-wsbtn" data-tx data-bd data-fill>${ic("FolderPlusOutline")}Workspace</button></div>`,
        () => `<div class="frame"><button type="button" class="ta neutral">${ic("FolderPlusOutline")}Workspace</button></div>`,
        "Neutral recipe: `folder-actions-menu` declares the add-to-workspace node a neutral host item (it renders only as that menu's node)."],
    ],
  },
  {
    id: "activity", icon: "ClipboardTextOutline", title: "Session-card activity + toggle chips",
    lead: "Same recipe family on the session card and sidebar filters: phase-coloured activity rows, artifact letters, flow status, and `aria-pressed` toggle chips painted `blue-400` on `blue-500/10`.",
    cites: [["packages/client/src/components/openspec/OpenSpecActivityBadge.tsx", "`phaseColors` (9 hues)"], ["packages/client/src/components/openspec/openspec-helpers.tsx", "`statusColor`"], ["packages/flows-plugin/src/client/FlowActivityBadge.tsx", "`statusConfig`, Abort"], ["packages/client/src/components/openspec/OpenSpecGroupPills.tsx", "active pill"], ["packages/client/src/components/session/SessionList.tsx", "L387 FilterChip, L2898 archive chip"]],
    finds: [
      ["F10", "Phase label text in 9 raw hues (`*-400`) — yellow/cyan/green fail hardest in light."],
      ["F11", "Artifact letters `green-500` 2.22:1 / `yellow-500` light; 10 px inside a `<button>`."],
      ["F12", "Active toggle chips (`group-pill-*`, FilterChip, archive chip): `blue-400` text on `blue-500/10`."],
      ["F13", "Flow badge statuses + Abort (`red-400`)."],
    ],
    rows: [
      ["OpenSpec phase rows", () => `<div class="frame"><div class="sc">${[["blue", "Exploring"], ["cyan", "Continuing"], ["yellow", "Applying"], ["green", "Verifying"], ["emerald", "Archiving"]].map(([h, l]) =>
          `<div class="act" data-tx style="--tx:var(--tw-${h}-400)">${ic("ClipboardTextOutline")}<span class="t">${l}<span class="sec"> · fix-folder-card-pill-contrast</span><span class="mut"> (4/12)</span></span></div>`).join("")}</div></div>`,
        () => `<div class="frame"><div class="sc">${[["blue", "Exploring"], ["blue", "Continuing"], ["yellow", "Applying"], ["green", "Verifying"], ["green", "Archiving"]].map(([h, l]) =>
          `<div class="act t-${h}">${ic("ClipboardTextOutline")}<span class="t">${l}<span class="sec"> · fix-folder-card-pill-contrast</span><span class="sec"> (4/12)</span></span></div>`).join("")}</div></div>`,
        "9 phases fold onto the 6 hue tokens: explore/continue/ff → blue, new/sync-specs/onboard → purple, apply → yellow, verify/archive → green. The label text already distinguishes phases. Task count `(4/12)` is `--text-muted` today and fails in EVERY theme (2.0–2.6:1, dark included) → `--text-secondary`."],
      ["artifact letters", () => `<div class="frame"><div class="sc"><div class="letters">${[["green-500", "P"], ["green-500", "D"], ["yellow-500", "S"], ["", "T"]].map(([c, l]) =>
          `<button type="button" ${c ? `data-tx style="--tx:var(--tw-${c})"` : 'style="color:var(--text-muted)"'}>${l}</button>`).join("")}</div></div></div>`,
        () => `<div class="frame"><div class="sc"><div class="letters">${[["t-green", "P"], ["t-green", "D"], ["t-yellow", "S"], ["", "T"]].map(([c, l]) =>
          `<button type="button" class="${c}" style="font-size:12px;${c ? "" : "color:var(--text-secondary)"}">${l}</button>`).join("")}</div></div></div>`,
        "`--accent-green-text` / `--accent-yellow-text`; pending letter `--text-muted` → `--text-secondary`; 10 → 12 px (button floor)."],
      ["flow status + abort", () => `<div class="frame"><div class="sc">
          <div class="act" data-tx style="--tx:var(--tw-blue-400)">${ic("Loading")}<span class="t">ship-it<span class="sec"> · 3/7 agents</span></span><button type="button" class="ab-abort" data-tx data-bd>${ic("Stop")}Abort</button></div>
          <div class="act" data-tx style="--tx:var(--tw-green-400)">${ic("CheckCircle")}<span class="t">plan-proposal<span class="sec"> · success</span></span></div>
          <div class="act" data-tx style="--tx:var(--tw-red-400)">${ic("AlertCircle")}<span class="t">review<span class="sec"> · error</span></span></div>
          <div class="act" data-tx style="--tx:var(--tw-orange-400)">${ic("StopCircle")}<span class="t">ship-change<span class="sec"> · aborted</span></span></div></div></div>`,
        () => `<div class="frame"><div class="sc">
          <div class="act t-blue">${ic("Loading")}<span class="t">ship-it<span class="sec"> · 3/7 agents</span></span><button type="button" class="ta red">${ic("Stop")}Abort</button></div>
          <div class="act t-green">${ic("CheckCircle")}<span class="t">plan-proposal<span class="sec"> · success</span></span></div>
          <div class="act t-red">${ic("AlertCircle")}<span class="t">review<span class="sec"> · error</span></span></div>
          <div class="act t-orange">${ic("StopCircle")}<span class="t">ship-change<span class="sec"> · aborted</span></span></div></div></div>`,
        "Statuses → `--accent-<hue>-text`; Abort → `tint-action-red` (12 px)."],
      ["toggle chips (aria-pressed)", () => `<div class="frame"><div class="chips">
          <button type="button" class="ab-tchip round" aria-pressed="true" data-tx data-bd data-fill>All</button><button type="button" class="ab-tchip round" aria-pressed="false"><span class="dot" style="background:var(--accent-purple)"></span>client-ui-fixes</button>
          <button type="button" class="ab-tchip" aria-pressed="true" data-tx data-bd data-fill>active</button><button type="button" class="ab-tchip" aria-pressed="false">ended</button></div></div>`,
        () => `<div class="frame"><div class="chips">
          <button type="button" class="tchip round" aria-pressed="true">All</button><button type="button" class="tchip round" aria-pressed="false"><span class="dot" style="background:var(--accent-purple)"></span>client-ui-fixes</button>
          <button type="button" class="tchip" aria-pressed="true">active</button><button type="button" class="tchip" aria-pressed="false">ended</button></div></div>`,
        "Pressed = theme-system selected chip: `--text-primary` on `--accent-soft`, `--accent` border (selection is not identity, so no tint); unpressed `--text-muted`/`--text-tertiary` → `--text-secondary`; 10 → 12 px."],
    ],
  },
  {
    id: "stack", icon: "Loading", title: "Worktree init stack (≥ 2 runs)",
    lead: "Floating bottom-right panel when two or more checkouts initialise at once. Status glyphs/text and the Dismiss button use `amber/green/red-400` on `--bg-secondary`.",
    cites: [["packages/client/src/components/worktree/WorktreeInitStack.tsx", "Spinner, rows, Dismiss"]],
    finds: [["F14", "Done text `green-400`, failed code `red-400`, Dismiss `amber-400` on a neutral surface — all < 3:1 light."]],
    rows: [
      ["3 runs: running / done / failed", () => `<div class="frame"><div class="stackp"><div class="sh"><span class="ab-spin"></span><b>Initializing 1 worktree</b><span class="r">1 done · 1 failed</span></div>
          <div class="sr"><span class="ab-spin"></span><span class="nm">wt-a</span><span class="fl mut mono">${esc(F.lastLine)}</span><span class="mut">12s</span></div>
          <div class="sr"><span data-tx style="--tx:var(--tw-green-400);width:14px;text-align:center">✓</span><span class="nm">wt-b</span><span class="fl" data-tx style="--tx:var(--tw-green-400)">Initialized</span><span class="mut">· fading</span></div>
          <div class="sr" data-fill style="--fill:var(--tw-red-500);--fa:5%"><span data-tx style="--tx:var(--tw-red-400);width:14px;text-align:center">✕</span><span class="nm">wt-c</span><span class="fl mono" data-tx style="--tx:var(--tw-red-400)">${F.code}</span><button type="button" class="ab-retry" data-tx data-bd data-fill style="margin:0">Dismiss</button></div></div></div>`,
        () => `<div class="frame"><div class="stackp"><div class="sh"><span class="t-blue spin2"></span><b>Initializing 1 worktree</b><span class="r" style="color:var(--text-secondary)">1 done · 1 failed</span></div>
          <div class="sr"><span class="t-blue spin2"></span><span class="nm">wt-a</span><span class="fl mono" style="color:var(--text-secondary)">${esc(F.lastLine)}</span><span style="color:var(--text-secondary);font-size:11px">12s</span></div>
          <div class="sr"><span class="t-green" style="width:14px;text-align:center">${ic("Check")}</span><span class="nm">wt-b</span><span class="fl t-green">Initialized</span><span style="color:var(--text-secondary);font-size:11px">· fading</span></div>
          <div class="sr" style="background:var(--severity-error-bg)"><span class="t-red" style="width:14px;text-align:center">${ic("AlertCircle")}</span><span class="nm">wt-c</span><span class="fl mono" style="color:var(--severity-error-fg)">${F.code}</span><button type="button" class="ta neutral" style="font-size:12px">Dismiss</button></div></div></div>`,
        "Running = info (blue) to match the banner rung; done/failed → `--accent-green-text` / `--accent-red-text`; failed row `--severity-error-{bg,fg}` (severity, not identity tint); ✓/✕ → MDI icons; Dismiss → neutral secondary button (not a warning). Muted meta → `--text-secondary`."],
    ],
  },
];
