/* Surfaces A — host chrome + live-status pages (apple-tools, browser, chat-gateway,
   flows-anthropic-bridge, obs-studio, mcp-client). Finding ids → ui-plan.md. */
const SURFACES = [];

/* ═══ HOST CHROME ═══ */
SURFACES.push({
  id: "host", title: "Host chrome (every plugin page)", verdict: "redesign", icon: "PackageVariantClosed",
  lead: "PluginSettingsPage.tsx owns identity, status, enable toggle, dependency chips and banners. Plugin bodies supply content only.",
  finds: [
    ["H1", "`claims:` chip = developer data on an end-user page → hidden; shown under “Plugin internals” only when Developer ▸ Show plugin internals is on."],
    ["H2", "Status pill + id + `enable` label at 10 px, id in `--text-muted` → 11/12 px `--text-secondary`; status pill only when unhealthy (compact-header precedent), human words: Off · Needs setup · Not loaded · Failed to load."],
    ["H3", "Native checkbox `accent-blue-500` + lowercase `enable` → kit switch with label “Enabled”."],
    ["H4", "WARN/ERR/OK/LINK paint `--accent-*` fill as text → severity tokens (`SettingsNotice` recipe for banners)."],
    ["H5", "“← Plugins” sits at the page bottom in muted 12 px → breadcrumb above the chrome card, `--text-secondary`, 32 px target."],
    ["H6", "Card `rounded` → `rounded-xl` card root; title `text-base` → `text-lg` (contract title step)."],
    ["H7", "Body has no host wrapper → host wraps body in `grid gap-3` so every plugin gets the same vertical rhythm; rule + lint: body never repeats title/id (design D3)."],
  ],
  states: [
    { name: "full · enabled", asbuilt: "host.full", proposed: page({ title: "Quota", id: "quota", icon: "Gauge", claims: ["composer-context-group", "settings-section"] }, lead("Plugin body starts here.")) },
    { name: "missing requirement (apple-tools)", asbuilt: null, proposed: page({ title: "Apple Tools", id: "apple-tools", icon: "Apple", status: "req", deps: ["mcp-client"], banners: notice("warning", "Needs a file that is not on this computer: <code>/Applications/iMCP.app/Contents/MacOS/imcp-server</code>. Install iMCP below.") }, lead("Plugin body starts here.")) },
    { name: "disabled", asbuilt: null, proposed: `<div class="pg">${chrome({ title: "Chat Gateway", id: "chat-gateway", icon: "MessageTextOutline", on: false, status: "disabled" })}${notice("info", "This plugin is off. Turn it on to change its settings.", btn("secondary sm", "Turn on"))}</div>` },
    { name: "load failed + developer internals", asbuilt: null, proposed: page({ title: "Browser Relay", id: "browser", icon: "GoogleChrome", status: "error", dev: true, claims: ["editor-pane-tab", "session-card-badge", "settings-section", "shell-headless"], banners: notice("error", "The plugin failed to load. <code>Cannot find module './vendor/playwright-core'</code>", btn("secondary sm", "Copy details", "ContentCopy")) }, "") },
  ],
});

/* ═══ APPLE TOOLS ═══ */
const appleChrome = { title: "Apple Tools", id: "apple-tools", icon: "Apple", deps: ["mcp-client"] };
const applePath = field({ label: "iMCP server path", hint: "Change this only if iMCP is installed somewhere other than Applications.", state: "default", stacked: true, control: txt("/Applications/iMCP.app/Contents/MacOS/imcp-server", "", true) });
const appleFoot = notice("info", "Calendar, Contacts and other Apple permissions are granted in the iMCP menu-bar app. This page cannot change them.");
const appleManage = item({ title: "Tools in sessions", sub: "Turn iMCP on or off and choose which tools sessions get in MCP Client.", actions: btn("secondary sm", "Manage MCP servers", "OpenInNew") });
SURFACES.push({
  id: "apple-tools", title: "Apple Tools", verdict: "redesign", icon: "Apple",
  lead: "AppleToolsSettings.tsx — inline hex styles, no i18n, repeats title/id, raw checker state word.",
  finds: [
    ["AT1", "Second header “Apple Tools (iMCP)” + id repeats host chrome → removed (D3)."],
    ["AT2", "Raw state `OS_TOO_OLD` in mono → status pill with a human word + a callout that names the fix."],
    ["AT3", "Amber `#fbbf24`/red `#f87171`/`#a1a1aa` inline hex, 10–11 px → severity notices, 12 px."],
    ["AT4", "Path is a bare `<label>`+input saved on blur, no feedback → kit `TextField` (stacked, mono, Default pill + Reset) on the host Save bar (D4)."],
    ["AT5", "“Run installer” unstyled, no busy/result → primary button with busy state + result notice."],
    ["AT6", "Raw `status request failed (404)` → human error + retry; code kept behind “Copy details”."],
  ],
  states: [
    { name: "macOS too old (live)", asbuilt: "apple-tools", proposed: page(appleChrome, `${item({ title: "iMCP", sub: "Apple Calendar, Contacts, Reminders and Messages as MCP tools", pills: pill("warning", "macOS too old") })}${notice("warning", "iMCP needs macOS 15.3 or later. This Mac runs 14.6.1. Update macOS, then come back to install iMCP.")}${applePath}${appleManage}${appleFoot}`) },
    { name: "not installed", asbuilt: null, proposed: page(appleChrome, `${item({ title: "iMCP", sub: "Apple Calendar, Contacts, Reminders and Messages as MCP tools", pills: pill("neutral", "Not installed") })}${notice("info", "Install iMCP from a terminal on this Mac, then check again:<br><code>pi-apple-tools-install</code>", btn("secondary sm", "Copy command", "ContentCopy") + btn("ghost sm", "Check again", "Refresh"))}${applePath}${appleManage}${appleFoot}`) },
    { name: "installed", asbuilt: null, proposed: page(appleChrome, `${item({ title: "iMCP", sub: "Apple Calendar, Contacts, Reminders and Messages as MCP tools", pills: pill("success", "Installed"), actions: btn("secondary sm", "Reinstall", "Refresh") })}${notice("info", "Grant Calendar, Contacts and other access in the iMCP menu-bar app. This page cannot do it for you.")}${applePath}${appleManage}${appleFoot}`, 1) },
    { name: "status unavailable", asbuilt: null, proposed: page(appleChrome, `${notice("error", "Could not check iMCP on this Mac. The dashboard server did not answer.", btn("secondary sm", "Try again", "Refresh") + btn("ghost sm", "Copy details", "ContentCopy"))}${applePath}${appleFoot}`) },
  ],
});

/* ═══ BROWSER RELAY ═══ */
const brChrome = { title: "Browser Relay", id: "browser", icon: "GoogleChrome" };
const brMaster = (on) => field({ label: "Relay connections", hint: "Turn off to block every Chrome profile at once. The plugin stays on.", control: sw(on) });
const brProfile = ({ name, email = "", installed, token, connected = 0, open = true, err = "" }) => item({
  title: name, sub: email, collapsible: true, open,
  pills: (installed ? pill("success", "Extension installed") : pill("neutral", "Extension missing")) + (token ? pill("success", "Paired") : pill("neutral", "Not paired")) + (connected ? pill("info", `Connected · ${connected} tabs`, "Connection") : ""),
  body: `${err ? notice("error", err, btn("secondary sm", "Try again", "Refresh")) : ""}
    ${field({ label: "Pairing token", hint: token ? "A token is saved. Paste a new one to replace it." : "Copy the token from the Playwright extension popup in this Chrome profile.", stacked: true, control: withBtn(txt("", token ? "••••••••  saved" : "Paste pairing token", true, "password"), btn("secondary", "Save token")) })}
    ${field({ label: "Skip Chrome's Allow prompt", hint: token ? "Connect without clicking Allow in Chrome. A wrong token, Reject, or no answer all end as a 60 s timeout." : "Pair this profile first.", control: sw(false, !token), disabled: !token })}
    ${field({ label: "Allowed domains", hint: "Comma-separated. Limits where pages can navigate or open. Other network traffic is not filtered.", stacked: true, control: txt("", "github.com, *.atlassian.net", true) })}
    <div class="actions">${installed ? btn("secondary", connected ? "Disconnect" : "Connect", "Connection") : btn("secondary", "Install the Playwright extension", "OpenInNew")}</div>
    <details class="sf-grp"><summary>${ic("ChevronRight", "chev")}Activity<span class="meta">${connected ? "3 entries" : "none yet"}</span></summary><div class="sf-body">${connected ? table(["When", "Event", "Detail"], [["10:42", "Connected", "2 tabs"], ["10:41", "Token saved", ""], ["09:12", "Allowed domains changed", "github.com"]]) : `<p class="p-help">No activity yet.</p>`}</div></details>`,
});
SURFACES.push({
  id: "browser", title: "Browser Relay", verdict: "redesign", icon: "GoogleChrome",
  lead: "BrowserSettings.tsx — 5 008 px tall live: every Chrome profile fully expanded, statuses as 10 px words, unhandled write errors.",
  finds: [
    ["BR1", "“Enabled” checkbox collides with the host Enabled switch → “Relay connections” switch with a hint that says what it blocks."],
    ["BR2", "Status column = three 10 px tertiary words → status pills (word + icon) in the card header."],
    ["BR3", "Every profile fully expanded (page ≈ 5 000 px) → collapsible profile cards; profiles with the extension open, others grouped and collapsed."],
    ["BR4", "Token input has no label; zero-dialog disabled with no reason → kit fields with labels; disabled hint says “Pair this profile first”."],
    ["BR5", "Default blue underlined link → contract `p-link`; Connect as secondary; Revoke (This computer) as danger."],
    ["BR6", "Write failures are unhandled rejections; any toggle failure blanks the page → per-profile error notice + Try again; page-level error keeps the form."],
    ["BR7", "AUDIT 10 px caption, raw `kind` → collapsed “Activity” group, human event words."],
  ],
  states: [
    { name: "profiles (live)", asbuilt: "browser", proposed: page(brChrome, `${lead("Let pi sessions use your logged-in Chrome through the Playwright extension.")}${brMaster(true)}${sec("Chrome profiles with the extension")}${brProfile({ name: "robert.csakany@blackbelt.hu", email: "Profile 3", installed: true, token: false })}${group("Other Chrome profiles", `${brProfile({ name: "Your Chrome", installed: false, token: false, open: false })}${brProfile({ name: "Person 1", installed: false, token: false, open: false })}${brProfile({ name: "Person 2", installed: false, token: false, open: false })}`, { open: false, meta: "3 · extension missing" })}`) },
    { name: "paired + connected", asbuilt: null, proposed: page(brChrome, `${brMaster(true)}${sec("Chrome profiles with the extension")}${brProfile({ name: "robert.csakany@blackbelt.hu", email: "Profile 3", installed: true, token: true, connected: 2 })}`) },
    { name: "relay off", asbuilt: null, proposed: page(brChrome, `${brMaster(false)}${notice("info", "Relay connections are off. No session can reach Chrome until you turn them back on.")}${brProfile({ name: "robert.csakany@blackbelt.hu", email: "Profile 3", installed: true, token: true, open: false })}`) },
    { name: "write failed", asbuilt: null, proposed: page(brChrome, `${brMaster(true)}${brProfile({ name: "robert.csakany@blackbelt.hu", email: "Profile 3", installed: true, token: false, err: "The token was not saved. The dashboard server did not answer." })}`) },
  ],
});

/* ═══ CHAT GATEWAY ═══ */
const cgChrome = { title: "Chat Gateway", id: "chat-gateway", icon: "MessageTextOutline" };
const cgConn = (cfg) => group("Discord connection", `
  ${field({ label: "Answer Discord messages", hint: "Turn off to pause the gateway without losing its settings.", control: sw(true) })}
  ${field({ label: "Bot token", hint: cfg ? "A token is saved. Paste a new one to replace it." : "Create a bot in the Discord developer portal and paste its token. Without it the gateway does nothing.", stacked: true, state: cfg ? undefined : undefined, control: txt("", cfg ? "••••••••  saved" : "Paste bot token", true, "password") })}`, { meta: cfg ? "" : "" });
const cgWhere = (err) => group("Where sessions run", `
  ${field({ label: "Allowed folders", hint: "One folder per line. Every new session's folder must be inside one of these. Required.", stacked: true,  control: area(err ? "" : "/Users/robson/Project\n/Users/robson/Documents", "/Users/you/Projects") })}
  ${field({ label: "Default folder", hint: "Used when a channel has no folder below. Must be inside an allowed folder.", stacked: true, control: txt(err ? "" : "/Users/robson/Project/pi-agent-dashboard", "/Users/you/Projects/app", true) })}
  ${field({ label: "Channel folders", hint: "One <code>channelKey=folder</code> per line. Pins a channel to a folder.", stacked: true, error: err ? "Line 2 is not <code>channelKey=folder</code> and would be dropped." : "", control: area(err ? "discord:1234:-=/repos/app\ndiscord:5678 /repos/web" : "discord:123456789:-=/repos/proj", "discord:123456789:-=/repos/proj") })}`, { meta: "3 fields" });
const cgWho = group("Who can use it", `
  ${field({ label: "Allowed users", hint: "Discord user ids, comma-separated. They can talk to sessions in direct messages.", stacked: true, control: txt("", "123456789012345678", true) })}
  ${field({ label: "Admins", hint: "Can also bind channels to sessions.", stacked: true, control: txt("", "", true) })}
  ${field({ label: "Group channels", hint: "Channel ids where the bot answers everyone, not only allowed users.", stacked: true, control: txt("", "", true) })}`, { open: false, meta: "3 fields" });
const cgBehave = group("Behaviour", `
  ${field({ label: "New thread per conversation", hint: "A new channel message starts a new thread and a new session.", control: sw(true) })}
  ${field({ label: "Mirror dashboard sessions", hint: "Every dashboard session gets its own Discord thread and sends its activity there.", control: sw(false) })}
  ${field({ label: "Steer prefix", hint: "Start a message with this to interrupt a running turn.", control: `<input id="%ID" class="p-input num mono" value="!" aria-describedby="%DESC">` })}
  ${field({ label: "Chat sessions on the board", hint: "Hidden sessions appear when “Show hidden” is on.", control: sel(["Hidden", "Shown"], "Hidden") })}`, { open: false, meta: "4 fields" });
const cgPair = notice("info", "Pairing: a direct message from an unknown user is accepted only when it contains the current pairing code. The code is printed in the server log when the gateway starts.");
const cgBind = (rows) => group("Bound channels", rows ? table(["Channel", "Session", "Folder", "Source"], rows) : `<p class="p-help">No channels are bound yet. They appear here once the gateway is running.</p>`, { meta: rows ? `${rows.length}` : "none" });
const cgTeam = (armed) => group("Team controls", `
  <div class="status-row">${armed ? pill("success", "Armed") : pill("error", "Disarmed · action requests are refused")}${armed ? "" : btn("secondary sm", "Re-arm", "Restart")}</div>
  ${facts([["Highest level", "observe"], ["Allowed folders", "<code>/Users/robson/Project</code>"]])}
  ${item({ title: "pi-agent-dashboard", sub: "channel <code>#dash-team</code>", pills: pill("neutral", "observe") + pill("neutral", "mirror off") })}
  ${sec("Command log")}
  ${table(["When", "Who", "Command", "Result", "Reason"], [["10:42", "robson", "status", pill("success", "Done"), ""], ["10:40", "guest", "abort", pill("error", "Refused"), "ceiling observe"]])}`, { open: true, meta: armed ? "armed" : "disarmed" });
SURFACES.push({
  id: "chat-gateway", title: "Chat Gateway", verdict: "redesign", icon: "MessageTextOutline",
  lead: "ChatGatewaySettings.tsx + team-controls-panel.tsx — 14 controls in one flat list, own mid-page Save, no i18n, plugin missing from index.css @source (its grid and danger classes never compile).",
  finds: [
    ["CG1", "No grouping → 4 groups: Discord connection · Where sessions run · Who can use it · Behaviour; read-only blocks after."],
    ["CG2", "Jargon in labels (`allowedRoots`, L1/L2/L4, `channelKey`) → plain labels; the term moves into the hint."],
    ["CG3", "“Enabled” duplicates the host switch → “Answer Discord messages”."],
    ["CG4", "Own Save button mid-page, notice shows raw `err.message` → host Save bar (D4); errors per field."],
    ["CG5", "Empty allowed folders give no warning; malformed map lines silently dropped → warning notice (non-blocking) + map-line field error before save."],
    ["CG6", "No status → header pill: Not set up / Running / Paused."],
    ["CG7", "Team controls “armed / ceiling observe” words, raw outcome → status pills; Re-arm next to the Disarmed pill."],
    ["CG8", "Missing `@source` line → `sm:grid-cols-3`, `max-w-*`, `--danger-text` (undeclared token) never render (D6)."],
  ],
  states: [
    { name: "not set up (live)", asbuilt: "chat-gateway", proposed: page(cgChrome, `<div class="status-row">${pill("neutral", "Not set up · add a bot token")}</div>${lead("Drive dashboard sessions from Discord.")}${cgConn(false)}${cgWhere(false)}${cgWho}${cgBehave}${cgPair}${cgBind(null)}`) },
    { name: "running", asbuilt: null, proposed: page(cgChrome, `<div class="status-row">${pill("success", "Running")}</div>${cgConn(true)}${group("Where sessions run", "", { open: false, meta: "3 fields" })}${cgWho}${cgBehave}${cgBind([["#general", "Fix login bug", "<code>…/pi-agent-dashboard</code>", "thread"], ["DM robson", "Docs", "<code>…/Documents</code>", "pairing"]])}${cgTeam(true)}`) },
    { name: "invalid before save", asbuilt: null, proposed: page(cgChrome, `<div class="status-row">${pill("neutral", "Not set up · add a bot token")}</div>${cgConn(false)}${notice("warning", "No allowed folders yet, so no session can start. Add at least one folder.")}${cgWhere(true)}`, 2) },
    { name: "team disarmed", asbuilt: null, proposed: page(cgChrome, `<div class="status-row">${pill("success", "Running")}</div>${cgTeam(false)}`) },
  ],
});

/* ═══ ANTHROPIC MESSAGES BRIDGE ═══ */
const fabChrome = { title: "Anthropic Messages Bridge", id: "flows-anthropic-bridge", icon: "SitemapOutline", deps: ["flows"] };
const fabGate = (v) => field({ label: "Bridge gate", hint: v === "Automatic" ? "The bridge turns on only when both <code>@pi/anthropic-messages</code> and <code>pi-flows</code> load in a session." : v === "Always on" ? "Forces the bridge for every Anthropic Messages model. Sets <code>PI_ANTHROPIC_MESSAGES_FORCE_CANONICAL</code>." : "Turns the bridge off in every session. Sets <code>PI_ANTHROPIC_MESSAGES_DISABLE_CANONICAL</code>.", control: `<span class="seg-ctl" role="radiogroup" id="%ID" aria-describedby="%DESC">${["Automatic", "Always on", "Off"].map((o) => `<button role="radio" aria-checked="${o === v}">${o}</button>`).join("")}</span>`, state: v === "Automatic" ? "default" : "changed" });
const fabLead = lead("Passes <code>@pi/anthropic-messages</code> hooks into every pi-flows agent subprocess.");
SURFACES.push({
  id: "flows-anthropic-bridge", title: "Anthropic Messages Bridge", verdict: "redesign", icon: "SitemapOutline",
  lead: "FlowsAnthropicBridgeSettings.tsx — hard-coded zinc rgba/hex: the status bar is unreadable in light theme; card inside the host card; own Save.",
  finds: [
    ["FAB1", "Status bar `rgba(63,63,70,.5)` + `#a1a1aa` → `SettingsNotice` by tone (info / success / warning) with Refresh."],
    ["FAB2", "Repeats title + 10 px id inside a nested card → removed (D3)."],
    ["FAB3", "Two checkboxes can both be on (force + disable = contradiction) → one 3-way “Bridge gate” control; env var in the hint."],
    ["FAB4", "Own Save, no busy/feedback, invisible to host Save bar → host Save bar (D4)."],
    ["FAB5", "Table: raw enums (`waiting_peers`), ✓/✗ glyphs, literal “PID” → status pills + words."],
    ["FAB6", "No loading state (shows “no sessions” while fetching) → “Checking sessions…” notice."],
  ],
  states: [
    { name: "no sessions (live)", asbuilt: "flows-anthropic-bridge", proposed: page(fabChrome, `${fabLead}${notice("info", "No pi session has reported yet. Start a session to see the bridge status.", btn("secondary sm", "Refresh", "Refresh"))}${fabGate("Automatic")}`) },
    { name: "active", asbuilt: null, proposed: page(fabChrome, `${fabLead}${notice("success", "Bridge active in all 3 sessions.", btn("secondary sm", "Refresh", "Refresh"))}${fabGate("Automatic")}`) },
    { name: "degraded + changed gate", asbuilt: null, proposed: page(fabChrome, `${fabLead}${notice("warning", "1 of 3 sessions is missing a peer, so the bridge is off there.", btn("secondary sm", "Refresh", "Refresh"))}${table(["Session process", "Bridge", "@pi/anthropic-messages", "pi-flows"], [["<code>48211</code>", pill("success", "Active"), pill("success", "Loaded"), pill("success", "Loaded")], ["<code>51007</code>", pill("warning", "Waiting for peers"), pill("success", "Loaded"), pill("error", "Missing")]])}${fabGate("Always on")}`, 1) },
  ],
});

/* ═══ OBS STUDIO ═══ */
const obsChrome = { title: "OBS Studio", id: "obs-studio", icon: "VideoOutline" };
SURFACES.push({
  id: "obs-studio", title: "OBS Studio", verdict: "polish", icon: "VideoOutline",
  lead: "ObsSettingsCard.tsx — read-only status; literal backticks shown as text; raw state words; warnings are bare coloured lines.",
  finds: [
    ["OB1", "Literal `` `pi-obs provision` `` backticks → `<code>` + Copy command."],
    ["OB2", "Raw state (`stopped`, `stop-failed`) without label → status pill with a human word."],
    ["OB3", "Exposure + recovery warnings are coloured `<p>` → `SettingsNotice` warning."],
    ["OB4", "Instance = bold div + dl → `SettingsItem` (title, status pill, facts, Open panel)."],
    ["OB5", "Load error `Request failed: {code}` → human error + Try again; `Suspense fallback={null}` → “Loading…”."],
  ],
  states: [
    { name: "none provisioned (live)", asbuilt: "obs-studio", proposed: page(obsChrome, `${lead("Scenes, virtual camera and recording of the OBS instances this dashboard set up.")}<div class="empty">${ic("VideoOutline")}<span class="t">No OBS is set up yet</span><span class="p-help">Ask the agent to set up OBS, or run this on the OBS computer:</span><code>pi-obs provision</code>${btn("secondary sm", "Copy command", "ContentCopy")}</div>`) },
    { name: "provisioned + warnings", asbuilt: null, proposed: page(obsChrome, `${lead("Scenes, virtual camera and recording of the OBS instances this dashboard set up.")}${item({ title: "studio-mac", pills: pill("success", "Running"), actions: btn("secondary sm", "Open OBS panel", "OpenInNew"), body: `${facts([["Password", "Accepted"], ["OBS version", "31.0.2"]])}${notice("warning", "obs-websocket listens on all network interfaces. Block its port for other computers in the firewall.")}${notice("warning", "Crash recovery is paused. Answer OBS's prompt on that computer, then run <code>pi-obs launch --reset-recovery</code>.", btn("secondary sm", "Copy command", "ContentCopy"))}` })}${item({ title: "living-room", pills: pill("error", "Password rejected"), actions: btn("secondary sm", "Open OBS panel", "OpenInNew"), body: notice("error", "OBS rejected the saved password. Set it up again with <code>pi-obs provision --update</code>.", btn("secondary sm", "Copy command", "ContentCopy")) })}`) },
    { name: "load error", asbuilt: null, proposed: page(obsChrome, notice("error", "Could not read the OBS status. The dashboard server did not answer.", btn("secondary sm", "Try again", "Refresh"))) },
  ],
});

/* ═══ MCP CLIENT ═══ */
const mcpChrome = { title: "MCP Client", id: "mcp-client", icon: "Connection", requiredBy: ["apple-tools"] };
const mcpRow = (name, desc, pills, on = true) => item({ title: `<span style="display:inline-flex;gap:8px;align-items:center"><button role="switch" class="sw" aria-checked="${on}" aria-label="Use ${name} in sessions"></button>${name}</span>`, sub: desc, pills, actions: btn("secondary sm", "Edit", "PencilOutline") });
SURFACES.push({
  id: "mcp-client", title: "MCP Client", verdict: "polish", icon: "Connection",
  lead: "McpSettings.tsx + ServerList.tsx + ServerEditor.tsx — rows of 10 px tertiary words, `--accent-primary` and `amber-500` text, two equal “Add server” buttons.",
  finds: [
    ["MC1", "Two “Add server” buttons (toolbar + empty state), neither primary → one primary per state; toolbar keeps Refresh."],
    ["MC2", "Row metadata = 10 px tertiary words, raw live enum (`needs-auth`) → neutral pills for transport/exposure + a live status pill."],
    ["MC3", "`--accent-primary` / `amber-500` text (badge, docs link, warnings) → `p-link`, severity pills/notices."],
    ["MC4", "Editor labels = raw schema keys (`oauth.clientSecret`), no hints → kit fields with human labels + key chip (follow-up, editor only re-skinned here)."],
    ["MC5", "“MCP servers” h3 near-repeats the host title → section heading recipe 12 px."],
  ],
  states: [
    { name: "empty (live)", asbuilt: "mcp-client", proposed: page(mcpChrome, `<div class="empty">${ic("Connection")}<span class="t">No MCP servers yet</span><span class="p-help">Add a server to give sessions its tools. Servers are shared by every pi session on this computer.</span><div class="actions">${btn("primary", "Add server", "Plus")}<a class="p-link" href="#">${ic("OpenInNew")}How MCP configuration works</a></div></div>`) },
    { name: "populated", asbuilt: null, proposed: page(mcpChrome, `<div class="actions" style="justify-content:space-between"><h4 class="sec" style="margin:0">Servers · 3</h4><span class="actions">${btn("ghost sm", "Refresh", "Refresh")}${btn("primary", "Add server", "Plus")}</span></div>
      ${mcpRow("imcp", "Apple Calendar, Contacts, Reminders", pill("neutral", "command") + pill("neutral", "direct tools") + pill("success", "Connected · 14 tools"))}
      ${mcpRow("github", "GitHub issues and PRs", pill("neutral", "url") + pill("neutral", "OAuth") + pill("warning", "Sign-in needed") + `<code>/mcp login github</code>`)}
      ${mcpRow("sqlite", "", pill("neutral", "command") + pill("neutral", "Not checked by pi"), false)}
      ${notice("warning", "<code>~/.pi/agent/mcp.json</code> line 14: unexpected token. pi skips this file until it is fixed.")}`) },
  ],
});
