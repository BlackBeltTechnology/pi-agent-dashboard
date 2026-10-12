/** Portable project-name guard. See change: streamline-first-run (design D4). */
import { describe, expect, it } from "vitest";
import { isPortableProjectName, projectNameProblem } from "../project-name.js";

describe("projectNameProblem / isPortableProjectName", () => {
  it.each(["my-first-project", "demo", "a.b", "é".repeat(127), "a".repeat(255), "x y"])("accepts %j", (name) => {
    expect(projectNameProblem(name)).toBeNull();
    expect(isPortableProjectName(name)).toBe(true);
  });

  it.each([
    ["", "invalid_name"],
    [" demo", "invalid_name"],
    [".", "invalid_name"],
    ["..", "invalid_name"],
    ["a/b", "invalid_name"],
    ["a\\b", "invalid_name"],
    ["a\0b", "invalid_name"],
    ["a\u0085b", "invalid_name"],
    ["a:b", "invalid_name"],
    ["name.", "invalid_name"],
    [42, "invalid_name"],
    [null, "invalid_name"],
    ["con", "reserved_name"],
    ["AUX.txt", "reserved_name"],
    ["lpt\u00B9", "reserved_name"],
    ["a".repeat(256), "too_long"],
    ["é".repeat(128), "too_long"],
  ] as Array<[unknown, string]>)("rejects %j as %s", (name, problem) => {
    expect(projectNameProblem(name)).toBe(problem);
    expect(isPortableProjectName(name)).toBe(false);
  });
});
