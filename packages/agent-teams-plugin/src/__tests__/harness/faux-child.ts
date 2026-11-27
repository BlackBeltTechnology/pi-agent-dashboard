/**
 * ⟦faux⟧ in-process child: a REAL pi `AgentSession` (SDK `createAgentSession`, in-memory session) driven by pi-ai's faux provider,
 * built the way the subagents package builds a child — a `DefaultResourceLoader` with the loader options of the spawn request
 * (`extensionFactories`, `noExtensions`, `noContextFiles`, `appendSystemPrompt`), the extensions loaded first and the tool allowlist
 * (`setActiveToolsByName`) applied AFTER they loaded (design D9: the package intersects its allowlist after extension load).
 * This is NOT the upstream package (`⟦upstream⟧` rows stay pending its release); it proves what pi itself does with the extension and
 * the loader options. Each request the faux model receives is recorded: system prompt text, active tools at that moment, messages.
 * Importing pi's SDK is heavy (~1 s warm): only the suites that need a real child use this module.
 * See change: add-agent-teams-in-process.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as piAi from "@earendil-works/pi-ai";
import * as piCoding from "@earendil-works/pi-coding-agent";

// pi-ai's published `index.d.ts` re-exports with `.ts` extensions (unresolvable under `moduleResolution: bundler`): read the runtime helpers off an `any` view.
const { fauxAssistantMessage, fauxProvider, fauxToolCall } = piAi as unknown as {
  fauxAssistantMessage: (content: unknown, options?: unknown) => unknown;
  fauxProvider: (options: Record<string, unknown>) => { setResponses(r: unknown[]): void; getModel(): unknown; provider: { streamSimple?: unknown } };
  fauxToolCall: (name: string, args: Record<string, unknown>) => unknown;
};

// Same for the SDK: the runtime classes are read off an `any` view (the root tsc cannot resolve its `.ts` re-exports).
const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = piCoding as unknown as {
  createAgentSession: (options: Record<string, unknown>) => Promise<{ session: unknown }>;
  DefaultResourceLoader: new (options: Record<string, unknown>) => { reload(): Promise<void> };
  SessionManager: { inMemory(cwd: string): unknown };
  SettingsManager: { inMemory(): unknown };
};

export { fauxAssistantMessage, fauxToolCall };

/** One request the faux model received. */
interface FauxRequest {
  /** The system prompt text (all sections joined). */
  system: string;
  /** Tools pi declared to the model for this request. */
  activeTools: string[];
  /** Name, description and parameter schema of every active tool (what the request declares to the model). */
  toolSchemas: Array<{ name: string; description: string; parameters: unknown }>;
  /** The non-system transcript. */
  messages: Array<Record<string, unknown>>;
}

// pi's ExtensionAPI/AgentSession types are not part of this package's compile surface
type Any = any;

export interface FauxChildOptions {
  /** Inline extension factories (the team extension first; foreign ones after). */
  extensionFactories: Array<(pi: Any) => void | Promise<void>>;
  /** Scripted model turns (`fauxAssistantMessage(…)`), in order. */
  script: unknown[];
  cwd?: string;
  /** Written into `<agentDir>/extensions/<name>.ts`: "discovered" extensions of the lead (loaded unless `noExtensions`). */
  discovered?: Record<string, string>;
  noExtensions?: boolean;
  noContextFiles?: boolean;
  appendSystemPrompt?: string[];
  /** Loader skill options of the spawn request (`loader_skills`): `noSkills` defaults to true (the package's child loaders). */
  noSkills?: boolean;
  additionalSkillPaths?: string[];
  /** The package's tool allowlist, applied after the extensions loaded (`undefined` ⇒ none applied). */
  allowlist?: string[];
  /** Project files (`AGENTS.md`) written into `cwd` before the loader runs. */
  projectFiles?: Record<string, string>;
}

export interface FauxChild {
  session: Any;
  requests: FauxRequest[];
  /** Prompt the child (the run's `agent_start` … end); resolves when the run settles. */
  run(prompt: string): Promise<void>;
  /** Active tool names right now. */
  activeTools(): string[];
  /** Tool results of the transcript: `{tool, text, isError}`. */
  toolResults(): Array<{ tool: string; text: string; isError: boolean }>;
  dispose(): void;
}

/** The text of a system message (`content` and/or named `sections`). */
function systemText(message: Record<string, unknown> | undefined): string {
  if (!message) return "";
  const parts: string[] = [];
  if (typeof message.content === "string" && message.content !== "") parts.push(message.content);
  const sections = message.sections;
  if (sections && typeof sections === "object") for (const v of Object.values(sections)) if (typeof v === "string") parts.push(v);
  return parts.join("\n\n");
}

export async function startFauxChild(opts: FauxChildOptions): Promise<FauxChild> {
  const root = mkdtempSync(path.join(tmpdir(), "faux-child-"));
  const cwd = opts.cwd ?? path.join(root, "work");
  const agentDir = path.join(root, "agent");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(path.join(agentDir, "extensions"), { recursive: true });
  for (const [name, source] of Object.entries(opts.discovered ?? {})) writeFileSync(path.join(agentDir, "extensions", `${name}.ts`), source);
  for (const [file, text] of Object.entries(opts.projectFiles ?? {})) writeFileSync(path.join(cwd, file), text);

  const faux = fauxProvider({ api: "faux" });
  const requests: FauxRequest[] = [];
  let session: Any;
  faux.setResponses(
    opts.script.map((step) => (ctx: { messages: Array<Record<string, unknown>> }) => {
      const [first, ...rest] = ctx.messages;
      const active: string[] = session ? [...session.getActiveToolNames()] : [];
      const schemas = session ? (session.getAllTools() as Array<{ name: string; description: string; parameters: unknown }>).filter((t) => active.includes(t.name)).map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) : [];
      requests.push({ system: systemText(first?.role === "system" ? first : undefined), activeTools: active, toolSchemas: schemas, messages: first?.role === "system" ? rest : ctx.messages });
      return typeof step === "function" ? (step as (c: unknown) => unknown)(ctx) : step;
    }),
  );
  const providerExtension = (pi: Any): void => {
    pi.registerProvider("faux", {
      name: "Faux",
      baseUrl: "http://localhost:0",
      apiKey: "faux-no-key",
      api: "faux",
      streamSimple: faux.provider.streamSimple,
      models: [{ id: "faux-1", name: "faux-1", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 16384 }],
    });
  };

  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    extensionFactories: [providerExtension, ...opts.extensionFactories],
    ...(opts.noExtensions ? { noExtensions: true } : {}),
    noSkills: opts.noSkills ?? true,
    ...(opts.additionalSkillPaths ? { additionalSkillPaths: opts.additionalSkillPaths } : {}),
    noContextFiles: opts.noContextFiles ?? false,
    ...(opts.appendSystemPrompt ? { appendSystemPrompt: opts.appendSystemPrompt } : {}),
  });
  await resourceLoader.reload();
  const created = await createAgentSession({ cwd, agentDir, resourceLoader, sessionManager: SessionManager.inMemory(cwd), settingsManager, model: faux.getModel() });
  session = created.session;
  await session.bindExtensions({}); // fires `session_start`
  if (opts.allowlist) {
    const all: string[] = session.getAllTools().map((t: { name: string }) => t.name);
    session.setActiveToolsByName(all.filter((n) => opts.allowlist?.includes(n)));
  }

  return {
    session,
    requests,
    async run(prompt) {
      await session.prompt(prompt);
    },
    activeTools: () => [...session.getActiveToolNames()],
    toolResults() {
      const out: Array<{ tool: string; text: string; isError: boolean }> = [];
      for (const m of session.messages as Array<Record<string, unknown>>) {
        if (m.role !== "toolResult") continue;
        const content = Array.isArray(m.content) ? (m.content as Array<{ type?: string; text?: string }>) : [];
        out.push({ tool: String(m.toolName), text: content.map((c) => c.text ?? "").join(""), isError: m.isError === true });
      }
      return out;
    },
    dispose: () => session.dispose?.(),
  };
}
