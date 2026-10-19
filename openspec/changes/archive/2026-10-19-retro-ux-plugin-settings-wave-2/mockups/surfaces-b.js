/* Surfaces B — form pages (automation, blackhole, cost, grammar, quota,
   system-one, goal, flows, subagents). Finding ids → ui-plan.md. */

/* ═══ AUTOMATIONS ═══ */
const auChrome = { title: "Automations", id: "automation", icon: "Robot" };
const auBody = (modelV) => `${lead("Defaults for every automation, in all folders.")}
  ${group("Runs", `${field({ label: "New runs on the board", hint: "Hidden runs stay off the session board; watch them in Automations.", control: sel(["Hidden", "Shown"], "Hidden"), state: "default" })}
    ${field({ label: "Runs to keep", unit: "per automation", hint: "Older runs are deleted. Minimum 1.", control: num(100), state: "default" })}`, { meta: "2 fields" })}
  ${group("Where automations are found", `${field({ label: "Folder automations", hint: "Reads <code>&lt;repo&gt;/.pi/automation/</code> in every tracked folder.", control: sw(true) })}
    ${field({ label: "Global automations", hint: "Reads <code>~/.pi/automation/</code>.", control: sw(true) })}`, { meta: "2 fields" })}
  ${group("Model", field({ label: "Fallback model", hint: modelV ? "Used when an automation asks for a <code>@role</code> that has no model." : "Used when an automation asks for a <code>@role</code> that has no model. No models are available yet.", control: modelV ? model(modelV) + btn("ghost sm icon", "", "Close", 'aria-label="Clear fallback model"') : model(""), state: modelV ? "changed" : "default" }) + (modelV ? "" : notice("info", "Add a provider to pick a model.", btn("secondary sm", "Open Providers"))), { meta: "1 field" })}`;
SURFACES.push({
  id: "automation", title: "Automations", verdict: "redesign", icon: "Robot",
  lead: "AutomationSettings.tsx — host Save bar already used (keep); everything else native and un-hinted.",
  finds: [
    ["AU1", "Native select / number / checkboxes, no hints, no `aria-describedby` → kit fields with hints."],
    ["AU2", "Explanations crammed into option labels (“hidden (off the board, watch in Automations)”) → short options + hint."],
    ["AU3", "Paths in labels as `<code>`, i18n string split mid-phrase “(fallback for unresolved @role)” → label + hint."],
    ["AU4", "Retention silently snaps to 100 on bad input → field error “Enter 1 or more.”"],
    ["AU5", "Model label is a `<span>` not tied to the picker → `FieldShell` custom control."],
  ],
  states: [
    { name: "populated (live)", asbuilt: "automation", proposed: page(auChrome, auBody("anthropic/claude-haiku-5-5")) },
    { name: "no models available", asbuilt: null, proposed: page(auChrome, auBody("")) },
  ],
});

/* ═══ BLACKHOLE ═══ */
const bhChrome = { title: "Blackhole", id: "blackhole", icon: "DatabaseOutline" };
const bhFile = `<div class="filechip">File <code>~/.pi/agent/pi-blackhole/pi-blackhole-config.json</code>${pill("neutral", "3 unmanaged keys kept")}</div>`;
const bhNote = notice("info", "pi-blackhole re-reads this file after every save, so running sessions pick up changes on their own. Keys this page does not manage are kept.");
const bhChain = (worker, desc, rows) => `${sec(`${worker} · ${desc}`)}<ol class="chain">${rows.map(([m, p], i) => `<li><span class="n">${i + 1}</span>${i === 0 ? pill("neutral", "Primary") : ""}<span class="m">${m}</span><span class="prov">${p}</span><span class="grow"></span>${btn("ghost sm icon", "", "ArrowUp", `aria-label="Move ${m} up" ${i === 0 ? "disabled" : ""}`)}${btn("ghost sm icon", "", "ArrowDown", `aria-label="Move ${m} down" ${i === rows.length - 1 ? "disabled" : ""}`)}${rows.length > 1 ? btn("ghost sm icon danger-ghost", "", "DeleteOutline", `aria-label="Remove ${m}"`) : ""}</li>`).join("")}</ol>
  <div class="actions">${btn("secondary sm", `Add model`, "Plus")}<span class="reason">then base model <code>muse-spark-1.3</code> → session model (off)</span></div>`;
const bhWorkers = (state) => group("Worker models", `<p class="p-help">Each worker tries its models top to bottom. A model that fails with a retryable error is skipped for its cooldown.</p>
  ${state === "empty" ? notice("warning", "No models with credentials yet. Add a provider key to choose models.", btn("secondary sm", "Open Providers")) : ""}
  ${field({ label: "Base model", key: "model", hint: "Shared fallback for every worker, before the session model.", control: model("opencode-go/muse-spark-1.3-contributor"), state: "changed", reset: true })}
  ${notice("info", "Recommended defaults: up to 3 fast models from different providers for each worker, plus debug logging.", btn("secondary sm", "Use recommended defaults"))}
  ${bhChain("Observer", "extracts facts, runs most often", [["muse-spark-1.3-contributor", "opencode-go"], ["gemini-3.8-flash", "google-vertex"], ["deepseek-v4-flash", "opencode-go"]])}
  ${bhChain("Reflector", "distils observations", [["muse-spark-1.3-contributor", "opencode-go"]])}`, { meta: "3 chains" });
SURFACES.push({
  id: "blackhole", title: "Blackhole", verdict: "redesign", icon: "DatabaseOutline",
  lead: "BlackholeSettings.tsx + ChainEditor.tsx (913 lines) — host Save bar used correctly (keep); own field anatomy, accent text, group titles touch the border; plugin missing from @source.",
  finds: [
    ["BH1", "Group summaries flush on the border, no chevron → kit `SettingsGroup` (padding, chevron, 44 px)."],
    ["BH2", "20 fields with own `FieldRow` (`<span>` label, 11.5 px help, 10 px DEFAULT) → kit fields with key chip + Default pill + Reset."],
    ["BH3", "`--accent-green` path chip, `--accent-red` errors/✕, `--accent-blue` staged notice → neutral chip, severity tokens, danger-ghost icon button."],
    ["BH4", "Apply note box has no icon/severity → `SettingsNotice` info."],
    ["BH5", "Retry button inside a `<summary>`; ✕ / ⚠️ glyphs as icons → actions moved into the notice; mdi icons."],
    ["BH6", "Raw `503`, parser message in red `<pre>`, raw save error → human text + Copy details."],
    ["BH7", "Chain rows: 10 px PRIMARY, ✕ in accent red → 11 px neutral pill; 32 px icon buttons with names."],
  ],
  states: [
    { name: "populated (live)", asbuilt: "blackhole", proposed: page(bhChrome, `${lead("Compaction and observational memory for the <code>pi-blackhole</code> extension.")}${bhFile}${bhNote}
      ${group("Compaction", "", { open: false, meta: "4 fields" })}${group("Observational memory", "", { open: false, meta: "2 fields" })}${group("Trigger thresholds", "", { open: false, meta: "3 fields" })}${group("Token budgets", "", { open: false, meta: "7 fields" })}${group("Runtime & diagnostics", "", { open: false, meta: "4 fields" })}${bhWorkers("ok")}`) },
    { name: "group open + invalid value", asbuilt: null, proposed: page(bhChrome, `${bhFile}${group("Trigger thresholds", `${field({ label: "Observe after", unit: "tokens", key: "observeAfterTokens", hint: "Start observing once the context holds this many tokens.", control: num(0), error: "Enter a whole number of 1 or more.", state: "changed", reset: true })}
      ${field({ label: "Reflect after", unit: "tokens", key: "reflectAfterTokens", hint: "Distil observations once they reach this size.", control: num(40000), state: "default" })}
      ${field({ label: "Compact after", unit: "tokens", key: "compactAfterTokens", hint: "Compact the conversation at this size.", control: num(120000), state: "default" })}`, { meta: "3 fields" })}
      ${group("Observational memory", `${field({ label: "Memory workers", key: "memory", hint: "Run the observer, reflector and dropper in the background.", control: sw(true), state: "default" })}${field({ label: "Fall back to the session model", key: "sessionFallback", hint: "Use the session's own model when every worker model fails.", control: sw(false), state: "default" })}`, { meta: "2 fields" })}`, 1) },
    { name: "file can't be parsed", asbuilt: null, proposed: page(bhChrome, `${bhFile}${notice("error", "<strong>The config file can't be read, so editing is off.</strong><br>Fix the file by hand, then check again. Line 12: unexpected <code>}</code>.", btn("secondary sm", "Check again", "Refresh") + btn("ghost sm", "Copy details", "ContentCopy"))}`) },
    { name: "not installed", asbuilt: null, proposed: page(bhChrome, notice("info", "<strong>pi-blackhole is not installed.</strong><br>Install it, then reload this page:<br><code>pi install npm:pi-blackhole</code>", btn("secondary sm", "Copy command", "ContentCopy"))) },
  ],
});

/* ═══ COST ═══ */
const coChrome = { title: "Cost", id: "cost-estimator", icon: "CashMultiple" };
const coBody = (plan, custom) => `${lead("Sessions are priced at metered API rates. If you pay for a subscription instead, pick it here so cost reports show what you really pay.")}
  ${field({ label: "Subscription", hint: "The plan each seat is on. Metered keeps API prices.", control: sel(["Metered (pay as you go)", "Claude Pro · $20", "Claude Max 5× · $100", "Claude Max 20× · $200", "ChatGPT Plus · $20", "ChatGPT Pro · $200", "GLM Coding Pro · $72", "Custom…"], plan), state: plan.startsWith("Metered") ? "default" : "changed" })}
  ${custom ? field({ label: "Price per seat", unit: "USD / month", hint: "What one seat costs per month.", control: num(""), error: "Enter a price of 0 or more." }) : ""}
  ${field({ label: "Seats", hint: "How many people share the plan.", control: num(1), state: "default" })}
  ${field({ label: "Break after", unit: "min", hint: "Idle gaps longer than this don't count as active time. 1–120.", control: num(15), state: "default" })}`;
SURFACES.push({
  id: "cost-estimator", title: "Cost", verdict: "redesign", icon: "CashMultiple",
  lead: "CostEstimator.tsx — controls have no class at all, so Tailwind preflight strips their border: “Seats 1” reads as plain text. Writes config on every keystroke.",
  finds: [
    ["CO1", "Borderless native select/number (preflight `border:0`) → kit controls; inputs look editable."],
    ["CO2", "Intro at `opacity:.65` 11 px → lead 12 px `--text-secondary`."],
    ["CO3", "No hints; “Break threshold” unexplained → hint “Idle gaps longer than this don't count as active time.”"],
    ["CO4", "Writes `plugin_config_write` per keystroke, clearing writes 0 (below min) → host Save bar draft + field errors (D4)."],
    ["CO5", "Fallback `?? anthropic-max-20x` shows a plan that isn't stored → show the stored value; unset = Metered (default pill)."],
  ],
  states: [
    { name: "plan (live)", asbuilt: "cost-estimator", proposed: page(coChrome, coBody("Claude Max 20× · $200", false)) },
    { name: "custom plan, invalid", asbuilt: null, proposed: page(coChrome, coBody("Custom…", true), 2) },
  ],
});

/* ═══ GRAMMAR ═══ */
const grChrome = { title: "Grammar & Spelling", id: "grammar", icon: "Spellcheck" };
const grGeneral = group("Checking", `${field({ label: "Check grammar in the composer", hint: "Underlines mistakes in the message box. The check runs on the server with the model below.", control: sw(true), state: "changed" })}
  ${field({ label: "Check while typing", hint: "Off = check only when you ask.", control: sw(true), state: "default" })}
  ${field({ label: "Show corrections as", hint: "Redline marks changes inline; List shows them under the box.", control: sel(["Redline (inline)", "List"], "Redline (inline)"), state: "default" })}
  ${field({ label: "Capitalise sentence starts", hint: null, control: sw(false), state: "default" })}`, { meta: "4 fields" });
const grModel = (set) => group("Model", `${field({ label: "Model", hint: `Decides quality, speed and cost. <a class="p-link" href="#">${ic("OpenInNew")}Which models work well?</a>`, control: model(set ? "claude-haiku-5-5" : "", set ? "@fast" : ""), state: set ? "changed" : undefined })}
  ${set ? "" : notice("warning", "Pick a model. Grammar checks can't run until one is set.")}
  <details class="sf-grp"><summary>${ic("ChevronRight", "chev")}Recommended models<span class="meta">4</span></summary><div class="sf-body">${table(["Model", "", "Notes"], [["<code>claude-haiku-5-5</code>", pill("success", "Recommended"), "100% recall, ~2.5 s, no style churn"], ["<code>gemini-3.8-flash</code>", "", "Balanced, ~4.7 s"], ["<code>muse-spark-1.3</code>", "", "Fastest, ~1 s; may add markdown"], ["<code>gpt-6-mini</code>", "", "Solid alternative, ~3.5 s"]])}<p class="p-help">Avoid reasoning models (slow) and <code>ministral-8b</code> (misses 22%).</p></div></details>`, { meta: "1 field" });
const grAdv = (err) => group("Advanced", `${field({ label: "Wait after typing", unit: "ms", hint: "300–10 000.", control: num(1200), state: "default" })}
  ${field({ label: "Shortest text", unit: "chars", hint: "Shorter messages are not checked.", control: num(err ? 5000 : 12), state: err ? "changed" : "default", error: err ? "Must be less than the longest text (4 000)." : "" })}
  ${field({ label: "Longest text", unit: "chars", hint: "Longer messages are not checked.", control: num(4000), state: "default" })}
  ${field({ label: "Language", hint: "BCP-47 tag such as <code>en-GB</code>, or <code>auto</code>.", control: `<input id="%ID" class="p-input num mono" value="auto" aria-describedby="%DESC">`, state: "default" })}`, { open: !!err, meta: "4 fields" });
SURFACES.push({
  id: "grammar", title: "Grammar & Spelling", verdict: "redesign", icon: "Spellcheck",
  lead: "GrammarSettings.tsx — host Save bar used (keep); plugin missing from @source so `px-3.5` never compiles and group content touches the border.",
  finds: [
    ["GR1", "Repeats title + `grammar` id (10 px muted) → removed (D3)."],
    ["GR2", "Group content flush on the border (missing `@source`), static ▸ caret → kit `SettingsGroup` (D6)."],
    ["GR3", "“Enabled” duplicates the host switch → “Check grammar in the composer”."],
    ["GR4", "Native controls, no hints; “Model” `<span>` unlinked → kit fields."],
    ["GR5", "9.5–10.5 px text in the recommended list, `--text-muted` help → table at 12 px, severity pill."],
    ["GR6", "No min < max check; load error swallowed; raw “grammar config save failed (500)” → field error, load-error notice, human save error."],
  ],
  states: [
    { name: "populated (live)", asbuilt: "grammar", proposed: page(grChrome, `${lead("Grammar and spelling checks for the message composer.")}${grGeneral}${grModel(true)}${grAdv(false)}`) },
    { name: "no model", asbuilt: null, proposed: page(grChrome, `${grGeneral}${grModel(false)}`) },
    { name: "invalid advanced value", asbuilt: null, proposed: page(grChrome, grAdv(true), 1) },
    { name: "load error", asbuilt: null, proposed: page(grChrome, notice("error", "Could not load the grammar settings. Showing defaults; saving is off until they load.", btn("secondary sm", "Try again", "Refresh"))) },
  ],
});

/* ═══ QUOTA ═══ */
const quChrome = { title: "Provider Quota", id: "quota", icon: "Gauge" };
const quProv = (name, on, st) => field({ label: name, hint: null, control: `<span style="display:inline-flex;gap:8px;align-items:center">${st || ""}${sw(on).replace("<span class=\"sw-word\" aria-hidden=\"true\">" + (on ? "On" : "Off") + "</span>", "")}</span>` });
const quRetry = (on) => group("Retries", `${field({ label: "Retry failed checks", hint: "On HTTP 429/5xx, timeouts and network errors.", control: sw(on), state: on ? "changed" : "default" })}
  ${field({ label: "Max retries", hint: "0–5.", control: num(3, !on), state: "default", disabled: !on })}
  ${field({ label: "First wait", unit: "ms", hint: "Doubles after each retry. 100–10 000.", control: num(1000, !on), state: "default", disabled: !on })}
  ${field({ label: "Longest wait", unit: "ms", hint: "100–60 000.", control: num(60000, !on), state: "default", disabled: !on })}
  ${on ? notice("info", "Worst case before a provider is marked unavailable: <strong>~37 s</strong> (1 s → 2 s → 4 s, plus each request's timeout). Providers that make several calls per try, such as Copilot, can take longer.") : ""}`, { meta: "4 fields" });
SURFACES.push({
  id: "quota", title: "Provider Quota", verdict: "redesign", icon: "Gauge",
  lead: "QuotaSettings.tsx — host Save bar used (keep); inline styles, nested card, ToS warning only in a tooltip, 10 px status words; plugin missing from @source.",
  finds: [
    ["QU1", "Repeats title + id inside a bordered card → removed (D3)."],
    ["QU2", "“Enable quota tracking” duplicates the host switch → “Check quotas” with a hint."],
    ["QU3", "ToS warning = 10 px `#fbbf24` “⚠ Warning”, body only in `title` (keyboard/touch can't read it) → visible warning notice above the provider list."],
    ["QU4", "Provider reasons 10 px muted → status pills (Signed in · Not signed in · Refused · No quota)."],
    ["QU5", "Native checkboxes + inline-styled number inputs, ms in label text → kit switches + `NumberField` with unit chips + ranges in hints."],
    ["QU6", "Schedule preview 10 px muted → info notice, 12 px."],
  ],
  states: [
    { name: "populated (live)", asbuilt: "quota", proposed: page(quChrome, `${field({ label: "Check quotas", hint: "Shows remaining quota in the composer. Turn off to stop all checks; the plugin stays on.", control: sw(true), state: "default" })}
      ${group("Providers", `${notice("warning", "Quota checks call undocumented provider endpoints that may break the provider's terms. Use for personal, local setups only.")}
        ${quProv("Anthropic", true, pill("success", "Signed in"))}${quProv("Codex", true, pill("success", "Signed in"))}${quProv("OpenCode Go", true, pill("warning", "Request refused"))}${quProv("OpenRouter", true, pill("neutral", "Not signed in"))}${quProv("Synthetic", true, pill("neutral", "Not signed in"))}${quProv("Z.ai", true, pill("neutral", "No quota reported"))}${quProv("Copilot", false)}${quProv("Kimi Code", false)}`, { meta: "6 of 8 on" })}
      ${quRetry(false)}`) },
    { name: "retries on", asbuilt: null, proposed: page(quChrome, quRetry(true), 1) },
  ],
});

/* ═══ SYSTEM-ONE ═══ */
const s1Chrome = { title: "Decision models", id: "system-one", icon: "Brain" };
SURFACES.push({
  id: "system-one", title: "Decision models (System 1)", verdict: "polish", icon: "Brain",
  lead: "SystemOneSettings.tsx — newest design of the set, already uses severity tokens and the host Save bar; needs hierarchy and error-copy polish.",
  finds: [
    ["S1-1", "`<h3>` “Decision models (System 1)” repeats the host title → removed; lead + file chip stay (D3)."],
    ["S1-2", "Four elevated cards inside the host card → kit `SettingsGroup`s (no nested shadows)."],
    ["S1-3", "Every button same `smBtn` → hierarchy: Remove backend = danger-ghost, Run test = primary inside its group only."],
    ["S1-4", "Raw codes: “Could not load the System-1 config (E_PARSE)”, key-save `ApiError.code`, literal “error” → human text + Copy details."],
    ["S1-5", "Bad backend id/URL sets `aria-invalid` with no message → field error text."],
    ["S1-6", "Native select “No more backends” + “Add to chain” → keep, kit `SelectField` styling."],
  ],
  states: [
    { name: "populated (live)", asbuilt: "system-one", proposed: page(s1Chrome, `${lead("Small, fast models that answer yes/no and pick-one questions for other dashboard features. Answers stay advisory until you test a backend and save it as enforced.")}<div class="filechip">File <code>~/.pi/agent/system-one.json</code></div>
      ${group("Where data may go", field({ label: "Allow off-machine backends", hint: "Off. Session text goes only to backends on this computer (127.0.0.1). Off-machine backends are skipped and can't be tested.", control: sw(false) }))}
      ${group("Preset", `<div class="radio-cards" role="radiogroup" aria-label="Active preset"><div class="radio-card" role="radio" aria-checked="false"><span><span class="t">hosted</span><br><span class="p-help">empty chain</span></span></div><div class="radio-card" role="radio" aria-checked="true"><span><span class="t">local-only</span><br><span class="p-help">von</span></span></div></div>
        ${sec("Default chain for local-only")}<ol class="chain"><li><span class="n">1</span><span class="m">von</span>${pill("success", "On this computer", "HomeOutline")}<span class="grow"></span>${btn("ghost sm icon danger-ghost", "", "DeleteOutline", 'aria-label="Remove von"')}</li></ol>
        ${field({ label: "Add backend to chain", hint: "Only backends allowed by the switch above are listed.", control: sel(["No more backends"], "No more backends") + btn("secondary sm", "Add", "Plus", "disabled") })}`, { meta: "local-only" })}
      ${group("Backends", item({ title: "von", sub: "<code>managed von</code>", pills: pill("success", "On this computer", "HomeOutline") + pill("neutral", "Stopped"), actions: btn("secondary sm", "Start", "Play") + btn("ghost sm danger-ghost", "Remove", "DeleteOutline"), body: facts([["Context", "8 192 tokens"], ["Options", "unknown"], ["Language", "en"]]) }) + `<div class="actions">${btn("secondary sm", "Add backend", "Plus")}</div>`, { meta: "1" })}
      ${group("Consumers", item({ title: "<code>system-one:selftest</code>", pills: pill("neutral", "Fail-closed") + pill("neutral", "Shadow"), sub: "Preset chain" }), { meta: "1" })}`) },
    { name: "load error", asbuilt: null, proposed: page(s1Chrome, notice("error", "Could not read <code>system-one.json</code>. The file may be damaged.", btn("secondary sm", "Try again", "Refresh") + btn("ghost sm", "Copy details", "ContentCopy"))) },
    { name: "changed on disk", asbuilt: null, proposed: page(s1Chrome, notice("error", "Not saved: <code>system-one.json</code> changed on disk after this page loaded. Reload to get the current file, then redo your edits.", btn("secondary sm", "Reload", "Refresh")), 2) },
  ],
});

/* ═══ GOAL / FLOWS / SUBAGENTS — single-toggle pages ═══ */
SURFACES.push({
  id: "goal", title: "Goal", verdict: "polish", icon: "FlagOutline",
  lead: "GoalPluginSettings.tsx — one per-browser preference stored in localStorage; native checkbox, muted text.",
  finds: [
    ["GO1", "Native checkbox, label/hint inside one `<label>` → kit `ToggleField`."],
    ["GO2", "Install hint in `--text-muted` → lead in `--text-secondary`."],
    ["GO3", "Setting lives in localStorage but the UI doesn't say so → “This browser only” pill; stays immediate (D4 exception)."],
  ],
  states: [{ name: "default (live)", asbuilt: "goal", proposed: page({ title: "Goal", id: "goal", icon: "FlagOutline" }, `${lead("The goal loop, judge model and turn budget come from the <code>@ricoyudog/pi-goal-hermes</code> pi extension. This plugin shows its status on session cards. Start a goal in a session with <code>/goal &lt;objective&gt;</code>.")}
    ${field({ label: "Auto-restart new goals", hint: "When a goal's session dies, start a new one to keep going — limited by the turn budget and a crash-loop breaker. Each goal can override this. Saved in this browser only.", control: `${pill("neutral", "This browser")}${sw(false)}` })}`) }],
});
SURFACES.push({
  id: "flows", title: "Flows", verdict: "polish", icon: "SitemapOutline",
  lead: "FlowsSettings.tsx — host Save bar used (keep); hard-coded English, native checkbox, label + description joined by an em-dash.",
  finds: [
    ["FL1", "Native checkbox, em-dash label → kit `ToggleField` with a short label + hint."],
    ["FL2", "Intro/hint hard-coded English, `--text-muted` → `t()`, `--text-secondary`."],
    
  ],
  states: [{ name: "default (live)", asbuilt: "flows", proposed: page({ title: "Flows", id: "flows", icon: "SitemapOutline", requiredBy: ["flows-anthropic-bridge"] }, `${lead("Multi-agent workflows. This is the default for every session.")}
    ${field({ label: "Edit mode", hint: "Lets the main session create and change flows and agents: turns on <code>flow_agents</code> / <code>flow_write</code> and the edit-flow skill.", control: sw(false), state: "default" })}`) }],
});
SURFACES.push({
  id: "subagents", title: "Subagent Inspector", verdict: "polish", icon: "AccountOutline",
  lead: "SubagentsSettings.tsx — host Save bar used (keep); grey notice without icon, all text 11 px tertiary, internal package name in the intro.",
  finds: [
    ["SA1", "Roles notice = grey box, no icon/role, 7 i18n fragments, “Roles” not a link → `SettingsNotice` info + “Open Model roles” button."],
    ["SA2", "Intro shows internal package `pi-dashboard-subagents` → plain lead."],
    ["SA3", "11 px tertiary text + native checkbox → kit `ToggleField`, 12 px secondary hint."],
    ["SA4", "Save error “HTTP 500: {body}” → human message (host Save bar)."],
  ],
  states: [{ name: "default (live)", asbuilt: "subagents", proposed: page({ title: "Subagent Inspector", id: "subagents", icon: "AccountOutline" }, `${lead("How sessions start subagents.")}
    ${notice("info", "The bundled Explore agent uses <code>@fast</code>. Give <code>@fast</code> a model in Model roles, otherwise agents that use roles report “not configured yet”.", btn("secondary sm", "Open Model roles"))}
    ${field({ label: "Share the parent conversation", hint: "On: each subagent gets a compressed copy of the parent's recent turns. Off: each starts with an empty conversation.", control: sw(true), state: "default" })}`) }],
});
