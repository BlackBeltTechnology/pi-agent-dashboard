"use strict";
/**
 * Driver of qa/tests/60-agent-teams-inproc-persistence.sh (test-plan #S103-#S106, tasks 13.5-13.8).
 * Env: QA_PORT_NODE, QA_BASE, QA_FAKE_EXT (fake subagents extension), QA_SCRATCH, QA_SERVER_LOG,
 *      QA_INPROC_SECTIONS (space-separated subset of "restart reload kill absent"),
 *      QA_INPROC_RESTART_RUN_MS (default 15000), QA_INPROC_KILL_WAIT_S (default 240).
 * See change: add-agent-teams-in-process.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createDrive, run, fail, sleep } = require("./agent-teams-inproc-drive.cjs");

const SCRATCH = process.env.QA_SCRATCH;
const SECTIONS = (process.env.QA_INPROC_SECTIONS || "restart reload kill absent").split(/\s+/).filter(Boolean);
const d = createDrive({ port: process.env.QA_PORT_NODE, base: process.env.QA_BASE, fakeExt: process.env.QA_FAKE_EXT });
const stateFile = (label) => path.join(SCRATCH, `${label}.state.json`);
const dupes = (xs) => xs.length !== new Set(xs).size;
const goneNames = (snap) => (snap.members || []).filter((m) => m.status === "gone").map((m) => m.name).sort();

// #S103 (13.5): the lead process and its in-process children outlive a server restart.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one linear scenario of independent assertions; splitting would scatter the row.
async function restart() {
  const file = stateFile("restart");
  const runMs = process.env.QA_INPROC_RESTART_RUN_MS || "15000";
  const ctx = await d.startInprocTeam("restart", { FAKE_SUBAGENTS_RUN_MS: runMs, FAKE_SUBAGENTS_STATE_FILE: file, FAKE_SUBAGENTS_PROGRESS_MS: "1000" });
  const completedBefore = (d.readJson(file) || { events: {} }).events["subagents:completed"] || 0;
  const t0 = Date.now();
  await d.restartServer();
  console.log(`restart: server back after ${Date.now() - t0} ms (children run ${runMs} ms; completed before restart: ${completedBefore})`);

  const after = await d.waitFor(() => {
    const t = d.snapOf(ctx.teamId);
    return t.status === "active" && t.leadConnected && t.members.length === 2 && t.members.every((m) => m.status === "idle") ? t : undefined;
  }, "the restarted server to hold the team open with both children settled idle", 90000);

  if (!d.alive(ctx.lead.pid) || ctx.lead.child.exitCode !== null) fail(`S103: the lead pid ${ctx.lead.pid} did not survive the server restart`);
  if (!d.sessionsIn(ctx.cwd).some((s) => s.id === ctx.leadId)) fail("S103: the lead session id changed or ended across the restart");
  if (after.closeReason) fail(`S103: the team carries closeReason ${after.closeReason}`);
  if (d.names(after).join() !== "alice,bob") fail(`S103: members after the restart are ${d.names(after).join()}`);
  const ids = after.mail.map((m) => m.id);
  if (dupes(ids)) fail("S103: duplicate mail ids after the restart");
  const unacked = after.mail.filter((m) => (m.to === "alice" || m.to === "bob") && m.ackedAt === undefined);
  if (unacked.length > 0) fail(`S103: queued mail was not flushed after the reconnect: ${JSON.stringify(unacked.map((m) => [m.id, m.to, m.kind]))}`);
  if (after.stats?.inproc_unknown_event) fail(`S103: the bridge reported unknown upstream events: ${after.stats.inproc_unknown_event}`);

  // The children ran inside the lead: each finished its ONE run exactly once, whichever side of the restart it fell on.
  const state = d.readJson(file);
  if (!state) fail("S103: the fake subagents state file was never written (extension not loaded?)");
  if ((state.events["subagents:completed"] || 0) !== 2) fail(`S103: expected exactly 2 completed runs in the lead, saw ${JSON.stringify(state.events)}`);
  if (state.activation !== 1) fail(`S103: the lead's subagents activation changed (${state.activation}): the lead runtime restarted`);
  console.log(`OK S103: lead pid ${ctx.lead.pid} unchanged; team active; alice+bob idle after their one run each; mail unique and acked; ${completedBefore === 2 ? "both children finished before the restart (outbox flush not exercised: raise QA_INPROC_RESTART_RUN_MS)" : "children finished across the restart"}`);
}

// #S104 (13.6): a reload of the lead closes the team (the children died with the old runtime).
async function reload() {
  const file = stateFile("reload");
  const ctx = await d.startInprocTeam("reload", { FAKE_SUBAGENTS_RUN_MS: "600000", FAKE_SUBAGENTS_STATE_FILE: file });
  await d.settleIdle(ctx.cwd, ctx.leadId);
  ctx.lead.prompt("[[faux:agent-teams-lead-task]] go"); // one task for the (busy) members: it stays pending
  await d.waitFor(() => d.snapOf(ctx.teamId).tasks.length >= 1, "the lead task to exist");
  await d.settleIdle(ctx.cwd, ctx.leadId);
  const before = d.snapOf(ctx.teamId);
  const maxMail = Math.max(0, ...before.mail.map((m) => m.id));
  const live = d.readJson(file);
  if (!live || Object.keys(live.children).length !== 2) fail(`S104: expected 2 live fake children before the reload, state=${JSON.stringify(live)}`);

  d.api("POST", `/api/session/${ctx.leadId}/prompt`, { text: "/reload" }); // what `npm run reload` sends (send_prompt /reload)
  const closed = await d.waitFor(() => {
    const t = d.snapOf(ctx.teamId);
    return t.status === "closed" ? t : undefined;
  }, "the team to close after the lead reloaded", 90000);

  if (closed.closeReason !== "lead_reloaded") fail(`S104: closeReason is ${closed.closeReason}, expected lead_reloaded`);
  if (goneNames(closed).join() !== "alice,bob") fail(`S104: members are not both gone: ${JSON.stringify(closed.members.map((m) => [m.name, m.status, m.goneReason]))}`);
  const wrongReason = closed.members.filter((m) => m.goneReason !== "lead_reloaded");
  if (wrongReason.length > 0) fail(`S104: member goneReason is not lead_reloaded: ${JSON.stringify(wrongReason.map((m) => [m.name, m.goneReason]))}`);
  const notPending = closed.tasks.filter((t) => t.status === "in_progress" || t.owner);
  if (notPending.length > 0) fail(`S104: tasks are not released to pending: ${JSON.stringify(notPending.map((t) => [t.id, t.status, t.owner]))}`);
  const notices = closed.mail.filter((m) => m.id > maxMail && m.kind === "notice");
  if (notices.length !== 1) fail(`S104: expected exactly one waking notice to the lead after the reload, saw ${notices.length}: ${JSON.stringify(notices.map((m) => [m.id, m.to, m.text.slice(0, 80)]))}`);
  if (!d.alive(ctx.lead.pid)) fail("S104: the lead process died on /reload");

  // "No leaked subagent children": the fake is the upstream list. The new runtime must hold none (activation advanced).
  const state = await d.waitFor(() => {
    const s = d.readJson(file);
    return s && s.activation >= 2 ? s : undefined;
  }, "the reloaded lead runtime to load the fake subagents extension again", 60000);
  if (Object.keys(state.children).length !== 0) fail(`S104: leaked subagent children after the reload: ${JSON.stringify(state.children)}`);
  console.log(`OK S104: team closed lead_reloaded; alice+bob gone lead_reloaded; tasks pending; one waking notice; upstream child list empty (activation ${state.activation})`);
}

// #S105 (13.7): kill -9 of the lead closes the team lead_ended; no orphan window, no leftover child process.
async function kill() {
  const ctx = await d.startInprocTeam("kill", { FAKE_SUBAGENTS_RUN_MS: "600000", FAKE_SUBAGENTS_STATE_FILE: stateFile("kill") });
  const before = d.descendants(ctx.lead.pid);
  const waitS = Number(process.env.QA_INPROC_KILL_WAIT_S || 240);
  const t0 = Date.now();
  process.kill(ctx.lead.pid, "SIGKILL");
  let sawOrphaned = false;
  const closed = await d.waitFor(
    () => {
      const t = d.snapOf(ctx.teamId);
      if (t.status === "orphaned") sawOrphaned = true;
      return t.status === "closed" ? t : undefined;
    },
    "the team to close after the lead was killed (the orphan TTL would be 30 minutes)",
    waitS * 1000,
    1000,
  );
  const elapsed = Math.round((Date.now() - t0) / 1000);
  if (sawOrphaned) fail("S105: the team went through `orphaned`: an in-process team has no orphan window");
  if (closed.closeReason !== "lead_ended") fail(`S105: closeReason is ${closed.closeReason}, expected lead_ended`);
  if (goneNames(closed).join() !== "alice,bob") fail(`S105: members are not both gone: ${JSON.stringify(closed.members.map((m) => [m.name, m.status, m.goneReason]))}`);
  if (d.alive(ctx.lead.pid)) fail("S105: the lead pid is still alive after SIGKILL");
  const leftovers = before.filter((p) => d.alive(p));
  if (leftovers.length > 0) fail(`S105: child OS processes of the lead survived it: ${leftovers.join(",")}`);
  console.log(`OK S105: kill -9 -> team closed lead_ended after ${elapsed} s (never orphaned); members gone; lead + ${before.length} descendant process(es) dead`);
}

// #S106 (13.8): the subagents package is absent -> session mode works, in-process is refused with the install hint.
async function absent() {
  const cwdA = d.mkDir("absent-session");
  const leadA = d.launchPi(cwdA); // NO fake extension, and the hermetic prefix has no subagents package
  const a = await d.waitFor(() => d.sessionsIn(cwdA)[0], "the session-mode lead to register");
  d.sessionIds.add(a.id);
  leadA.prompt("[[faux:agent-teams-lead-spawn]] go");
  const team = await d.waitFor(() => {
    const t = d.teamOf(cwdA);
    const m = t && d.memberOf(t, "alice");
    return m && m.status === "idle" ? t : undefined;
  }, "the session-mode team with an idle teammate alice");
  if (team.mode !== "session") fail(`S106: the default team mode is ${team.mode}, expected session`);
  const mem = d.memberOf(team, "alice");
  if (mem.sessionId) d.sessionIds.add(mem.sessionId);
  if (mem.childAgentId) fail("S106: a session-mode member carries a childAgentId");

  const cwdB = d.mkDir("absent-inproc");
  const leadB = d.launchPi(cwdB);
  const b = await d.waitFor(() => d.sessionsIn(cwdB)[0], "the second lead to register");
  d.sessionIds.add(b.id);
  await d.settleIdle(cwdB, b.id);
  leadB.prompt("[[faux:agent-teams-inproc-unavailable]] go");
  await d.waitFor(() => /INPROC_TOOL_RESULT:/.test(leadB.output()), "the lead to echo the TeamCreate result", 60000);
  const out = leadB.output();
  for (const needle of ["mode_unavailable", "subagents_extension_missing", "pi-dashboard-subagents"]) {
    if (!out.includes(needle)) fail(`S106: the in-process TeamCreate result lacks \`${needle}\` (install hint)`);
  }
  if (d.teamOf(cwdB, true)) fail("S106: a team exists although in-process was refused");

  // No crash / log spam at startup: the plugin may log, never error, and not once per event.
  const log = fs.readFileSync(process.env.QA_SERVER_LOG, "utf8").split("\n");
  const teamsLines = log.filter((l) => /agent-teams/i.test(l));
  const bad = teamsLines.filter((l) => /\b(error|unhandled|exception|ERR)\b/i.test(l));
  if (bad.length > 0) fail(`S106: agent-teams logged errors: ${bad.slice(0, 3).join(" | ")}`);
  if (teamsLines.length > 100) fail(`S106: agent-teams log spam (${teamsLines.length} lines)`);
  console.log(`OK S106: session team works (alice idle, mode session); in-process -> mode_unavailable + subagents_extension_missing + install hint; no team; ${teamsLines.length} agent-teams log line(s), 0 errors. (the Team view pill is asserted by tests/e2e/team/team-inproc.spec.ts)`);
}

const TABLE = { restart, reload, kill, absent };

run(d, async () => {
  for (const name of SECTIONS) {
    if (!TABLE[name]) fail(`unknown section ${name}`);
    console.log(`--- ${name} ---`);
    await TABLE[name]();
    await sleep(500);
  }
  console.log("ALL OK");
});
