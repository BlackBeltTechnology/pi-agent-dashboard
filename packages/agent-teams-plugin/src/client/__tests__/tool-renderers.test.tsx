// @vitest-environment jsdom
/**
 * Team tool renderers (test-plan S10 details classes, S60 inert tool text): eleven
 * tools through the four family components; never blank; invalid / elided / foreign
 * details fall back to input summary + result; error codes render a sentence or the
 * verbatim "Unexpected error (<code>)". See change: add-agent-teams-ui.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as renderers from "../TeamToolRenderers.js";
import { parseToolDetails } from "../tool-details.js";
import { FAMILY_COMPONENTS, TOOL_FAMILIES } from "../tool-families.js";

afterEach(cleanup);

type Props = Parameters<typeof renderers.TeamLifecycleToolRenderer>[0];
const family = (tool: string) => (renderers as unknown as Record<string, (p: Props) => React.ReactElement>)[FAMILY_COMPONENTS[TOOL_FAMILIES[tool as keyof typeof TOOL_FAMILIES]]] as (p: Props) => React.ReactElement;
function show(toolName: string, over: Partial<Props> = {}) {
  const Comp = family(toolName);
  return render(<Comp toolName={toolName} toolInput={{ a: "in" }} sessionId="S-lead" status="complete" result="RESULT-TEXT" {...over} />);
}

/** Valid `details` per tool (shapes of design D5). */
const VALID: Record<string, Record<string, unknown>> = {
  TeamCreate: { op: "TeamCreate", ok: true, team: { name: "Alpha", maxTeammates: 5, mode: "session" } },
  TeammateSpawn: { op: "TeammateSpawn", ok: true, member: { name: "bob", role: "dev", status: "spawning", model: "m1" } },
  TeamStatus: { op: "TeamStatus", ok: true, counts: { members: { idle: 2, busy: 1 }, tasks: { pending: 1, completed: 3 } } },
  TeamDelete: { op: "TeamDelete", ok: true, force: true },
  SendMessage: { op: "SendMessage", ok: true, to: "bob", delivery: "delivered" },
  TaskCreate: { op: "TaskCreate", ok: true, task: { id: "3", title: "Do it", blockedBy: ["1"], owner: "bob" } },
  TaskList: { op: "TaskList", ok: true, tasks: [{ id: "1", title: "One", status: "pending", claimable: true }] },
  TaskGet: { op: "TaskGet", ok: true, task: { id: "3", title: "Do it", status: "in_progress", description: "desc", blockedBy: [] } },
  TaskUpdate: { op: "TaskUpdate", ok: true, task: { id: "3", title: "Do it", from: "pending", to: "completed" } },
  ShutdownRequest: { op: "ShutdownRequest", ok: true },
  ShutdownResponse: { op: "ShutdownResponse", ok: true, approve: false },
};
const TOOLS = Object.keys(TOOL_FAMILIES);

describe("S10 — every tool, every details class: never blank", () => {
  it("all eleven tools have a family component and valid details", () => {
    expect(TOOLS).toHaveLength(11);
    expect(Object.keys(VALID).sort()).toEqual([...TOOLS].sort());
  });

  for (const tool of TOOLS) {
    describe(tool, () => {
      it("valid details → facts, no fallback", () => {
        show(tool, { toolDetails: VALID[tool] });
        expect(screen.queryByTestId("team-tool-fallback")).toBeNull();
        expect(screen.queryByTestId("team-tool-error")).toBeNull();
        expect((document.body.textContent ?? "").trim()).not.toBe("");
      });

      const fallbackClasses: Array<[string, Partial<Props>]> = [
        ["undefined details", { toolDetails: undefined }],
        ["foreign shape", { toolDetails: { foo: 1 } }],
        ["another op's details", { toolDetails: { op: "SomethingElse", ok: true } }],
        ["op without ok", { toolDetails: { op: tool } }],
        ["right keys, wrong types", { toolDetails: { op: tool, ok: true, member: 5, team: 5, task: 5, tasks: 5, counts: 5, to: 5, delivery: 5, approve: "yes", force: "yes" } }],
        ["elided", { status: "elided", toolDetails: undefined }],
      ];
      for (const [label, over] of fallbackClasses) {
        // ShutdownRequest has no per-op keys: a well-formed `{op, ok:true}` is already fully valid.
        if (tool === "ShutdownRequest" && label === "right keys, wrong types") continue;
        it(`${label} → input summary + result text`, () => {
          show(tool, over);
          const fb = screen.getByTestId("team-tool-fallback");
          expect(fb.textContent).toContain("in");
          expect(screen.getByTestId("team-tool-result").textContent).toBe("RESULT-TEXT");
        });
      }
    });
  }

  it("elided adds the explanatory note", () => {
    show("TaskGet", { status: "elided" });
    expect(screen.getByTestId("team-tool-fallback").textContent).toContain("Result not loaded");
  });

  it("running → waiting state with the input summary", () => {
    show("TeamCreate", { status: "running", result: undefined });
    expect(screen.getByTestId("team-tool-running").textContent).toContain("Waiting for the result");
  });

  it("a tool that is not a team op renders the fallback, not nothing", () => {
    show("TeamCreate", { toolName: "PlanSubmit" });
    expect(screen.getByTestId("team-tool-fallback")).toBeTruthy();
  });

  it("50-task TaskList renders in a bounded scroll list", () => {
    const tasks = Array.from({ length: 50 }, (_, i) => ({ id: String(i + 1), title: `T${i + 1}`, status: "pending", claimable: false }));
    show("TaskList", { toolDetails: { op: "TaskList", ok: true, tasks } });
    expect(screen.getByTestId("team-tool-tasks").children).toHaveLength(50);
    expect(screen.getByTestId("team-tool-tasks").className).toContain("overflow-y-auto");
  });
});

describe("errors (S10)", () => {
  it("team_full → error state with the code and a readable sentence", () => {
    show("TeammateSpawn", { status: "error", toolDetails: { op: "TeammateSpawn", ok: false, error: "team_full" } });
    const e = screen.getByTestId("team-tool-error");
    expect(e.textContent).toContain("maximum number of live teammates");
    expect(e.textContent).toContain("team_full");
  });

  it("an unknown code → 'Unexpected error (xyz_new)', the code verbatim", () => {
    show("TaskUpdate", { status: "error", toolDetails: { op: "TaskUpdate", ok: false, error: "xyz_new" } });
    expect(screen.getByTestId("team-tool-error").textContent).toContain("Unexpected error (xyz_new)");
  });

  it("error status without details: the code comes from the result prefix, or 'unknown'", () => {
    show("TaskUpdate", { status: "error", toolDetails: undefined, result: "unknown_task: no such task" });
    expect(screen.getByTestId("team-tool-error").textContent).toContain("no task with that id");
    cleanup();
    show("TaskUpdate", { status: "error", toolDetails: undefined, result: undefined });
    expect(screen.getByTestId("team-tool-error").textContent).toContain("Unexpected error (unknown)");
  });

  it("a complete call whose details say ok:false renders the error too", () => {
    show("TaskUpdate", { toolDetails: { op: "TaskUpdate", ok: false, error: "blocked" } });
    expect(screen.getByTestId("team-tool-error").textContent).toContain("waits for another task");
  });
});

describe("S60 — inert tool text", () => {
  const evil = "<img src=x onerror=alert(1)> **b** [x](javascript:alert(1)) https://evil.example/";
  it("TaskCreate title and ShutdownRequest reason render literally", () => {
    show("TaskCreate", { toolDetails: { op: "TaskCreate", ok: true, task: { id: "1", title: evil, blockedBy: [], owner: evil } } });
    expect(document.body.textContent).toContain(evil);
    expect(document.body.querySelector("img,script,b,strong")).toBeNull();
    expect(document.body.querySelector('a[href*="evil"],a[href^="javascript"]')).toBeNull();
    cleanup();
    show("ShutdownRequest", { toolInput: { to: evil, reason: evil }, toolDetails: VALID.ShutdownRequest });
    expect(document.body.textContent).toContain(evil);
    expect(document.body.querySelector("img,script,b,strong,a")).toBeNull();
    cleanup();
    show("SendMessage", { toolInput: { to: "bob", message: evil }, toolDetails: VALID.SendMessage });
    expect(document.body.textContent).toContain(evil);
    expect(document.body.querySelector("img,script,b,strong")).toBeNull();
    for (const el of Array.from(document.body.querySelectorAll("*"))) for (const a of Array.from(el.attributes)) expect(a.value).not.toContain("alert(1)");
  });

  it("the only link is the Team view link built from the route table with an encoded id", () => {
    show("TeamCreate", { sessionId: "S/../x?y=1", toolDetails: VALID.TeamCreate });
    const links = Array.from(document.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([`/session/${encodeURIComponent("S/../x?y=1")}/team`]);
  });
});

describe("parseToolDetails", () => {
  it("accepts every valid shape and rejects non-objects, arrays and other ops", () => {
    for (const tool of TOOLS) expect(parseToolDetails(tool as never, VALID[tool])?.kind).toBe("ok");
    for (const bad of [null, undefined, 5, "x", [], {}]) expect(parseToolDetails("TeamCreate", bad)).toBeUndefined();
    expect(parseToolDetails("TeamCreate", VALID.TeammateSpawn)).toBeUndefined();
    expect(parseToolDetails("TeamCreate", { op: "TeamCreate", ok: false, error: "" })).toBeUndefined();
  });
});
