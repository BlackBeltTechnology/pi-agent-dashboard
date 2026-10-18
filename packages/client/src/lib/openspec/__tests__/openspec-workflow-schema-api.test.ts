/**
 * workflowSchemaPresentation — test-plan #U1 (card presentation decision table,
 * first matching row wins) + the D3 Remove gate and the previous-default
 * options. See change: add-pi-spec-driven-schema.
 */
import type { OpenSpecWorkflowSchemaStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  allowedWorkflowSchemaActions,
  previousDefaultOptions,
  workflowSchemaPresentation,
} from "../openspec-workflow-schema-api.js";

const PI = "pi-spec-driven";

function st(over: Partial<OpenSpecWorkflowSchemaStatus>): OpenSpecWorkflowSchemaStatus {
  return { configured: null, generated: "none", missing: false, unpinnedChanges: [], affectedChanges: [], projectSchemas: [], ...over };
}

const text = (s: OpenSpecWorkflowSchemaStatus) =>
  workflowSchemaPresentation(s)
    .sentence.map((p) => p.text)
    .join("");

describe("workflowSchemaPresentation (#U1)", () => {
  const ROWS: Array<[string, Partial<OpenSpecWorkflowSchemaStatus>, string, string, string | null]> = [
    ["team-flow/none + missing", { configured: "team-flow", generated: "none", missing: true }, "Default schema missing", "error", null],
    ["other/none", { configured: "spec-driven", generated: "none" }, "Not enabled", "neutral", "enable"],
    ["team-flow/current", { configured: "team-flow", generated: "current" }, "Disabled, files kept", "neutral", "enable"],
    ["team-flow/outdated", { configured: "team-flow", generated: "outdated" }, "Disabled, files kept", "neutral", "enable"],
    ["pi/current, 0 unpinned", { configured: PI, generated: "current" }, "Enabled", "success", null],
    ["pi/outdated, 2 unpinned", { configured: PI, generated: "outdated", unpinnedChanges: ["a", "b"] }, "Update available", "warning", "update"],
    ["pi/current, 3 unpinned", { configured: PI, generated: "current", unpinnedChanges: ["a", "b", "c"] }, "3 changes not pinned", "warning", "pin"],
    ["newer", { configured: PI, generated: "newer" }, "Newer version", "info", null],
    ["incompatible", { configured: "spec-driven", generated: "incompatible" }, "CLI too old", "error", null],
    ["conflict", { configured: PI, generated: "conflict" }, "Version conflict", "error", null],
    ["unmanaged", { configured: "spec-driven", generated: "unmanaged" }, "Not managed", "warning", "adopt"],
    ["pi/none + missing", { configured: PI, generated: "none", missing: true }, "Schema files missing", "error", "update"],
  ];

  it.each(ROWS)("%s → pill / severity / recommended", (_n, over, label, severity, rec) => {
    const p = workflowSchemaPresentation(st(over));
    expect(p.label).toBe(label);
    expect(p.severity).toBe(severity);
    expect(p.recommended).toBe(rec);
  });

  it("disabled + outdated says an update is available; disabled + current does not", () => {
    expect(text(st({ configured: "team-flow", generated: "outdated" }))).toContain("an update is available");
    expect(text(st({ configured: "team-flow", generated: "current" }))).not.toContain("an update is available");
  });

  it("missing default names the configured schema in a code part", () => {
    const p = workflowSchemaPresentation(st({ configured: "team-flow", generated: "none", missing: true }));
    expect(p.sentence).toContainEqual({ text: "team-flow", code: true });
  });

  it("the menu holds every other allowed action (update, adopt, pin, enable, disable order), never the recommended one", () => {
    const p = workflowSchemaPresentation(st({ configured: "team-flow", generated: "outdated" }));
    expect(p.recommended).toBe("enable");
    expect(p.menu).toEqual(["update", "remove"]);
    const q = workflowSchemaPresentation(st({ configured: PI, generated: "current", unpinnedChanges: ["x"] }));
    expect(q.menu).toEqual(["update", "disable"]);
  });

  it("first matching row wins: missing default beats outdated, disabled+outdated beats Update available", () => {
    expect(workflowSchemaPresentation(st({ configured: "team-flow", generated: "outdated", missing: true })).label).toBe("Default schema missing");
    expect(workflowSchemaPresentation(st({ configured: "spec-driven", generated: "outdated" })).key).toBe("kept");
  });

  it("#U9 chip mirrors the card pill for disabled + outdated (severity and label)", () => {
    const p = workflowSchemaPresentation(st({ configured: "spec-driven", generated: "outdated" }));
    expect(p.severity).toBe("neutral");
    expect(p.chipLabel).toBe("disabled, files kept");
  });
});

describe("D3 Remove gate", () => {
  it.each(["current", "outdated", "newer", "conflict", "incompatible"] as const)(
    "Remove is not offered while pi-spec-driven is configured (%s)",
    (generated) => {
      expect(allowedWorkflowSchemaActions(st({ configured: PI, generated }))).not.toContain("remove");
    },
  );
  it("Remove is offered when another schema is configured", () => {
    expect(allowedWorkflowSchemaActions(st({ configured: "team-flow", generated: "current" }))).toContain("remove");
  });
});

describe("previousDefaultOptions", () => {
  it("is spec-driven plus workflowSchema.projectSchemas, never the configured user-only schema", () => {
    expect(previousDefaultOptions(st({ configured: "mine", projectSchemas: ["team-flow"] }))).toEqual(["spec-driven", "team-flow"]);
  });
  it("never lists spec-driven or pi-spec-driven twice", () => {
    expect(previousDefaultOptions(st({ projectSchemas: ["spec-driven", PI, "team-flow"] }))).toEqual(["spec-driven", "team-flow"]);
  });
});
