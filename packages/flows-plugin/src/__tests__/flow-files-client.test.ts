/**
 * Client flow-file access: plugin endpoint first (retry once while the bridge
 * has not reported), host `/api/pi-resource-file` fallback; and the pure
 * enrichment that gives cards their agent / handler file paths.
 * See change: attach-flow-before-run.
 */
import type { FlowAgentState, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFlowFile, withNodeFiles } from "../client/flow-files.js";

const res = (status: number, body: unknown) => ({ status, json: async () => body }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fetchFlowFile", () => {
  it("uses the plugin endpoint when it serves the file", async () => {
    const f = vi.fn(async (_url: string) => res(200, { success: true, data: { content: "yaml" } }));
    vi.stubGlobal("fetch", f);
    await expect(fetchFlowFile("S1", "/x/flow.yaml")).resolves.toBe("yaml");
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toContain("/api/plugins/flows/file?sessionId=S1&path=%2Fx%2Fflow.yaml");
  });

  it("retries once on 409 (not reported yet)", async () => {
    vi.useFakeTimers();
    const f = vi
      .fn()
      .mockResolvedValueOnce(res(409, { success: false, retry: true }))
      .mockResolvedValueOnce(res(200, { success: true, data: { content: "ok" } }));
    vi.stubGlobal("fetch", f);
    const p = fetchFlowFile("S1", "/x/a.ts");
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(p).resolves.toBe("ok");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("falls back to /api/pi-resource-file on 403 / no session, surfacing its error", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(res(403, { success: false, error: "not a flow file" }))
      .mockResolvedValueOnce(res(200, { success: true, data: { content: "host" } }));
    vi.stubGlobal("fetch", f);
    await expect(fetchFlowFile("S1", "/p/.pi/flow.yaml")).resolves.toBe("host");
    expect(String(f.mock.calls[1][0])).toContain("/api/pi-resource-file?path=");

    const g = vi.fn(async () => res(403, { success: false, error: "path not in allowed resource location" }));
    vi.stubGlobal("fetch", g);
    await expect(fetchFlowFile(undefined, "/z")).rejects.toThrow("path not in allowed resource location");
    expect(g).toHaveBeenCalledTimes(1);
  });
});

function card(over: Partial<FlowAgentState>): FlowAgentState {
  return { agentName: "x", stepId: "x", status: "pending", blockedBy: [], recentTools: [], detailHistory: [], ...over };
}

describe("withNodeFiles", () => {
  const state: FlowState = {
    flowName: "ns:demo",
    task: "",
    status: "running",
    autonomousMode: true,
    agents: new Map([
      ["load", card({ agentName: "load", stepId: "load", nodeKind: "code" })],
      ["fill", card({ agentName: "filler", stepId: "fill", nodeKind: "agent" })],
      ["done", card({ agentName: "filler", stepId: "done", nodeKind: "agent", sourcePath: "/live.md" })],
    ]),
    dagSteps: [
      { id: "load", stepType: "code", blockedBy: [] },
      { id: "fill", stepType: "agent", agent: "filler", blockedBy: [] },
      { id: "done", stepType: "agent", agent: "filler", blockedBy: [] },
    ],
  };
  const files = { agents: { filler: "/pkg/agents/filler.md" }, handlers: { "ns:demo": { load: "/pkg/flows/ns/demo/load.ts" } } };

  it("fills agent + handler paths without overriding live values", () => {
    const out = withNodeFiles(state, files);
    expect(out.agents.get("load")?.codeTarget).toBe("/pkg/flows/ns/demo/load.ts");
    expect(out.agents.get("load")?.sourcePath).toBeUndefined();
    expect(out.agents.get("fill")?.sourcePath).toBe("/pkg/agents/filler.md");
    expect(out.agents.get("done")?.sourcePath).toBe("/live.md");
    expect(state.agents.get("fill")?.sourcePath).toBeUndefined();
  });

  it("returns the same state when nothing is known or nothing changes", () => {
    expect(withNodeFiles(state, null)).toBe(state);
    const enriched = withNodeFiles(state, files);
    expect(withNodeFiles(enriched, files)).toBe(enriched);
  });
});
