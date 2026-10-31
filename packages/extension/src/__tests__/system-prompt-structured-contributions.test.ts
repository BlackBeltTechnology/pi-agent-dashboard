/**
 * Boundary regression: first-party `before_agent_start` injectors must not force
 * the system prompt, so structured contributions from other handlers (roles
 * plugin Agent guideline, pi-owned `mcp_servers` section) reach the provider.
 *
 * `runChain` mirrors pi's `ExtensionRunner.emitBeforeAgentStart`: one shared
 * mutable options object, `event.systemPrompt` rendered at read time, and a
 * returned `systemPrompt` becoming `forceSystemPrompt`. The provider-visible
 * prompt is `forceSystemPrompt ?? buildSystemPrompt(options)` (pi
 * `buildSystemPromptState`). Rendering uses pi's own `buildSystemPrompt`.
 *
 * See change: fix-forced-system-prompt-drops-tool-guidelines (design D6/D8).
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import kbExtension from "../../../kb-extension/src/extension.js";
import rolesBridge from "../../../roles-plugin/src/bridge/index.js";
import { CONTEXT_DELIMITER, registerDashboardContextInjector } from "../dashboard-context-injector.js";

type Handler = (event: any) => any;
type BuildSystemPrompt = (options: Record<string, unknown>) => string;

/** pi's renderer is not in its `exports` map; locate the file via node_modules lookup paths. */
async function loadBuildSystemPrompt(): Promise<BuildSystemPrompt> {
  const rel = "@earendil-works/pi-coding-agent/dist/core/system-prompt.js";
  const dirs = createRequire(import.meta.url).resolve.paths("x") ?? [];
  const file = dirs.map((d) => join(d, rel)).find((p) => existsSync(p));
  if (!file) throw new Error(`pi system-prompt.js not found under ${dirs.join(", ")}`);
  const mod = await import(pathToFileURL(file).href);
  return mod.buildSystemPrompt as BuildSystemPrompt;
}

function providerPrompt(build: BuildSystemPrompt, handlers: Handler[], options: Record<string, any>): {
  text: string;
  forced: boolean;
} {
  for (const h of handlers) {
    const event = {
      type: "before_agent_start",
      prompt: "hi",
      get systemPrompt() {
        return build(options);
      },
      systemPromptOptions: options,
    };
    const r = h(event);
    if (r && typeof r.systemPrompt === "string") options.forceSystemPrompt = r.systemPrompt;
  }
  const forced = options.forceSystemPrompt !== undefined;
  return { text: forced ? options.forceSystemPrompt : build(options), forced };
}

let home: string;
let cwd: string;
let prevHome: string | undefined;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sp-chain-home-"));
  cwd = mkdtempSync(join(tmpdir(), "sp-chain-cwd-"));
  prevHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

describe("first-party injectors keep structured contributions provider-visible", () => {
  it.each([
    ["dashboard, kb, roles", false],
    ["kb, dashboard, roles", true],
  ])("%s: every contribution reaches the provider prompt", async (_label, kbFirst) => {
    const build = await loadBuildSystemPrompt();
    const handlers: Handler[] = [];
    const pi = {
      on: (evt: string, h: Handler) => {
        if (evt === "before_agent_start") handlers.push(h);
      },
      registerTool: () => {},
      sendMessage: () => {},
      events: {
        emit: (channel: string, data: any) => {
          if (channel === "roles:get-all") data.roles = { fast: "anthropic/claude-haiku-4-5" };
        },
        on: () => {},
      },
    };
    // Real sessions load the roles plugin bridge last (settings `packages[]`);
    // the two first-party injectors must compose in either order.
    const dashboard = () =>
      registerDashboardContextInjector(pi as any, () => ({ sessionId: "S1", attachedChange: null }), () => true);
    if (kbFirst) {
      kbExtension(pi as any);
      dashboard();
    } else {
      dashboard();
      kbExtension(pi as any);
    }
    rolesBridge(pi);

    const options: Record<string, any> = {
      cwd,
      selectedTools: ["read", "bash", "Agent"],
      toolGuidelines: {},
      sections: { mcp_servers: "MCP servers whose tools are not declared to you." },
    };
    const { text, forced } = providerPrompt(build, handlers, options);

    expect(forced).toBe(false);
    expect(text).toContain(CONTEXT_DELIMITER);
    expect(text).toContain("── dox doctrine ──");
    expect(text).toContain('prefer a role ref `model: "@<role>"`');
    // The roles fragment points at `list_roles` instead of listing roles.
    // See change: roles-discovery-via-list-roles (#1091).
    expect(text).toContain("Call `list_roles`");
    expect(text).toContain("<mcp_servers>");
    // Exactly one of each fragment.
    expect(text.split(CONTEXT_DELIMITER)).toHaveLength(2);
    expect(text.split("── dox doctrine ──")).toHaveLength(2);
  });
});
