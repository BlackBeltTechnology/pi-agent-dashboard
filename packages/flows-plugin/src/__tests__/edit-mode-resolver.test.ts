/**
 * `resolveEditMode` mirrors pi-flows `isEditFlowEnabled`: project ?? global ??
 * false; `flows.editFlow` before legacy `flowsEditFlow` within a file;
 * unparseable = unset. See change: stop-flows-edit-mode-project-writes
 * (D4, test-plan #E1).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalSettingsPath, resolveEditMode } from "../server/edit-mode.js";

type FileSpec = "unset" | "unparseable" | { editFlow?: boolean; legacy?: boolean };

let home: string;
let cwd: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "em-home-"));
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "em-cwd-"));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

function write(file: string, spec: FileSpec): void {
  if (spec === "unset") return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (spec === "unparseable") {
    fs.writeFileSync(file, "{bad json");
    return;
  }
  const obj: Record<string, unknown> = { other: 1 };
  if (spec.editFlow !== undefined) obj.flows = { editFlow: spec.editFlow };
  if (spec.legacy !== undefined) obj.flowsEditFlow = spec.legacy;
  fs.writeFileSync(file, JSON.stringify(obj));
}

/** pi-flows `readEditFlowFlag` over a spec (the oracle). */
function flagOf(spec: FileSpec): boolean | undefined {
  if (spec === "unset" || spec === "unparseable") return undefined;
  return spec.editFlow ?? spec.legacy;
}

const SPECS: FileSpec[] = [
  "unset",
  "unparseable",
  { editFlow: true },
  { editFlow: false },
  { legacy: true },
  { editFlow: false, legacy: true },
  { editFlow: true, legacy: false },
];

describe("resolveEditMode decision table (#E1)", () => {
  const rows = SPECS.flatMap((project) => SPECS.map((global) => [project, global] as const));
  it.each(rows)("project=%j global=%j", (project, global) => {
    write(path.join(cwd, ".pi", "settings.json"), project);
    write(globalSettingsPath(home), global);
    expect(resolveEditMode(cwd, { home })).toBe(flagOf(project) ?? flagOf(global) ?? false);
  });

  it("ignores non-boolean values like pi-flows", () => {
    fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ flows: { editFlow: "yes" }, flowsEditFlow: 1 }));
    write(globalSettingsPath(home), { editFlow: true });
    expect(resolveEditMode(cwd, { home })).toBe(true);
  });

  it("global path is <home>/.pi/agent/settings.json regardless of PI_CODING_AGENT_DIR", () => {
    const prev = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = path.join(home, "alt");
    try {
      expect(globalSettingsPath(home)).toBe(path.join(home, ".pi", "agent", "settings.json"));
    } finally {
      if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = prev;
    }
  });
});
