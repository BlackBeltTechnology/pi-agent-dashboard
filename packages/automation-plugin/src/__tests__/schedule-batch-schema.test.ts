/**
 * `schedule.batch` schema rules: unknown `on.source` isolation (E10), single
 * `action:` requirement rejecting `actions:`/`count` (E9), invalid bound
 * rejection (E6), and the settings-default bound precedence (E11).
 * See change: automation-work-source-fanout.
 */
import { describe, expect, it } from "vitest";
import { parseAutomationYaml } from "../server/automation-schema.js";
import { effectiveBound, settingsDefaultBound } from "../server/resolve-children.js";
import type { AutomationConfig, DiscoveredAutomation } from "../shared/automation-types.js";

const KINDS = new Set(["schedule", "schedule.batch"]);
const SOURCES = new Set(["inbox"]);

function parse(yaml: string) {
  return parseAutomationYaml(yaml, KINDS, new Set(), SOURCES);
}

describe("schedule.batch schema", () => {
  it("parses a valid schedule.batch + single action", () => {
    const { config, error } = parse(
      `
on: { kind: schedule.batch, cron: "* * * * *", source: inbox }
action: { kind: prompt, prompt: ./p.md }
model: x
`,
    );
    expect(error).toBeUndefined();
    expect(config?.on.kind).toBe("schedule.batch");
    expect(config?.on.source).toBe("inbox");
  });

  it("E10: an unknown on.source isolates the automation", () => {
    const { config, error } = parse(
      `
on: { kind: schedule.batch, cron: "* * * * *", source: nope }
action: { kind: prompt, prompt: ./p.md }
model: x
`,
    );
    expect(config).toBeUndefined();
    expect(error).toContain("nope");
  });

  it("requires a non-empty on.source", () => {
    const { error } = parse(
      `on: { kind: schedule.batch, cron: "* * * * *" }\naction: { kind: prompt, prompt: ./p.md }\nmodel: x`,
    );
    expect(error).toContain("on.source");
  });

  it("E9: rejects `actions:` on a schedule.batch automation", () => {
    const { config, error } = parse(
      `
on: { kind: schedule.batch, cron: "* * * * *", source: inbox }
actions:
  - { kind: prompt, prompt: ./a.md }
  - { kind: prompt, prompt: ./b.md }
model: x
`,
    );
    expect(config).toBeUndefined();
    expect(error).toContain("actions");
  });

  it("E9: rejects a `count` on a schedule.batch action", () => {
    const { config, error } = parse(
      `
on: { kind: schedule.batch, cron: "* * * * *", source: inbox }
action: { kind: prompt, prompt: ./p.md, count: 3 }
model: x
`,
    );
    expect(config).toBeUndefined();
    expect(error).toContain("count");
  });
});

describe("E6: invalid maxConcurrentSpawns is rejected", () => {
  for (const bad of ["0", "-1", "2.5"]) {
    it(`rejects maxConcurrentSpawns: ${bad}`, () => {
      const { config, error } = parse(
        `
on: { kind: schedule.batch, cron: "* * * * *", source: inbox }
action: { kind: prompt, prompt: ./p.md }
maxConcurrentSpawns: ${bad}
model: x
`,
      );
      expect(config).toBeUndefined();
      expect(error).toContain("maxConcurrentSpawns");
    });
  }
});

describe("E11: settings-default bound precedence (per-auto → env → default)", () => {
  function automation(bound?: number): DiscoveredAutomation {
    return {
      name: "a",
      scope: "folder",
      dir: "/x/.pi/automation/a",
      valid: true,
      config: {
        on: { kind: "schedule.batch", cron: "* * * * *", source: "inbox" },
        action: { kind: "prompt", prompt: "./p.md" },
        ...(bound !== undefined ? { maxConcurrentSpawns: bound } : {}),
        model: "x",
        mode: "local",
        sandbox: "workspace-write",
        concurrency: "skip",
      } as AutomationConfig,
    };
  }

  it("env sets the settings default when no dashboard config value is present", () => {
    expect(settingsDefaultBound(undefined, "6")).toBe(6);
  });

  it("dashboard config value wins over env", () => {
    expect(settingsDefaultBound(8, "6")).toBe(8);
  });

  it("falls back to the hard default 4 when both absent/invalid", () => {
    expect(settingsDefaultBound(undefined, undefined)).toBe(4);
    expect(settingsDefaultBound(0, "0")).toBe(4);
    expect(settingsDefaultBound(undefined, "2.5")).toBe(4);
  });

  it("per-automation bound wins over the env-derived settings default", () => {
    const settingsDefault = settingsDefaultBound(undefined, "6"); // env → 6
    expect(effectiveBound(automation(), settingsDefault)).toBe(6); // no per-auto → env
    expect(effectiveBound(automation(2), settingsDefault)).toBe(2); // per-auto wins
  });
});
