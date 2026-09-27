/**
 * Wrapper around pi-ai's streamSimple for model proxy route handlers.
 *
 * Resolves model credentials from the InternalRegistry, then delegates
 * to pi-ai's streamSimple. Returns an AsyncIterable of pi-ai StreamEvents.
 *
 * See change: add-dashboard-model-proxy, task 6.1.
 */
import type { PiAiModule } from "./internal-registry.js";
import { getModelRegistry } from "./registry-singleton.js";

type PiAiStreamSimple = PiAiModule["streamSimple"];

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
 * Adapt route-level `streamSimple` opts to pi-ai's
 * `streamSimple(model, context, options)` call; the full opts object doubles
 * as the options (apiKey/headers/signal/maxTokens/temperature).
 */
export function callPiAiStreamSimple<O extends RouteStreamOpts>(
  fn: PiAiStreamSimple,
  opts: O,
): ReturnType<PiAiStreamSimple> {
  return fn(opts.model, toPiAiContext(opts), opts);
}

export interface RegistryLike {
  getApiKeyAndHeaders(model: unknown): Promise<{ apiKey: string; headers: Record<string, string> }>;
}

/**
 * Stream a completion from the upstream provider via pi-ai's streamSimple.
 *
 * Resolves API key + headers from the registry, then calls streamSimple.
 * The returned iterable yields pi-ai's AssistantMessageEvent objects.
 *
 * @param opts - stream options
 * @param piAiStreamSimple - pi-ai's streamSimple function
 * @param registryOverride - optional registry for testing (defaults to getModelRegistry())
 */
export async function streamCompletion(
  opts: StreamCompletionOpts,
  piAiStreamSimple: PiAiStreamSimple,
  registryOverride?: RegistryLike,
): Promise<ReturnType<PiAiStreamSimple>> {
  const registry = registryOverride ?? (await getModelRegistry());
  const { apiKey, headers } = await registry.getApiKeyAndHeaders(opts.model);

  const options = {
    apiKey,
    headers,
    ...(opts.maxTokens != null ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  return piAiStreamSimple(opts.model, toPiAiContext(opts), options);
}
