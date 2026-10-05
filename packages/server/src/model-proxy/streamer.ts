/**
 * Wrapper around the model runtime's streamSimple for model proxy route handlers.
 *
 * Resolves (and, if needed, refreshes) model credentials through the
 * InternalRegistry facade, then delegates to the runtime's streamSimple WITHOUT
 * an `apiKey` override: the runtime applies the provider's own auth path.
 * Per-model custom headers are still passed. Returns an AsyncIterable of pi-ai
 * StreamEvents.
 *
 * See changes: add-dashboard-model-proxy (task 6.1), collapse-model-proxy-onto-modelruntime (D5).
 */
import { getModelRegistry, type RuntimeStreamSimpleFn, type StreamSimpleOptions } from "./registry-singleton.js";

type PiAiStreamSimple = RuntimeStreamSimpleFn;

export interface StreamCompletionOpts {
  model: unknown;
  messages: unknown[];
  system?: string;
  tools?: unknown[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** Route-level stream input (see model-proxy-routes.ts `ProxyStreamOpts`). */
export interface RouteStreamOpts {
  model: unknown;
  messages: unknown[];
  system?: string;
  tools?: unknown[];
}

/**
 * Build pi-ai's `Context`. Its field is `systemPrompt`: passing `system`
 * silently drops the client's system prompt.
 */
function toPiAiContext(opts: RouteStreamOpts) {
  return {
    messages: opts.messages,
    ...(opts.system !== undefined ? { systemPrompt: opts.system } : {}),
    ...(opts.tools ? { tools: opts.tools } : {}),
  };
}

/**
 * Adapt route-level `streamSimple` opts to the runtime's
 * `streamSimple(model, context, options)` call; the full opts object doubles
 * as the options (headers/signal/maxTokens/temperature). An `apiKey` in it is
 * dropped by `getStreamSimpleFn()`, never forwarded to the runtime.
 */
export function callPiAiStreamSimple<O extends RouteStreamOpts>(
  fn: PiAiStreamSimple,
  opts: O,
): ReturnType<PiAiStreamSimple> {
  return fn(opts.model, toPiAiContext(opts), opts as StreamSimpleOptions);
}

export interface RegistryLike {
  getApiKeyAndHeaders(model: unknown, signal?: AbortSignal): Promise<{ apiKey: string; headers: Record<string, string> }>;
}

/**
 * Stream a completion from the upstream provider via the runtime's streamSimple.
 *
 * Resolves auth + headers through the registry (refresh-once, named errors),
 * then calls streamSimple with the headers and no `apiKey` override.
 * The returned iterable yields pi-ai's AssistantMessageEvent objects.
 *
 * @param opts - stream options
 * @param piAiStreamSimple - the runtime's streamSimple function
 * @param registryOverride - optional registry for testing (defaults to getModelRegistry())
 */
export async function streamCompletion(
  opts: StreamCompletionOpts,
  piAiStreamSimple: PiAiStreamSimple,
  registryOverride?: RegistryLike,
): Promise<ReturnType<PiAiStreamSimple>> {
  const registry = registryOverride ?? (await getModelRegistry());
  const { headers } = opts.signal
    ? await registry.getApiKeyAndHeaders(opts.model, opts.signal)
    : await registry.getApiKeyAndHeaders(opts.model);

  const options = {
    headers,
    ...(opts.maxTokens != null ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  return piAiStreamSimple(opts.model, toPiAiContext(opts), options);
}
