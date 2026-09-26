// Mockup behaviour: theme toggle, agents-configured toggle, WAI-ARIA APG menu button
// (https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/) with per-folder memory.
const $ = (s) => document.querySelector(s);

$("#themeBtn").addEventListener("click", (e) => {
  const html = document.documentElement;
  const light = html.dataset.theme !== "light";
  html.dataset.theme = light ? "light" : "dark";
  e.currentTarget.textContent = light ? "Dark theme" : "Light theme";
  e.currentTarget.setAttribute("aria-pressed", String(light));
});

const split = $("[data-split]");
$("#agentsToggle").addEventListener("change", (e) => {
  split.classList.toggle("no-agents", !e.target.checked);
  closeMenu(menuBtn, menu);
});

function wireMenu(btn, list, onPick) {
  const items = () => [...list.querySelectorAll('[role^="menuitem"]')];
  const open = (focusLast) => {
    list.hidden = false; btn.setAttribute("aria-expanded", "true");
    const its = items(); const checked = its.find((i) => i.getAttribute("aria-checked") === "true");
    (focusLast ? its[its.length - 1] : checked || its[0]).focus();
  };
  btn.addEventListener("click", () => (list.hidden ? open(false) : closeMenu(btn, list)));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); open(false); }
    if (e.key === "ArrowUp") { e.preventDefault(); open(true); }
  });
  list.addEventListener("keydown", (e) => {
    const its = items(); const i = its.indexOf(document.activeElement);
    const go = (n) => { e.preventDefault(); its[(n + its.length) % its.length].focus(); };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(its.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") { closeMenu(btn, list); if (e.key === "Escape") btn.focus(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(document.activeElement); closeMenu(btn, list); btn.focus(); }
  });
  list.addEventListener("click", (e) => {
    const it = e.target.closest('[role^="menuitem"]'); if (!it) return;
    onPick(it); closeMenu(btn, list); btn.focus();
  });
  document.addEventListener("click", (e) => { if (!list.hidden && !list.contains(e.target) && !btn.contains(e.target)) closeMenu(btn, list); });
}
function closeMenu(btn, list) { list.hidden = true; btn.setAttribute("aria-expanded", "false"); }

const menuBtn = $("#spawnMenuBtn"), menu = $("#spawnMenu");
const KEY = "pi-dashboard:spawn-agent:~/Project/pi-agent-dashboard";
function select(item) {
  menu.querySelectorAll('[role="menuitemradio"]').forEach((i) => i.setAttribute("aria-checked", String(i === item)));
  const name = item.dataset.name;
  $("#agentLabel").textContent = item.dataset.agent === "pi" ? "" : `· ${name}`;
  $("#spawnMain").setAttribute("aria-label", `New ${name} session`);
  $("#spawnMain").title = `New ${name} session`;
  try { localStorage.setItem(KEY, item.dataset.agent); } catch {}
}
wireMenu(menuBtn, menu, select);
const remembered = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
select(menu.querySelector(`[data-agent="${remembered || "qmt"}"]`) || menu.querySelector('[data-agent="pi"]'));

$("#spawnMain").addEventListener("click", () => {
  const b = $("#spawnMain"); const cur = menu.querySelector('[aria-checked="true"]').dataset.name;
  const agentsOn = !split.classList.contains("no-agents");
  b.disabled = true; $("#spawnStatus").textContent = `Starting ${agentsOn ? cur : "pi"} session…`;
  setTimeout(() => { b.disabled = false; $("#spawnStatus").textContent = `${agentsOn ? cur : "pi"} session started.`; }, 1200);
});

wireMenu($("#cardMenuBtn"), $("#cardMenu"), () => {});

// S6: model row + skill availability follow the agent choice
function syncAgent() {
  const acp = $("#autoAgent").value !== "pi";
  $("#modelNote").textContent = acp ? "Chosen by the agent's own settings." : "Uses the pi default model unless a role is set.";
  $("#kindSkill").disabled = acp;
  $("#skillWhy").hidden = !acp;
  $("#autoAgentHelp").hidden = !acp;
}
$("#autoAgent").addEventListener("change", syncAgent); syncAgent();

// S7: worktree dialog agent field
const AGENT_NAMES = { pi: "", qmt: "querymt", claude: "Claude Agent" };
function syncWt() {
  const agentsOn = !split.classList.contains("no-agents");
  $("#wtAgentField").classList.toggle("hidden", !agentsOn);
  const id = agentsOn ? $("#wtAgent").value : "pi";
  const name = AGENT_NAMES[id];
  document.querySelectorAll(".wt-agent").forEach((e) => { e.textContent = name; });
  document.querySelectorAll(".wt-spawn").forEach((b) => b.setAttribute("aria-label", `Spawn ${name || "pi"} session in ${b.dataset.path}`));
  $("#wtSubmit").textContent = name ? `Create + ${name} session →` : "Create + session →";
}
$("#wtAgent").addEventListener("change", syncWt);
$("#agentsToggle").addEventListener("change", syncWt);
$("#worktreeBtn").addEventListener("click", () => {
  $("#wtAgent").value = menu.querySelector('[aria-checked="true"]').dataset.agent; // inherit tray choice
  syncWt(); $("#s7h").focus(); $("#s7").scrollIntoView({ block: "start" });
});
document.querySelectorAll(".wt-spawn").forEach((b) => b.addEventListener("click", () => {
  $("#wtStatus").textContent = `Starting ${AGENT_NAMES[$("#wtAgent").value] || "pi"} session in ${b.dataset.path}…`;
}));
syncWt();

// S8: goal detail — label says pi only when agents exist; ACP-omitted line only when agents exist
function syncGoal() {
  const agentsOn = !split.classList.contains("no-agents");
  $("#goalNewLabel").textContent = agentsOn ? "New pi session" : "New session";
  $("#goalOmitted").hidden = !agentsOn;
}
$("#agentsToggle").addEventListener("change", syncGoal);
$("#goalLinkBtn").addEventListener("click", (e) => {
  const l = $("#goalLinkList"); l.hidden = !l.hidden; e.currentTarget.setAttribute("aria-expanded", String(!l.hidden));
});
$("#goalNew").addEventListener("click", () => { $("#goalStatus").textContent = "Starting pi session for this goal…"; });
syncGoal();
