import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { NestedProcessSupervisor, type NestedRunEvent } from "./nested-process-supervisor.js";
import { lookupRole } from "./role-manager.js";

/**
 * Opt-in dashboard-owned `Agent` / `doubt` tools whose child inference runs in
 * an independently stoppable worker process.
 *
 * Disabled by default: the published `@blackbelt-technology/pi-dashboard-subagents`
 * tool stays authoritative unless `PI_DASHBOARD_ISOLATED_NESTED_TOOLS=1`. A
 * nested worker never re-registers (its env carries `PI_DASHBOARD_NESTED_WORKER`),
 * so a child cannot spawn a grandchild for the same tool call.
 *
 * See change: fix-terminal-session-cancellation-boundaries (design D5).
 */

interface AgentArgs {
  subagent_type: string;
  description: string;
  prompt: string;
  model?: string;
}

interface DoubtArgs {
  path?: string;
  artifact?: string;
  criteria?: string[];
}

interface AgentMdConfig {
  path?: string;
  description?: string;
  model?: string;
  tools?: string[];
  prompt?: string;
}

interface TimelineEntry {
  kind: "text" | "error";
  text: string;
  ts: number;
}

export interface IsolatedAgentDetails {
  agentId: string;
  agentSessionId?: string;
  displayName: string;
  description: string;
  subagentType: string;
  status: "queued" | "running" | "completed" | "aborted" | "error";
  entries: TimelineEntry[];
  toolUses: number;
  turnCount: number;
  startedAt: number;
  modelName?: string;
  agentMdPath?: string;
  error?: string;
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: IsolatedAgentDetails;
  isError?: boolean;
}

interface MinimalCtx {
  cwd: string;
  model?: { provider?: string; id?: string } | undefined;
}

interface MinimalPi {
  registerTool: (tool: unknown) => void;
  events?: { emit: (channel: string, data: unknown) => void };
}

export interface RegisterIsolatedNestedToolsOptions {
  supervisor?: NestedProcessSupervisor;
  /** Test seam: defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_CRITERIA = ["yagni-doubt", "edge-case-coverage"] as const;
const MAX_ARTIFACT_CHARS = 100_000;

export function isolatedNestedToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PI_DASHBOARD_ISOLATED_NESTED_TOOLS === "1" && env.PI_DASHBOARD_NESTED_WORKER !== "1";
}

export function registerIsolatedNestedTools(
  pi: MinimalPi,
  options: RegisterIsolatedNestedToolsOptions = {},
): boolean {
  if (!isolatedNestedToolsEnabled(options.env)) return false;
  const supervisor = options.supervisor ?? new NestedProcessSupervisor();
  const publish = (channel: string, data: unknown) => pi.events?.emit(channel, data);

  pi.registerTool({
    name: "Agent",
    label: "Agent",
    description:
      "Spawn a foreground subagent in a separately identifiable dashboard worker process. Runs synchronously; the parent can always cancel it.",
    parameters: Type.Object({
      subagent_type: Type.String({ description: "Agent type label; matches `.pi/agents/<type>.md` when present." }),
      description: Type.String({ description: "Short human-readable description of the task." }),
      prompt: Type.String({ description: "The full task prompt for the subagent." }),
      model: Type.Optional(Type.String({ description: 'Optional model override: "@role" or "provider/model-id".' })),
    }),
    execute: (
      _toolCallId: string,
      params: AgentArgs,
      signal: AbortSignal | undefined,
      onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details: IsolatedAgentDetails }) => void) | undefined,
      ctx: MinimalCtx,
    ) => runIsolatedAgent(supervisor, params, signal, onUpdate, ctx, publish),
  });

  pi.registerTool({
    name: "doubt",
    label: "doubt",
    description:
      "Run an external-auditor subagent against an artifact in a separately identifiable dashboard worker process.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Path to the artifact file to audit." })),
      artifact: Type.Optional(Type.String({ description: "Inline artifact text (used when path is omitted)." })),
      criteria: Type.Optional(Type.Array(Type.String(), { description: "Doubt criteria to apply." })),
    }),
    execute: (
      _toolCallId: string,
      params: DoubtArgs,
      signal: AbortSignal | undefined,
      onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details: IsolatedAgentDetails }) => void) | undefined,
      ctx: MinimalCtx,
    ) => runIsolatedDoubt(supervisor, params, signal, onUpdate, ctx, publish),
  });

  return true;
}

async function runIsolatedAgent(
  supervisor: NestedProcessSupervisor,
  args: AgentArgs,
  signal: AbortSignal | undefined,
  onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details: IsolatedAgentDetails }) => void) | undefined,
  ctx: MinimalCtx,
  publish: PublishSubagent,
): Promise<ToolResult> {
  const config = readAgentMd(args.subagent_type, ctx.cwd);
  const prompt = [
    config.prompt ? `<agent-prompt>\n${config.prompt}\n</agent-prompt>` : undefined,
    `<task>\n${args.prompt}\n</task>`,
  ]
    .filter((part): part is string => part !== undefined)
    .join("\n\n");

  return execute({
    supervisor,
    signal,
    onUpdate,
    cwd: ctx.cwd,
    subagentType: args.subagent_type,
    description: args.description,
    displayName: config.description ?? args.subagent_type,
    agentMdPath: config.path,
    prompt,
    tools: config.tools,
    modelRef: firstNonEmpty(args.model, config.model),
    fallbackModel: ctx.model,
    publish,
  });
}

async function runIsolatedDoubt(
  supervisor: NestedProcessSupervisor,
  args: DoubtArgs,
  signal: AbortSignal | undefined,
  onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details: IsolatedAgentDetails }) => void) | undefined,
  ctx: MinimalCtx,
  publish: PublishSubagent,
): Promise<ToolResult> {
  const criteria = args.criteria?.length ? args.criteria : [...DEFAULT_CRITERIA];
  let artifact = args.artifact;
  let source = "inline artifact";
  if (!artifact && args.path) {
    const absolute = resolve(ctx.cwd, args.path);
    try {
      artifact = readFileSync(absolute, "utf-8").slice(0, MAX_ARTIFACT_CHARS);
      source = absolute;
    } catch (error) {
      return errorResult(
        buildDetails({ subagentType: "doubt", description: "audit artifact", displayName: "doubt" }),
        `Could not read artifact at ${absolute}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!artifact) {
    return errorResult(
      buildDetails({ subagentType: "doubt", description: "audit artifact", displayName: "doubt" }),
      "doubt requires either `path` or `artifact`.",
    );
  }

  const prompt = [
    "You are an EXTERNAL AUDITOR. You did NOT write the artifact below. Attack it:",
    "name what is unnecessary, what is missing, and what is riskier than needed.",
    `Criteria: ${criteria.join(", ")}.`,
    `Artifact source: ${source}`,
    `<artifact>\n${artifact}\n</artifact>`,
  ].join("\n\n");

  return execute({
    supervisor,
    signal,
    onUpdate,
    cwd: ctx.cwd,
    subagentType: "doubt",
    description: "audit artifact",
    displayName: "doubt",
    prompt,
    fallbackModel: ctx.model,
    publish,
  });
}

interface ExecuteArgs {
  supervisor: NestedProcessSupervisor;
  signal: AbortSignal | undefined;
  onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details: IsolatedAgentDetails }) => void) | undefined;
  cwd: string;
  subagentType: string;
  description: string;
  displayName: string;
  prompt: string;
  agentMdPath?: string;
  tools?: string[];
  modelRef?: string;
  fallbackModel?: { provider?: string; id?: string } | undefined;
  publish: PublishSubagent;
}

type PublishSubagent = (channel: string, data: unknown) => void;

async function execute(args: ExecuteArgs): Promise<ToolResult> {
  const details = buildDetails({
    subagentType: args.subagentType,
    description: args.description,
    displayName: args.displayName,
    agentMdPath: args.agentMdPath,
  });
  const resolvedModel = resolveModelRef(args.modelRef);
  if (resolvedModel.error) return errorResult(details, resolvedModel.error);

  const model = resolvedModel.model ?? args.fallbackModel;
  details.modelName = model?.id;
  args.publish("subagents:created", {
    id: details.agentId,
    type: details.subagentType,
    description: details.description,
    details,
  });
  details.status = "running";
  args.publish("subagents:started", {
    id: details.agentId,
    type: details.subagentType,
    description: details.description,
    details,
  });

  const result = await args.supervisor.run(
    {
      runId: details.agentId,
      cwd: args.cwd,
      prompt: args.prompt,
      ...(model ? { model } : {}),
      ...(resolvedModel.thinkingLevel ? { thinkingLevel: resolvedModel.thinkingLevel } : {}),
      ...(args.tools ? { tools: args.tools } : {}),
    },
    {
      signal: args.signal,
      onEvent: (event: NestedRunEvent) => {
        const inner = event.event as { type?: string; sessionId?: string } | undefined;
        if (inner?.type === "worker_ready" && typeof inner.sessionId === "string") {
          details.agentSessionId = inner.sessionId;
        }
        if (inner?.type === "tool_execution_end") details.toolUses += 1;
        if (inner?.type === "message_end") details.turnCount += 1;
        args.publish("subagents:started", { id: details.agentId, details });
        args.onUpdate?.({ content: [{ type: "text", text: "(running…)" }], details: { ...details } });
      },
    },
  );

  if (result.status === "completed") {
    details.status = "completed";
    const text = result.result?.trim() || "(no output)";
    details.entries.push({ kind: "text", text, ts: Date.now() });
    args.publish("subagents:completed", {
      id: details.agentId,
      result: text,
      durationMs: Date.now() - details.startedAt,
      tokens: { input: 0, output: 0, total: 0 },
      toolUses: details.toolUses,
      details,
    });
    return { content: [{ type: "text", text }], details };
  }
  if (result.status === "error") {
    return errorResult(details, result.error ?? "Nested run failed.", args.publish);
  }
  details.status = "aborted";
  const message =
    result.status === "forced"
      ? `Subagent did not stop cooperatively and its process tree was terminated${result.error ? ` (${result.error})` : ""}.`
      : "Subagent aborted by parent.";
  details.error = message;
  details.entries.push({ kind: "error", text: message, ts: Date.now() });
  args.publish("subagents:failed", {
    id: details.agentId,
    error: message,
    durationMs: Date.now() - details.startedAt,
    toolUses: details.toolUses,
    details: { ...details, status: "error" },
  });
  return { content: [{ type: "text", text: message }], details, isError: true };
}

function buildDetails(args: {
  subagentType: string;
  description: string;
  displayName: string;
  agentMdPath?: string;
}): IsolatedAgentDetails {
  return {
    agentId: randomUUID(),
    displayName: args.displayName,
    description: args.description,
    subagentType: args.subagentType,
    status: "queued",
    entries: [],
    toolUses: 0,
    turnCount: 0,
    startedAt: Date.now(),
    ...(args.agentMdPath ? { agentMdPath: args.agentMdPath } : {}),
  };
}

function errorResult(details: IsolatedAgentDetails, message: string, publish?: PublishSubagent): ToolResult {
  details.status = "error";
  details.error = message;
  details.entries.push({ kind: "error", text: message, ts: Date.now() });
  publish?.("subagents:failed", {
    id: details.agentId,
    error: message,
    durationMs: Date.now() - details.startedAt,
    toolUses: details.toolUses,
    details,
  });
  return { content: [{ type: "text", text: message }], details, isError: true };
}

export function resolveModelRef(ref: string | undefined): {
  model?: { provider: string; id: string };
  thinkingLevel?: string;
  error?: string;
} {
  const trimmed = ref?.trim();
  if (!trimmed) return {};

  let literal = trimmed;
  if (trimmed.startsWith("@")) {
    const { literal: mapped, reason } = lookupRole(trimmed);
    if (!mapped) return { error: `Could not resolve model reference "${trimmed}": ${reason}` };
    literal = mapped;
  }

  const slash = literal.indexOf("/");
  if (slash <= 0) return { error: `Model reference "${trimmed}" must resolve to "provider/model-id".` };
  const provider = literal.slice(0, slash);
  let id = literal.slice(slash + 1);
  let thinkingLevel: string | undefined;
  const colon = id.lastIndexOf(":");
  if (colon > 0) {
    const suffix = id.slice(colon + 1);
    if (THINKING_LEVELS.has(suffix)) {
      thinkingLevel = suffix === "off" ? undefined : suffix;
      id = id.slice(0, colon);
    }
  }
  if (!id) return { error: `Model reference "${trimmed}" must resolve to "provider/model-id".` };
  return { model: { provider, id }, ...(thinkingLevel ? { thinkingLevel } : {}) };
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function readAgentMd(subagentType: string, cwd: string): AgentMdConfig {
  for (const candidate of [
    join(cwd, ".pi", "agents", `${subagentType}.md`),
    join(homedir(), ".pi", "agent", "agents", `${subagentType}.md`),
  ]) {
    if (!existsSync(candidate)) continue;
    try {
      return { ...parseAgentMd(readFileSync(candidate, "utf-8")), path: candidate };
    } catch {
      return { path: candidate };
    }
  }
  return {};
}

/** Minimal frontmatter reader for the fields this adapter honours. */
export function parseAgentMd(raw: string): AgentMdConfig {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return {};
  const [, frontmatter, body] = match;
  const config = frontmatter.split("\n").reduce(parseAgentMdLine, {} as AgentMdConfig);
  const prompt = body.trim();
  if (prompt) config.prompt = prompt;
  return config;
}

function parseAgentMdLine(config: AgentMdConfig, line: string): AgentMdConfig {
  const separator = line.indexOf(":");
  if (separator <= 0) return config;
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  if (!value) return config;
  if (key === "description") return { ...config, description: value };
  if (key === "model") return { ...config, model: value };
  if (key !== "tools") return config;
  const tools = value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);
  return tools.length > 0 ? { ...config, tools } : config;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value?.trim()) return value.trim();
  }
  return undefined;
}
