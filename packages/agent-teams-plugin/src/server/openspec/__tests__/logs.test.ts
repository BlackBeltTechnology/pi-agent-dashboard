/**
 * Structured logs and counters (task 9.32 #S12, logging-helper part of 1.9): ids and codes only, no task text,
 * credentials redacted, one counter increment per event.
 * See change: add-agent-teams-openspec.
 */
import { describe, expect, it } from "vitest";
import { capturingLogger } from "../../../__tests__/harness/store-env.js";
import type { Team } from "../../../shared/types.js";
import { createPluginCounters } from "../../templates-hooks.js";
import { createOpenspecLog, OPENSPEC_COUNTERS, redactSecrets, safeField } from "../log.js";
import { seedCore } from "../seed-core.js";
import { createSidecarStore } from "../sidecar.js";
import { APPLY, createOpenspecEnv, tmp } from "./env.js";

const SECRET = "SECRET-TOKEN-123";

describe("redaction", () => {
  it.each([
    ["fatal: unable to access 'https://user:tok@host/x.git/'", "https://***@host/x.git/"],
    ["ssh://git:pw@example.com/r", "ssh://***@example.com/r"],
    ["Authorization: Bearer abc.def", "Bearer ***"],
    ["failed with token=abc123&x=1", "token=***&x=1"],
    ["password=hunter2", "password=***"],
  ])("%s", (input, expected) => {
    const out = redactSecrets(input);
    expect(out).toContain(expected);
    for (const secret of ["tok@", "pw@", "abc.def", "abc123", "hunter2"]) expect(out).not.toContain(secret);
  });

  it("a field value is single-line, capped and redacted", () => {
    const v = safeField(`line1\nline2\u001b[31m https://u:p@h/x ${"y".repeat(500)}`);
    expect(v).not.toMatch(/[\n\u001b]/);
    expect(v).not.toContain("u:p@");
    expect(v.length).toBeLessThanOrEqual(80);
    expect(safeField(7)).toBe("7");
    expect(safeField(true)).toBe("true");
  });
});

describe("log lines and counters", () => {
  it("one structured line per event with team, ids and codes; a counter increment per record", () => {
    const { logger, logs } = capturingLogger();
    const counters = createPluginCounters();
    const log = createOpenspecLog({ logger, counters });
    log.record("info", "launch", OPENSPEC_COUNTERS.launched, "t_1", { change: "add-x", member: "os-add-x" });
    log.record("warn", "launch_failed", OPENSPEC_COUNTERS.launchFailed, "t_1", { change: "add-x", code: "git_failed", detail: "fatal: https://user:tok@host/x.git" });
    expect(logs.info).toEqual(["agent-teams: openspec launch team=t_1 change=add-x member=os-add-x"]);
    expect(logs.warn[0]).toContain("code=git_failed");
    expect(logs.warn[0]).not.toContain("tok@");
    expect(counters.get(OPENSPEC_COUNTERS.launched, "t_1")).toBe(1);
    expect(counters.get(OPENSPEC_COUNTERS.launchFailed, "t_1")).toBe(1);
    expect(counters.get(OPENSPEC_COUNTERS.launched)).toBe(1);
    expect(counters.forTeam("t_1")).toEqual({ [OPENSPEC_COUNTERS.launched]: 1, [OPENSPEC_COUNTERS.launchFailed]: 1 });
  });

  it("undefined fields are omitted; a team-less event has no team field", () => {
    const { logger, logs } = capturingLogger();
    createOpenspecLog({ logger }).event("info", "sidecars_pruned", undefined, { n: 2, skipped: undefined });
    expect(logs.info).toEqual(["agent-teams: openspec sidecars_pruned n=2"]);
  });
});

describe("no task text and no secrets through seed, refusal and the lead notice (9.32 #S12)", () => {
  it("seeding tasks whose titles/descriptions carry a secret logs ids and counts only; the counter moves once", () => {
    const { logger, logs } = capturingLogger();
    const counters = createPluginCounters();
    const notices: string[] = [];
    const sidecar = createSidecarStore({ dir: tmp(), logger });
    const ops = {
      createTask: (_t: Team, input: { title: string }) => (input.title.includes("refuse") ? { ok: false as const, error: "task_cap_reached" } : { ok: true as const, data: { task: { id: "1" } } }),
      enqueueLeadNotice: (_t: Team, n: { text: string }) => void notices.push(n.text),
    };
    const deps = { ops: ops as never, sidecar, log: createOpenspecLog({ logger, counters }), clock: { now: () => 1 } };
    const team = { id: "t_1" } as Team;
    seedCore(deps, team, { teamId: "t_1", kind: "apply", goal: "x", repo: "/r" }, { tasks: [{ key: "k1", title: `Fix ${SECRET}`, description: `desc ${SECRET}` }] });
    expect(counters.get(OPENSPEC_COUNTERS.seeded, "t_1")).toBe(1);
    // an incomplete seed: the refused task's text is not in the lead notice or the log either
    const team2 = { id: "t_2" } as Team;
    seedCore(deps, team2, { teamId: "t_2", kind: "apply", goal: "x", repo: "/r" }, { tasks: [{ key: "k", title: `refuse ${SECRET}` }] });
    expect(counters.get(OPENSPEC_COUNTERS.seedIncomplete, "t_2")).toBe(1);
    expect(JSON.stringify([logs, notices])).not.toContain(SECRET);
    expect(logs.info.concat(logs.error).some((l) => l.includes("seeded team=t_1 tasks=1"))).toBe(true);
  });

  it("a rejected goal with newline injection is refused with a code only: nothing of the goal reaches the logs or the reply", async () => {
    const e = await createOpenspecEnv();
    e.kind("apply", {});
    const counters = e.rt.counters;
    const res = await e.start({ template: APPLY, goal: `x\nINJECTED-LINE ${SECRET}` });
    const rest = await e.restStart({ template: APPLY, goal: `x\nINJECTED-LINE ${SECRET}`, cwd: e.cwd });
    expect(res).toMatchObject({ ok: false, error: "invalid_args" });
    const everything = JSON.stringify([e.fake.logs, res, rest.body]);
    expect(everything).not.toContain("INJECTED-LINE");
    expect(everything).not.toContain(SECRET);
    expect(counters.get(OPENSPEC_COUNTERS.preflightRefused)).toBe(2);
  });
});
