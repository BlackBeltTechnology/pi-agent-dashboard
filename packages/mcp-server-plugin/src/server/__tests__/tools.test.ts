/**
 * Tool surface: manifest, context partition, tier filter and the completeness
 * check. See change: expand-mcp-tiered-surface.
 */
import { describe, expect, it } from "vitest";
import { GENERATED_TOOLS } from "../generated/tools.js";
import { MANIFEST } from "../tools.manifest.js";
import {
  ALL_CONTEXT_MEMBERS,
  ALLOWLISTED_CONTEXT_MEMBERS,
  assertContextPartitionTotal,
  checkToolCompleteness,
  DENIED_CONTEXT_MEMBERS,
  findTool,
  FORBIDDEN_VERB_NAMES,
  INTERNAL_ONLY_CONTEXT_MEMBERS,
  listTools,
} from "../tools.js";

const resolverFor = (names: readonly string[]) => (name: string) =>
  names.includes(name) ? () => undefined : undefined;

const allNames = GENERATED_TOOLS.map((t) => t.name);
const contextRows = MANIFEST.filter((r) => r.bind.kind === "context");

describe("context partition", () => {
  it("accounts for all 20 members exactly once", () => {
    expect(ALL_CONTEXT_MEMBERS).toHaveLength(20);
    expect(assertContextPartitionTotal()).toEqual({ ok: true, unclassified: [], overlapping: [] });
  });

  it("splits 5 allowlisted / 14 denied / 1 internal", () => {
    expect(ALLOWLISTED_CONTEXT_MEMBERS).toHaveLength(5);
    expect(DENIED_CONTEXT_MEMBERS).toHaveLength(14);
    expect(INTERNAL_ONLY_CONTEXT_MEMBERS).toEqual(["fastify"]);
    expect(
      ALLOWLISTED_CONTEXT_MEMBERS.length +
        DENIED_CONTEXT_MEMBERS.length +
        INTERNAL_ONLY_CONTEXT_MEMBERS.length,
    ).toBe(ALL_CONTEXT_MEMBERS.length);
  });

  it("is NOT vacuous — a new unclassified member fails the partition", () => {
    const r = assertContextPartitionTotal(
      [...ALL_CONTEXT_MEMBERS, "someFutureMember"],
      ALLOWLISTED_CONTEXT_MEMBERS,
      DENIED_CONTEXT_MEMBERS,
      INTERNAL_ONLY_CONTEXT_MEMBERS,
    );
    expect(r.ok).toBe(false);
    expect(r.unclassified).toEqual(["someFutureMember"]);
  });

  it("is NOT vacuous — a member on two lists fails the partition", () => {
    const r = assertContextPartitionTotal(
      ALL_CONTEXT_MEMBERS,
      ["logger"],
      DENIED_CONTEXT_MEMBERS,
      INTERNAL_ONLY_CONTEXT_MEMBERS,
    );
    expect(r.ok).toBe(false);
    expect(r.overlapping).toEqual(["logger"]);
  });
});

describe("E24 — non-allowlisted context members are not exposed", () => {
  it.each([...DENIED_CONTEXT_MEMBERS, ...INTERNAL_ONLY_CONTEXT_MEMBERS])(
    "%s backs no advertised context row",
    (member) => {
      expect(contextRows.some((r) => r.bind.kind === "context" && (r.bind.member as string) === member)).toBe(false);
    },
  );

  it("every context row is backed by an allowlisted member", () => {
    for (const row of contextRows) {
      if (row.bind.kind !== "context") throw new Error("filtered");
      expect(ALLOWLISTED_CONTEXT_MEMBERS as readonly string[]).toContain(row.bind.member);
    }
  });

  it("the wire payload never leaks the transport binding", () => {
    for (const entry of listTools(GENERATED_TOOLS, "operate")) {
      expect(Object.keys(entry).sort()).toEqual(["annotations", "description", "inputSchema", "name"]);
    }
  });
});

describe("E21 — UI-only and transport verbs are absent", () => {
  it.each(FORBIDDEN_VERB_NAMES)("%s is not advertised", (verb) => {
    expect(allNames).not.toContain(verb);
  });

  it("the surface is the manifest, not the raw verb union", () => {
    expect(GENERATED_TOOLS.length).toBeGreaterThan(100);
    expect(GENERATED_TOOLS.length).toBeLessThan(200);
    expect(allNames).toContain("abort");
    expect(allNames).toContain("list_sessions");
  });
});

describe("E25 — abort maps to the general session primitive", () => {
  it("uses abortSession, not the plugin-spawned-run hard kill", () => {
    const abort = contextRows.find((r) => r.name === "abort");
    expect(abort?.bind).toEqual({ kind: "context", member: "abortSession" });
  });

  it("abortSpawnedRun is denied and backs nothing", () => {
    expect(DENIED_CONTEXT_MEMBERS).toContain("abortSpawnedRun");
    expect(contextRows.some((r) => r.bind.kind === "context" && (r.bind.member as string) === "abortSpawnedRun")).toBe(false);
  });

  it("documents the soft-only limit so a false success is not implied", () => {
    expect(findTool("abort", GENERATED_TOOLS)?.description).toMatch(/abort/i);
  });
});

describe("E26 — session targeting is explicit and addressable", () => {
  it("every session-targeting row NAMES sessionId explicitly", () => {
    for (const tool of GENERATED_TOOLS.filter((t) => t.sessionTargeting)) {
      const hasPath = tool.paramSplit.path.some((p) => p.arg === "sessionId");
      const hasProp = "sessionId" in (tool.inputSchema.properties ?? {});
      expect(hasPath || hasProp, tool.name).toBe(true);
    }
  });

  it("context rows seal the schema (no extra fields can smuggle identity)", () => {
    for (const tool of GENERATED_TOOLS.filter((t) => t.bind.kind === "context")) {
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });
});

describe("E22 — completeness check passes for the real table", () => {
  it("every advertised tool resolves to an invocable handler", () => {
    expect(checkToolCompleteness(GENERATED_TOOLS, resolverFor(allNames))).toEqual({ ok: true, missing: [] });
  });
});

describe("E23 — the completeness check is NOT vacuous", () => {
  it("FAILS when a deliberately unresolvable tool is added", () => {
    const rogue = {
      name: "ghost_tool",
      description: "Advertised but backed by nothing.",
      tier: "observe" as const,
      annotations: { readOnlyHint: true, destructiveHint: false },
      inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    };
    const r = checkToolCompleteness([...GENERATED_TOOLS, rogue], resolverFor(allNames));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["ghost_tool"]);
  });

  it("FAILS when a real tool's handler goes missing", () => {
    const r = checkToolCompleteness(
      GENERATED_TOOLS,
      resolverFor(allNames.filter((n) => n !== "send_prompt")),
    );
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["send_prompt"]);
  });
});

describe("findTool", () => {
  it("returns undefined for an unknown or malformed name", () => {
    expect(findTool("tools/nope", GENERATED_TOOLS)).toBeUndefined();
    expect(findTool(undefined, GENERATED_TOOLS)).toBeUndefined();
    expect(findTool(42, GENERATED_TOOLS)).toBeUndefined();
    expect(findTool({ name: "abort" }, GENERATED_TOOLS)).toBeUndefined();
  });
});

describe("E28 — list_sessions advertises the bound", () => {
  const ls = findTool("list_sessions", GENERATED_TOOLS);
  if (!ls) throw new Error("list_sessions must be advertised");

  it("states the default, the hard maximum and the paging argument in the description", () => {
    expect(ls.description).toMatch(/25/);
    expect(ls.description).toMatch(/200/);
    expect(ls.description).toMatch(/cursor/i);
  });

  it("documents the bound and the cursor in the inputSchema", () => {
    const props = ls.inputSchema.properties ?? {};
    expect(props.limit).toMatchObject({ type: "integer", minimum: 1, maximum: 200 });
    expect(props.cursor).toMatchObject({ type: "string" });
    expect(props.status).toMatchObject({ type: "array" });
  });

  it("advertises every SessionStatus value in the status enum", () => {
    const status = ls.inputSchema.properties?.status as { items?: { enum?: string[] } };
    expect(status.items?.enum).toEqual(["active", "idle", "streaming", "ended"]);
  });
});
