/**
 * MCP automation tools and the cwd boundary (S1r): the generated manifest marks `cwd` required for the
 * folder-scope automation tools only (create, update, delete, definition, runs, result), dispatch refuses
 * a call without it before any REST request, and a supplied cwd + scope is forwarded to the route, which
 * admits it (route behaviour: automation-plugin `routes-cwd-admission.test.ts`, #SE27).
 *
 * See change: harden-git-terminal-plugin-boundaries (test-plan #SE32).
 */
import { describe, expect, it, vi } from "vitest";
import { type DispatchDeps, dispatchRpc, type InjectOptions } from "../dispatch.js";
import { GENERATED_TOOLS } from "../generated/tools.js";
import { META_VERSION_KEY } from "../protocol.js";
import type { McpCaller } from "../tokens.js";

const V = "2026-07-28";
const deviceCaller: McpCaller = { kind: "device", deviceId: "d1", tier: "operate" };

const FOLDER_SCOPE_TOOLS = [
  "plugins_automation_create",
  "plugins_automation_update",
  "plugins_automation",
  "getplugins_automation_definition",
  "list_automation_runs",
  "getplugins_automation_result",
];
const OTHER_AUTOMATION_TOOLS = [
  "list_automation",
  "run_automation",
  "stop_automation",
  "getplugins_automation_actions",
  "getplugins_automation_git_capable",
  "getplugins_automation_trigger_kinds",
];

const toolByName = (name: string) => {
  const t = GENERATED_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`no such tool ${name}`);
  return t;
};

describe("generated manifest — cwd required for exactly the folder-scope automation tools", () => {
  it.each(FOLDER_SCOPE_TOOLS)("%s lists cwd in required", (name) => {
    expect(toolByName(name).inputSchema.required).toContain("cwd");
    expect(toolByName(name).inputSchema.properties?.cwd).toMatchObject({ type: "string" });
  });
  it.each(OTHER_AUTOMATION_TOOLS)("%s does NOT list cwd in required", (name) => {
    expect(toolByName(name).inputSchema.required ?? []).not.toContain("cwd");
  });
  it("only those six automation tools require cwd", () => {
    const requiring = GENERATED_TOOLS.filter(
      (t) => /\/api\/plugins\/automation/.test(JSON.stringify(t.bind)) && (t.inputSchema.required ?? []).includes("cwd"),
    ).map((t) => t.name);
    expect(requiring.sort()).toEqual([...FOLDER_SCOPE_TOOLS].sort());
  });
});

describe("dispatch of the folder-scope automation tools", () => {
  const injectSpy = vi.fn(async (_o: InjectOptions) => ({ statusCode: 200, body: { ok: true } }));

  const call = (name: string, args: Record<string, unknown>) =>
    dispatchRpc(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { _meta: { [META_VERSION_KEY]: V }, name, arguments: args } },
      { era: "modern", version: V },
      deviceCaller,
      { invokeTool: vi.fn(), inject: injectSpy, serverInfo: { name: "pi-dashboard", version: "0" } } as unknown as DispatchDeps,
    );

  const CONFIG = { on: { kind: "schedule", cron: "* * * * *" }, action: { kind: "prompt" }, model: "@fast" };
  const BASE_ARGS: Record<string, Record<string, unknown>> = {
    plugins_automation_create: { name: "fresh", config: CONFIG, promptBody: "x" },
    plugins_automation_update: { name: "nightly", config: CONFIG, promptBody: "x" },
    plugins_automation: { name: "nightly" },
    getplugins_automation_definition: { name: "nightly" },
    list_automation_runs: {},
    getplugins_automation_result: { runId: "r1" },
  };
  /** Where the injected request carries the arguments: the query (GET) or the JSON body. */
  const carried = (o: InjectOptions): Record<string, unknown> =>
    o.method === "GET" ? Object.fromEntries(new URL(o.url, "http://x").searchParams) : (o.payload as Record<string, unknown>);

  for (const tool of FOLDER_SCOPE_TOOLS) {
    it(`${tool}: no cwd (absent, empty, folder scope) → refused by dispatch, no REST request`, async () => {
      injectSpy.mockClear();
      for (const extra of [{}, { scope: "folder" }, { cwd: "" }]) {
        const res = await call(tool, { ...BASE_ARGS[tool], ...extra });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain("cwd");
      }
      expect(injectSpy).not.toHaveBeenCalled();
    });

    it(`${tool}: a supplied cwd (default and global scope) is forwarded to the route`, async () => {
      for (const scope of [undefined, "global"]) {
        injectSpy.mockClear();
        const res = await call(tool, { ...BASE_ARGS[tool], ...(scope ? { scope } : {}), cwd: "/abs/repo" });
        expect(res.status).toBe(200);
        expect(injectSpy).toHaveBeenCalledOnce();
        const sent = carried(injectSpy.mock.calls[0]![0]);
        expect(sent.cwd).toBe("/abs/repo");
        if (scope) expect(sent.scope).toBe("global");
      }
    });
  }

  it("the tools that do not require cwd still dispatch without one", async () => {
    for (const tool of ["list_automation", "getplugins_automation_actions", "getplugins_automation_git_capable", "getplugins_automation_trigger_kinds"]) {
      injectSpy.mockClear();
      const res = await call(tool, {});
      expect(res.status, tool).toBe(200);
      expect(injectSpy, tool).toHaveBeenCalledOnce();
    }
  });
});
