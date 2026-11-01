import { describe, it, expect } from "vitest";
import { renderSessionFlowActions } from "../server/render-actions.js";
import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FlowCatalogEntry } from "../flow-catalog-contract.js";

const cmd = (name: string): CommandInfo => ({ name }) as CommandInfo;
const flow = (name: string, description = ""): FlowCatalogEntry => ({ name, description, source: "", taskRequired: false });

describe("renderSessionFlowActions", () => {
  it("returns null when no flows and no /flows:new command", () => {
    const result = renderSessionFlowActions({ flows: [], commands: [] });
    expect(result).toBeNull();
  });

  it("renders flows as action items with dataAction descriptors", () => {
    const result = renderSessionFlowActions({
      flows: [flow("alpha", "desc-a"), flow("beta", "desc-b")],
      commands: [],
    });
    expect(result).not.toBeNull();
    expect(result!.primitive).toBe("ui:action-list");
    const actions = (result!.props as { actions: any[] }).actions;
    expect(actions).toHaveLength(2);
    expect(actions[0].label).toBe("alpha");
    expect(actions[0].tooltip).toBe("desc-a");
    expect(actions[0].dataAction).toEqual({
      pluginId: "flows",
      action: "flow.run",
      payload: { flow: "alpha" },
    });
  });

  it("appends + New Flow item when flows:new command is available", () => {
    const result = renderSessionFlowActions({
      flows: [flow("alpha")],
      commands: [cmd("flows:new")],
    });
    const actions = (result!.props as { actions: any[] }).actions;
    expect(actions).toHaveLength(2);
    expect(actions[1].label).toBe("+ New Flow");
    expect(actions[1].dataAction.action).toBe("flow.new");
  });

  it("renders ONLY + New Flow when no flows but command available", () => {
    const result = renderSessionFlowActions({
      flows: [],
      commands: [cmd("flows:new")],
    });
    const actions = (result!.props as { actions: any[] }).actions;
    expect(actions).toHaveLength(1);
    expect(actions[0].label).toBe("+ New Flow");
  });

  it("returns null intent is JSON-serializable when not null", () => {
    const result = renderSessionFlowActions({
      flows: [flow("alpha")],
      commands: [cmd("flows:new")],
    });
    expect(() => JSON.stringify(result)).not.toThrow();
    const roundtrip = JSON.parse(JSON.stringify(result));
    expect(roundtrip.primitive).toBe("ui:action-list");
  });
});
