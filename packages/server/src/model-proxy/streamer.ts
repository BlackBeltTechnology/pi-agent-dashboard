/**
 * Wrapper around pi-ai's streamSimple for model proxy route handlers.
 *
 * Resolves model credentials from the InternalRegistry, then delegates
 * to pi-ai's streamSimple. Returns an AsyncIterable of pi-ai StreamEvents.
 *
 * See change: add-dashboard-model-proxy, task 6.1.
 */
import { getModelRegistry } from "./registry-singleton.js";
import type { PiAiModule } from "./internal-registry.js";

export interface StreamCompletionOpts {
  model: any;
  messages: any[];
  system?: string;
  tools?: any[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * Adapt route-level `streamSimple` opts (see model-proxy-routes.ts) to pi-ai's
 * `streamSimple(model, context, options)` call. pi-ai's `Context` field is
 * `systemPrompt` — passing `system` silently drops the client's system prompt.
 */
export interface RouteStreamOpts {
  model: unknown;
  messages: unknown[];
  system?: string;
  tools?: unknown[];
  [option: string]: unknown;
}

export function callPiAiStreamSimple(
  fn: PiAiModule["streamSimple"],
  opts: RouteStreamOpts,
): ReturnType<PiAiModule["streamSimple"]> {
  const context = {
    messages: opts.messages,
    ...(opts.system !== undefined ? { systemPrompt: opts.system } : {}),
    ...(opts.tools ? { tools: opts.tools } : {}),
  };
  return fn(opts.model, context, opts);
}

export interface RegistryLike {
  getApiKeyAndHeaders(model: any): Promise<{ apiKey: string; headers: Record<string, string> }>;
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
  piAiStreamSimple: PiAiModule["streamSimple"],
  registryOverride?: RegistryLike,
): Promise<AsyncIterable<any>> {
  const registry = registryOverride ?? await getModelRegistry();
  const { apiKey, headers } = await registry.getApiKeyAndHeaders(opts.model);

  const context: any = {
    messages: opts.messages,
    ...(opts.system !== undefined ? { systemPrompt: opts.system } : {}),
    ...(opts.tools ? { tools: opts.tools } : {}),
  };

  const options: any = {
    apiKey,
    headers,
    ...(opts.maxTokens != null ? { maxTokens: opts.maxTokens } : {}),
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };

  return piAiStreamSimple(opts.model, context, options);
}
