/**
 * Tool surface: allowlist, denylist, and the completeness check.
 *
 * Covers test-plan E21 (no UI-only or transport verbs), E22 (completeness),
 * E23 (the completeness check is NOT vacuous), E24 (denylisted members absent),
 * E25 (abort maps to the general primitive) and E26's argument shape.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWLISTED_CONTEXT_MEMBERS,
  ALL_CONTEXT_MEMBERS,
  DENIED_CONTEXT_MEMBERS,
  FORBIDDEN_VERB_NAMES,
  MCP_TOOLS,
  type McpToolDef,
  assertContextPartitionTotal,
  checkToolCompleteness,
  findTool,
  listTools,
} from "../tools.js";

/** A resolver standing in for the real handler table. */
const resolverFor = (names: readonly string[]) => (name: string) =>
  names.includes(name) ? () => undefined : undefined;

const allNames = MCP_TOOLS.map((t) => t.name);

describe("context partition (design.md Decision 1)", () => {
  it("accounts for all 19 members exactly once", () => {
    expect(ALL_CONTEXT_MEMBERS).toHaveLength(19);
    expect(assertContextPartitionTotal()).toEqual({
      ok: true,
      unclassified: [],
      overlapping: [],
    });
  });

  it("splits 5 allowlisted / 14 denied", () => {
    expect(ALLOWLISTED_CONTEXT_MEMBERS).toHaveLength(5);
    expect(DENIED_CONTEXT_MEMBERS).toHaveLength(14);
    expect(ALLOWLISTED_CONTEXT_MEMBERS.length + DENIED_CONTEXT_MEMBERS.length).toBe(
      ALL_CONTEXT_MEMBERS.length,
    );
  });

  it("is NOT vacuous — a new unclassified member fails the partition", () => {
    const r = assertContextPartitionTotal(
      [...ALL_CONTEXT_MEMBERS, "someFutureMember"],
      ALLOWLISTED_CONTEXT_MEMBERS,
      DENIED_CONTEXT_MEMBERS,
    );
    expect(r.ok).toBe(false);
    expect(r.unclassified).toEqual(["someFutureMember"]);
  });

  it("is NOT vacuous — a member on both lists fails the partition", () => {
    const r = assertContextPartitionTotal(ALL_CONTEXT_MEMBERS, ["logger"], DENIED_CONTEXT_MEMBERS);
    expect(r.ok).toBe(false);
    expect(r.overlapping).toEqual(["logger"]);
  });
});

describe("E24 — denylisted context members are not exposed", () => {
  it.each([
    "registerPiHandler",
    "registerBrowserHandler",
    "broadcastToSubscribers",
    "emitEventToSession",
    "fastify",
    "getPluginConfig",
    "updatePluginConfig",
    "logger",
  ])("%s is denied and backs no advertised tool", (member) => {
    expect(DENIED_CONTEXT_MEMBERS).toContain(member);
    expect(ALLOWLISTED_CONTEXT_MEMBERS as readonly string[]).not.toContain(member);
    expect(MCP_TOOLS.some((t) => t.contextMember === member)).toBe(false);
  });

  it("every advertised tool is backed by an allowlisted member", () => {
    for (const tool of MCP_TOOLS) {
      expect(ALLOWLISTED_CONTEXT_MEMBERS as readonly string[]).toContain(tool.contextMember);
    }
  });

  it("the wire payload never leaks which context member backs a tool", () => {
    for (const entry of listTools()) {
      expect(entry).not.toHaveProperty("contextMember");
      expect(Object.keys(entry).sort()).toEqual(["description", "inputSchema", "name"]);
    }
  });
});

describe("E21 — UI-only and transport verbs are absent", () => {
  it.each(FORBIDDEN_VERB_NAMES)("%s is not advertised", (verb) => {
    expect(allNames).not.toContain(verb);
    expect(listTools().some((t) => t.name === verb)).toBe(false);
  });

  it("the surface is curated, not the 73-verb union", () => {
    expect(MCP_TOOLS.length).toBeLessThan(10);
    // `toSorted`, not `sort` — `allNames` is shared across this file and an
    // in-place sort would silently reorder other tests' expectations.
    expect(allNames.toSorted()).toEqual(["abort", "list_sessions", "send_prompt", "spawn_session"]);
  });
});

describe("E25 — abort maps to the general session primitive", () => {
  it("uses abortSession, not the plugin-spawned-run hard kill", () => {
    const abort = findTool("abort");
    expect(abort?.contextMember).toBe("abortSession");
  });

  it("abortSpawnedRun is denied and backs nothing (Decision 13 — no kill ladder)", () => {
    expect(DENIED_CONTEXT_MEMBERS).toContain("abortSpawnedRun");
    // Compared as a plain string: the type of `contextMember` is narrowed to
    // the allowlist, so a direct comparison is a compile error rather than a
    // runtime assertion — and would stop expressing the guarantee.
    expect(MCP_TOOLS.some((t) => (t.contextMember as string) === "abortSpawnedRun")).toBe(false);
  });

  it("documents the soft-only limit so a false success is not implied", () => {
    expect(findTool("abort")?.description).toMatch(/soft abort only/i);
  });
});

describe("E26 — sessionId is an ordinary tool argument", () => {
  it("every session-targeting tool requires sessionId in its schema", () => {
    for (const tool of MCP_TOOLS.filter((t) => t.targetsSession)) {
      expect(tool.inputSchema.properties).toHaveProperty("sessionId");
      expect(tool.inputSchema.required).toContain("sessionId");
    }
  });

  it("no tool accepts extra arguments, so an unknown field cannot smuggle identity", () => {
    // M3: a client-supplied session claim must be ignored. Sealing the schema
    // means such a field is a schema violation rather than silent input.
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("non-targeting tools do not take a sessionId at all", () => {
    for (const tool of MCP_TOOLS.filter((t) => !t.targetsSession)) {
      expect(tool.inputSchema.properties).not.toHaveProperty("sessionId");
    }
  });
});

describe("E22 — completeness check passes for the real table", () => {
  it("every advertised tool resolves to an invocable handler", () => {
    expect(checkToolCompleteness(MCP_TOOLS, resolverFor(allNames))).toEqual({
      ok: true,
      missing: [],
    });
  });
});

describe("E23 — the completeness check is NOT vacuous", () => {
  it("FAILS when a deliberately unresolvable tool is added to the table", () => {
    const rogue: McpToolDef = {
      name: "ghost_tool",
      description: "Advertised but backed by nothing.",
      contextMember: "sessionManager",
      inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
      targetsSession: false,
    };
    const r = checkToolCompleteness([...MCP_TOOLS, rogue], resolverFor(allNames));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["ghost_tool"]);
  });

  it("FAILS when a real tool's handler goes missing", () => {
    const r = checkToolCompleteness(
      MCP_TOOLS,
      resolverFor(allNames.filter((n) => n !== "send_prompt")),
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["send_prompt"]);
  });

  it("FAILS when a resolver returns a non-function, not just undefined", () => {
    // An advertised tool wired to a truthy non-callable is the exact
    // "silently fails" shape the denylist.ts lesson warns about.
    const r = checkToolCompleteness(
      MCP_TOOLS,
      (() => "not-a-function") as unknown as (n: string) => undefined,
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(allNames);
  });
});

describe("findTool", () => {
  it("returns undefined for an unknown or malformed name", () => {
    expect(findTool("tools/nope")).toBeUndefined();
    expect(findTool(undefined)).toBeUndefined();
    expect(findTool(42)).toBeUndefined();
    expect(findTool({ name: "abort" })).toBeUndefined();
  });
});
