import { describe, it, expect } from "vitest";
import { filterCommands } from "../chat/command-filter.js";
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

const commands: CommandInfo[] = [
  { name: "deploy", description: "Deploy to production", source: "extension" },
  { name: "test", description: "Run test suite", source: "skill" },
  { name: "review", description: "Code review", source: "prompt" },
  { name: "debug", description: "Debug mode", source: "extension" },
];

describe("filterCommands", () => {
  it("should return all commands for empty filter", () => {
    expect(filterCommands(commands, "")).toHaveLength(4);
  });

  it("should filter by name (case-insensitive)", () => {
    const result = filterCommands(commands, "dep");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("deploy");
  });

  it("should filter by description (case-insensitive)", () => {
    const result = filterCommands(commands, "code");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("review");
  });

  it("should be case-insensitive", () => {
    const result = filterCommands(commands, "DEBUG");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("debug");
  });

  it("should return empty for no matches", () => {
    expect(filterCommands(commands, "zzz")).toHaveLength(0);
  });
});
