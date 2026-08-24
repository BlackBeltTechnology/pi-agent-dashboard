/**
 * Schema parser/validator tests, including unknown-kind isolation.
 * See change: add-automation-plugin.
 */
import { describe, expect, it } from "vitest";
import { parseAutomationYaml } from "../server/automation-schema.js";
import { resolveChildren } from "../server/resolve-children.js";

const KNOWN = new Set(["schedule"]);

describe("parseAutomationYaml", () => {
  it("parses a valid schedule + prompt automation with defaults", () => {
    const { config, error } = parseAutomationYaml(
      `
on:
  kind: schedule
  cron: "0 9 * * 1"
action:
  kind: prompt
  prompt: ./prompt.md
model: "@fast"
mode: worktree
concurrency: skip
`,
      KNOWN,
    );
    expect(error).toBeUndefined();
    expect(config?.on.kind).toBe("schedule");
    expect(config?.on.cron).toBe("0 9 * * 1");
    expect(config?.action).toEqual({ kind: "prompt", prompt: "./prompt.md" });
    expect(config?.model).toBe("@fast");
    expect(config?.mode).toBe("worktree");
    expect(config?.concurrency).toBe("skip");
    // defaults applied
    expect(config?.sandbox).toBe("workspace-write");
  });

  it("applies defaults for omitted mode/sandbox/concurrency", () => {
    const { config } = parseAutomationYaml(
      `
on: { kind: schedule, cron: "* * * * *" }
action: { kind: skill, skill: $recent-code-bugfix }
model: "provider/model-x"
`,
      KNOWN,
    );
    expect(config?.mode).toBe("worktree");
    expect(config?.sandbox).toBe("workspace-write");
    expect(config?.concurrency).toBe("skip");
    expect(config?.action).toEqual({ kind: "skill", skill: "$recent-code-bugfix" });
  });

  it("accepts an optional visibility override", () => {
    const { config } = parseAutomationYaml(
      `
on: { kind: schedule, cron: "* * * * *" }
action: { kind: prompt, prompt: ./p.md }
model: x
visibility: shown
`,
      KNOWN,
    );
    expect(config?.visibility).toBe("shown");
  });

  it("rejects an unknown trigger kind, naming it", () => {
    const { config, error } = parseAutomationYaml(
      `
on: { kind: slack.message }
action: { kind: prompt, prompt: ./p.md }
model: x
`,
      KNOWN,
    );
    expect(config).toBeUndefined();
    expect(error).toContain("slack.message");
  });

  it("rejects malformed yaml without throwing", () => {
    const { error } = parseAutomationYaml(":\n  - [unbalanced", KNOWN);
    expect(error).toBeTruthy();
  });

  it("rejects missing action", () => {
    const { error } = parseAutomationYaml(
      `on: { kind: schedule, cron: "* * * * *" }\nmodel: x`,
      KNOWN,
    );
    expect(error).toContain("action");
  });

  it("parses a multi-event openspec automation (kind not registered, but in taxonomy)", () => {
    const { config, error } = parseAutomationYaml(
      `
on: { kind: openspec, events: [change.archived, change.validated] }
action: { kind: prompt, prompt: ./p.md }
model: x
`,
      KNOWN,
    );
    expect(error).toBeUndefined();
    expect(config?.on.kind).toBe("openspec");
    expect(config?.on.events).toEqual(["change.archived", "change.validated"]);
  });

  it("rejects a multi-type category with no selected events", () => {
    const { config, error } = parseAutomationYaml(
      `
on: { kind: openspec }
action: { kind: prompt, prompt: ./p.md }
model: x
`,
      KNOWN,
    );
    expect(config).toBeUndefined();
    expect(error).toContain("events");
  });

  it("rejects an empty events array", () => {
    const { error } = parseAutomationYaml(
      `
on: { kind: openspec, events: [] }
action: { kind: prompt, prompt: ./p.md }
model: x
`,
      KNOWN,
    );
    expect(error).toContain("events");
  });

  it("rejects an invalid enum value", () => {
    const { error } = parseAutomationYaml(
      `
on: { kind: schedule, cron: "* * * * *" }
action: { kind: prompt, prompt: ./p.md }
model: x
sandbox: yolo
`,
      KNOWN,
    );
    expect(error).toContain("sandbox");
  });

  it("accepts a registered plugin action id with a payload", () => {
    const { config, error } = parseAutomationYaml(
      `
on: { kind: schedule, cron: "* * * * *" }
action: { kind: flows.run, payload: { flow: nightly-build-and-tag, task: "build and tag" } }
model: "@fast"
`,
      KNOWN,
      new Set(["flows.run"]),
    );
    expect(error).toBeUndefined();
    expect(config?.action?.kind).toBe("flows.run");
    expect(config?.action?.payload).toEqual({ flow: "nightly-build-and-tag", task: "build and tag" });
  });

  it("rejects an unregistered action kind, naming it, isolating the automation", () => {
    const { config, error } = parseAutomationYaml(
      `
on: { kind: schedule, cron: "* * * * *" }
action: { kind: slack.post }
model: x
`,
      KNOWN,
      new Set(["flows.run"]),
    );
    expect(config).toBeUndefined();
    expect(error).toContain("slack.post");
  });

  it("rejects a non-mapping action.payload", () => {
    const { error } = parseAutomationYaml(
      `
on: { kind: schedule, cron: "* * * * *" }
action: { kind: flows.run, payload: "nope" }
model: x
`,
      KNOWN,
      new Set(["flows.run"]),
    );
    expect(error).toContain("payload");
  });
});

// See change: add-automation-concurrent-spawn.
describe("parseAutomationYaml — fan-out (actions/count/maxConcurrentSpawns)", () => {
  const IDS = new Set(["flows.run", "core.skill"]);

  it("E1: both `action` and `actions` declared is rejected, naming the conflict", () => {
    const { config, error } = parseAutomationYaml(
      `
on: { kind: schedule, cron: "* * * * *" }
action: { kind: prompt, prompt: ./p.md }
actions: [ { kind: flows.run } ]
model: x
`,
      KNOWN,
      IDS,
    );
    expect(config).toBeUndefined();
    expect(error).toMatch(/action/);
    expect(error).toMatch(/actions/);
  });

  it("E2: two distinct actions parse and resolve to two distinct child dispatches", () => {
    const { config, error } = parseAutomationYaml(
      `
on: { kind: schedule, cron: "* * * * *" }
actions:
  - { kind: flows.run, payload: { flow: "A" } }
  - { kind: core.skill, payload: { skill: "B" } }
model: x
`,
      KNOWN,
      IDS,
    );
    expect(error).toBeUndefined();
    expect(config?.actions).toHaveLength(2);
    expect(config?.action).toBeUndefined();
    const automation = { name: "a", scope: "folder" as const, dir: "/x", valid: true, config: config! };
    const { specs } = resolveChildren(automation, 10);
    expect(specs).toHaveLength(2);
    expect(specs[0]!.action.kind).toBe("flows.run");
    expect(specs[0]!.action.payload?.flow).toBe("A");
    expect(specs[1]!.action.kind).toBe("core.skill");
    expect(specs[1]!.action.payload?.skill).toBe("B");
  });

  it("E3: an empty actions list is invalid", () => {
    const { config, error } = parseAutomationYaml(
      `
on: { kind: schedule, cron: "* * * * *" }
actions: []
model: x
`,
      KNOWN,
      IDS,
    );
    expect(config).toBeUndefined();
    expect(error).toBeTruthy();
  });

  it("E4: an unregistered entry kind names the offending index", () => {
    const { config, error } = parseAutomationYaml(
      `
on: { kind: schedule, cron: "* * * * *" }
actions:
  - { kind: flows.run }
  - { kind: bogus.kind }
model: x
`,
      KNOWN,
      IDS,
    );
    expect(config).toBeUndefined();
    expect(error).toContain("actions[1]");
  });

  it("E6: count boundary values", () => {
    for (const bad of ["0", "-1", "1.5", '"2"']) {
      const { config, error } = parseAutomationYaml(
        `
on: { kind: schedule, cron: "* * * * *" }
action: { kind: flows.run, count: ${bad} }
model: x
`,
        KNOWN,
        IDS,
      );
      expect(config, `count=${bad} should be invalid`).toBeUndefined();
      expect(error).toContain("count");
    }
    const one = parseAutomationYaml(
      `on: { kind: schedule, cron: "* * * * *" }\naction: { kind: flows.run, count: 1 }\nmodel: x\n`,
      KNOWN,
      IDS,
    );
    expect(one.config?.action?.count).toBe(1);
    const three = parseAutomationYaml(
      `on: { kind: schedule, cron: "* * * * *" }\naction: { kind: flows.run, count: 3 }\nmodel: x\n`,
      KNOWN,
      IDS,
    );
    expect(three.config?.action?.count).toBe(3);
  });

  it("E7: count defaults to a single child", () => {
    const { config } = parseAutomationYaml(
      `on: { kind: schedule, cron: "* * * * *" }\naction: { kind: flows.run }\nmodel: x\n`,
      KNOWN,
      IDS,
    );
    const automation = { name: "a", scope: "folder" as const, dir: "/x", valid: true, config: config! };
    expect(resolveChildren(automation, 10).specs).toHaveLength(1);
  });

  it("E8: count on the single action block resolves to N children", () => {
    const { config } = parseAutomationYaml(
      `on: { kind: schedule, cron: "* * * * *" }\naction: { kind: flows.run, count: 3 }\nmodel: x\n`,
      KNOWN,
      IDS,
    );
    const automation = { name: "a", scope: "folder" as const, dir: "/x", valid: true, config: config! };
    expect(resolveChildren(automation, 10).specs).toHaveLength(3);
  });

  it("E14: an invalid maxConcurrentSpawns is rejected", () => {
    for (const bad of ["0", "-1", "2.5"]) {
      const { config, error } = parseAutomationYaml(
        `on: { kind: schedule, cron: "* * * * *" }\naction: { kind: flows.run }\nmodel: x\nmaxConcurrentSpawns: ${bad}\n`,
        KNOWN,
        IDS,
      );
      expect(config, `bound=${bad} should be invalid`).toBeUndefined();
      expect(error).toContain("maxConcurrentSpawns");
    }
  });
});
