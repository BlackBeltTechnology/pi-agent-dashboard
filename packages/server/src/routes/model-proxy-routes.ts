/**
 * Model proxy route handlers: /v1/models, /v1/chat/completions, /v1/messages.
 *
 * OpenAI- and Anthropic-compatible endpoints fronting the dashboard's
 * model registry via pi-ai's streamSimple.
 *
 * See change: add-dashboard-model-proxy.
 */
import crypto from "node:crypto";
import type { ModelProxyConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { parseModelId } from "@blackbelt-technology/pi-dashboard-shared/model-id.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ConcurrencyError, ConcurrencyTracker } from "../model-proxy/concurrency.js";
import {
  AnthropicBlockTracker,
  type AnthropicMessagesRequest,
  convertAnthropicMessages,
  convertAnthropicTools,
  convertOpenAIMessages,
  convertOpenAITools,
  eventToAnthropicResponse,
  eventToAnthropicSSE,
  eventToNonStreamingResponse,
  eventToSSEChunks,
  type OpenAIMessage,
  type OpenAITool,
  ToolCallIndexTracker,
} from "../model-proxy/convert/index.js";
import { logRequest, type RequestLogEntry } from "../model-proxy/request-log.js";

export interface ModelProxyRouteDeps {
  getConfig: () => ModelProxyConfig;
  /** Resolve the model registry. Returns null when pi-ai is unavailable. */
  getRegistry: () => Promise<ModelProxyRegistry | null>;
}

/**
 * A registry model as the routes see it. pi-ai's `Model` is runtime-resolved,
 * so only the fields the routes read are declared.
 */
export interface ProxyModel {
  id: string;
  provider: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  cost?: unknown;
  input?: unknown;
}

/** Minimal interface for the model registry consumed by route handlers. */
export interface ModelProxyRegistry {
  getAvailable(): Promise<ProxyModel[]>;
  find(provider: string, modelId: string): Promise<ProxyModel | null>;
  /**
   * Walk an ordered list of fully-qualified `provider/id`s, returning the first
   * entry available in the registry (or null). See change:
   * fix-and-prefer-model-proxy-resolution.
   */
  firstAvailable(preferred: string[]): Promise<ProxyModel | null>;
  getApiKeyAndHeaders(model: ProxyModel, signal?: AbortSignal): Promise<{ apiKey: string; headers: Record<string, string> }>;
}

/** Outcome of resolving a requested label to a registry model. */
type ResolveResult =
  | { ok: true; model: ProxyModel; label: string }
  | { ok: false; status: 400 | 404; label: string };

/**
 * Resolve a requested model to a registry entry (shared by both endpoints).
 *
 * Order (spec: Model ID resolution):
 *   1. label = request.model ?? firstAvailable(preferred) ?? defaultModel
 *   2. alias expand (exact key match)
 *   3. parse on first `/` only
 *   4. registry.find(provider, id)
 *   5. fallback: firstAvailable(preferred)
 *   6. else 404 (400 when step 1 yields no label)
 */
async function resolveRequestedModel(
  requestModel: string | undefined,
  config: ModelProxyConfig,
  registry: ModelProxyRegistry,
): Promise<ResolveResult> {
  const preferred = config.preferredModels ?? [];
  const aliases = config.modelAliases ?? {};

  // 1. Determine the requested label.
  let label: string | undefined = requestModel;
  if (!label) {
    const pref = preferred.length > 0 ? await registry.firstAvailable(preferred) : null;
    label = pref ? `${pref.provider}/${pref.id}` : config.defaultModel;
  }
  if (!label) return { ok: false, status: 400, label: "" };

  // 2. Alias expansion (whole-label exact match, single pass).
  if (Object.prototype.hasOwnProperty.call(aliases, label)) {
    label = aliases[label];
  }

  // 3. First-slash parse. 4. Exact find.
  const { provider, modelId } = parseModelId(label);
  let model = provider ? await registry.find(provider, modelId) : null;

  // 5. Preferred fallback (bare label or miss).
  if (!model && preferred.length > 0) {
    model = await registry.firstAvailable(preferred);
  }

  // 6. Still nothing.
  if (!model) return { ok: false, status: 404, label };
  return { ok: true, model, label };
}

/** Final assistant message on a pi-ai `done` event (only usage is read here). */
interface ProxyFinalMessage {
  usage?: { input?: number; output?: number };
}

/** A pi-ai stream event; converters read the rest of its shape. */
export interface ProxyStreamEvent {
  type: string;
  message?: ProxyFinalMessage;
  error?: { errorMessage?: string };
}

/** Options the routes hand to `streamSimple` (adapted to pi-ai in server.ts). */
export interface ProxyStreamOpts {
  model: ProxyModel;
  messages: unknown[];
  system?: string;
  tools?: unknown[];
  maxTokens?: number;
  temperature?: number;
  signal: AbortSignal;
  apiKey: string;
  headers: Record<string, string>;
}

/** Minimal interface for pi-ai's streamSimple. */
export type StreamSimpleFn = (opts: ProxyStreamOpts) => AsyncIterable<ProxyStreamEvent>;

const concurrency = new ConcurrencyTracker();

type RouteDeps = ModelProxyRouteDeps & { streamSimple?: StreamSimpleFn };

export function registerModelProxyRoutes(fastify: FastifyInstance, deps: RouteDeps): void {
  // ── GET /v1/models ──────────────────────────────────────────────────
  fastify.get("/v1/models", async (_request, reply) => {
    const registry = await deps.getRegistry();
    if (!registry) {
      return reply.code(503).send({
        code: "MODEL_PROXY_RUNTIME_MISSING",
        message: "pi-ai is not installed or cannot be resolved",
      });
    }

    const models = await registry.getAvailable();
    const data = models.map((m) => ({
      id: `${m.provider}/${m.id}`,
      object: "model" as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: m.provider,
      "x-pi": {
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxTokens ? { maxTokens: m.maxTokens } : {}),
        ...(m.reasoning != null ? { reasoning: m.reasoning } : {}),
        ...(m.cost ? { cost: m.cost } : {}),
        ...(m.input ? { input: m.input } : {}),
      },
    }));

    return { object: "list", data };
  });

  // ── POST /v1/chat/completions + /v1/messages ────────────────────────
  // One pipeline; the formats differ only in their CompletionFormat adapter.
  fastify.post("/v1/chat/completions", { config: { compress: false } }, (request, reply) =>
    handleCompletion(OPENAI_FORMAT, deps, request, reply),
  );
  fastify.post("/v1/messages", { config: { compress: false } }, (request, reply) =>
    handleCompletion(ANTHROPIC_FORMAT, deps, request, reply),
  );
}

// ── Wire formats ─────────────────────────────────────────────────────────

/** Fields every completion request body may carry. */
interface CompletionBody {
  model?: string;
  stream?: boolean;
  temperature?: number;
}

interface OpenAIChatRequest extends CompletionBody {
  messages?: OpenAIMessage[];
  tools?: OpenAITool[];
  max_tokens?: number;
}

type AnthropicRequest = CompletionBody & Partial<AnthropicMessagesRequest>;

/** What a format contributes to the upstream `streamSimple` call. */
interface UpstreamInput {
  system?: string;
  messages: unknown[];
  tools?: unknown[];
  maxTokens?: number;
}

/** Everything that differs between the OpenAI and Anthropic endpoints. */
interface CompletionFormat<B extends CompletionBody> {
  name: RequestLogEntry["format"];
  /** 400 message when the body is unusable, else null. */
  invalid(body: B | undefined): string | null;
  newMessageId(): string;
  toUpstream(body: B): UpstreamInput;
  /** Fresh per-response SSE encoder (owns its block/tool-index tracker). */
  sseEncoder(modelId: string, msgId: string): (event: ProxyStreamEvent) => string[];
  toResponse(finalMsg: ProxyFinalMessage, modelId: string, msgId: string): unknown;
}

const OPENAI_FORMAT: CompletionFormat<OpenAIChatRequest> = {
  name: "openai",
  invalid: (body) => (body?.messages ? null : "messages is required"),
  newMessageId: () => crypto.randomUUID().slice(0, 8),
  toUpstream: (body) => {
    const { systemPrompt, messages } = convertOpenAIMessages(body.messages ?? []);
    return {
      system: systemPrompt,
      messages,
      tools: body.tools ? convertOpenAITools(body.tools) : undefined,
      maxTokens: body.max_tokens,
    };
  },
  sseEncoder: (modelId, msgId) => {
    const tracker = new ToolCallIndexTracker();
    return (event) => eventToSSEChunks(event, modelId, msgId, tracker);
  },
  toResponse: eventToNonStreamingResponse,
};

const ANTHROPIC_FORMAT: CompletionFormat<AnthropicRequest> = {
  name: "anthropic",
  invalid: (body) => (body?.messages && body?.max_tokens ? null : "messages and max_tokens are required"),
  newMessageId: () => `msg_${crypto.randomUUID().slice(0, 12)}`,
  toUpstream: (body) => {
    // `invalid` guarantees messages + max_tokens are present.
    const { systemPrompt, messages } = convertAnthropicMessages(body as AnthropicMessagesRequest);
    return {
      system: systemPrompt,
      messages,
      tools: body.tools ? convertAnthropicTools(body.tools) : undefined,
      maxTokens: body.max_tokens,
    };
  },
  sseEncoder: (modelId, msgId) => {
    const tracker = new AnthropicBlockTracker();
    return (event) => eventToAnthropicSSE(event, modelId, msgId, tracker);
  },
  toResponse: eventToAnthropicResponse,
};

// ── Shared completion pipeline ───────────────────────────────────────────

/** Per-request bookkeeping shared by the pipeline stages. */
interface CompletionCtx {
  config: ModelProxyConfig;
  apiKeyId: string | undefined;
  modelId: string;
  msgId: string;
  requestId: string;
  startTime: number;
}

const apiError = (type: string, message: string) => ({ error: { type, message } });

async function handleCompletion<B extends CompletionBody>(
  fmt: CompletionFormat<B>,
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const body = request.body as B | undefined;
  const invalid = fmt.invalid(body);
  if (invalid !== null || body === undefined) {
    return reply.code(400).send(apiError("invalid_request_error", invalid ?? "request body is required"));
  }

  const config = deps.getConfig();
  const registry = await deps.getRegistry();
  if (!registry) {
    return reply.code(503).send({ code: "MODEL_PROXY_RUNTIME_MISSING", message: "pi-ai unavailable" });
  }

  const resolved = await resolveRequestedModel(body.model, config, registry);
  if (!resolved.ok) {
    const message = resolved.status === 400 ? "model is required" : `Model not found: ${resolved.label}`;
    return reply.code(resolved.status).send(apiError("invalid_request_error", message));
  }

  // Set by the proxy auth gate (auth-gate.ts).
  const apiKeyId = (request as FastifyRequest & { proxyApiKeyId?: string }).proxyApiKeyId;
  const release = acquireSlot(reply, apiKeyId, resolved.model.provider ?? "unknown", config);
  if (!release) return reply;

  const ctx: CompletionCtx = {
    config,
    apiKeyId,
    modelId: resolved.label,
    msgId: fmt.newMessageId(),
    requestId: crypto.randomUUID(),
    startTime: Date.now(),
  };
  try {
    return await runCompletion(fmt, deps, registry, resolved.model, body, ctx, request, reply);
  } catch (err) {
    return failCompletion(fmt, ctx, reply, err);
  } finally {
    release();
  }
}

/** Take a concurrency slot, or answer 503/429 and return null. */
function acquireSlot(
  reply: FastifyReply,
  apiKeyId: string | undefined,
  provider: string,
  config: ModelProxyConfig,
): (() => void) | null {
  try {
    return concurrency.acquire({ apiKeyId: apiKeyId ?? "", provider }, config);
  } catch (e) {
    if (!(e instanceof ConcurrencyError)) throw e;
    const status = e.code === "SERVER_FULL" ? 503 : 429;
    reply.header("Retry-After", String(Math.ceil(e.retryAfterMs / 1000)));
    reply.code(status).send({ code: e.code });
    return null;
  }
}

async function runCompletion<B extends CompletionBody>(
  fmt: CompletionFormat<B>,
  deps: RouteDeps,
  registry: ModelProxyRegistry,
  model: ProxyModel,
  body: B,
  ctx: CompletionCtx,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const upstream = fmt.toUpstream(body);
  const controller = new AbortController();
  // Abort on client disconnect. Listen on the RESPONSE: on modern Node
  // `request.raw` emits "close" once the body is consumed (before this
  // listener attaches), so it never signals a disconnect. Attached BEFORE
  // credential resolution so a disconnect also aborts an in-flight OAuth
  // refresh. See change: collapse-model-proxy-onto-modelruntime.
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  const creds = await registry.getApiKeyAndHeaders(model, controller.signal);

  const streamSimple = deps.streamSimple;
  if (!streamSimple) {
    return reply.code(503).send({ code: "MODEL_PROXY_RUNTIME_MISSING", message: "streamSimple unavailable" });
  }

  const events = streamSimple({
    model,
    messages: upstream.messages,
    ...(upstream.system ? { system: upstream.system } : {}),
    ...(upstream.tools ? { tools: upstream.tools } : {}),
    ...(upstream.maxTokens != null ? { maxTokens: upstream.maxTokens } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    signal: controller.signal,
    apiKey: creds.apiKey,
    headers: creds.headers,
  });

  return body.stream === true
    ? streamEvents(fmt, events, ctx, request, reply)
    : collectEvents(fmt, events, ctx, reply);
}

/** SSE response: re-encode every upstream event in the client's format. */
async function streamEvents<B extends CompletionBody>(
  fmt: CompletionFormat<B>,
  events: AsyncIterable<ProxyStreamEvent>,
  ctx: CompletionCtx,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (typeof request.raw.setTimeout === "function") request.raw.setTimeout(0);
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const encode = fmt.sseEncoder(ctx.modelId, ctx.msgId);
  let lastMsg: ProxyFinalMessage | undefined;
  for await (const event of events) {
    if (event.type === "done") lastMsg = event.message;
    for (const chunk of encode(event)) reply.raw.write(chunk);
  }
  reply.raw.end();
  logOutcome(fmt, ctx, 200, { usage: lastMsg?.usage });
}

/** JSON response: drain the stream, answer with the final message. */
async function collectEvents<B extends CompletionBody>(
  fmt: CompletionFormat<B>,
  events: AsyncIterable<ProxyStreamEvent>,
  ctx: CompletionCtx,
  reply: FastifyReply,
) {
  let finalMsg: ProxyFinalMessage | undefined;
  for await (const event of events) {
    if (event.type === "done") finalMsg = event.message;
    if (event.type === "error") {
      logOutcome(fmt, ctx, 500, { error: event.error?.errorMessage });
      return reply.code(500).send(apiError("api_error", event.error?.errorMessage || "Provider error"));
    }
  }

  if (!finalMsg) {
    return reply.code(500).send(apiError("api_error", "No response from model"));
  }

  const response = fmt.toResponse(finalMsg, ctx.modelId, ctx.msgId);
  logOutcome(fmt, ctx, 200, { usage: finalMsg.usage });
  return response;
}

/** Map a thrown error to a response without ever writing headers twice. */
function failCompletion<B extends CompletionBody>(
  fmt: CompletionFormat<B>,
  ctx: CompletionCtx,
  reply: FastifyReply,
  err: unknown,
) {
  const { name, message } = errorInfo(err);
  if (name === "AbortError") return; // Client disconnected
  logOutcome(fmt, ctx, 500, { error: message });
  if (reply.raw.headersSent) {
    // Mid-stream failure: a 500 can no longer be sent (Fastify would throw
    // ERR_HTTP_HEADERS_SENT and the client would hang). End the SSE stream
    // exactly as an upstream `error` event does.
    const encode = fmt.sseEncoder(ctx.modelId, ctx.msgId);
    for (const chunk of encode({ type: "error", error: { errorMessage: message } })) reply.raw.write(chunk);
    reply.raw.end();
    return;
  }
  return reply.code(500).send(apiError("api_error", message || "Internal error"));
}

function errorInfo(err: unknown): { name?: string; message?: string } {
  if (typeof err !== "object" || err === null) return {};
  const { name, message } = err as { name?: unknown; message?: unknown };
  return {
    name: typeof name === "string" ? name : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

function logOutcome<B extends CompletionBody>(
  fmt: CompletionFormat<B>,
  ctx: CompletionCtx,
  status: number,
  extra: { usage?: ProxyFinalMessage["usage"]; error?: string },
): void {
  if (!ctx.config.logRequests) return;
  logRequest({
    ts: new Date().toISOString(),
    requestId: ctx.requestId,
    apiKeyId: ctx.apiKeyId,
    model: ctx.modelId,
    format: fmt.name,
    status,
    durationMs: Date.now() - ctx.startTime,
    inputTokens: extra.usage?.input,
    outputTokens: extra.usage?.output,
    error: extra.error,
  });
}
