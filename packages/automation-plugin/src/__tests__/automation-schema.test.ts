/**
 * Schema parser/validator tests, including unknown-kind isolation.
 * See change: add-automation-plugin.
 */
import { describe, it, expect } from "vitest";
import { parseAutomationYaml } from "../server/automation-schema.js";

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
});
