/**
 * In-memory ≥0.85 pi-ai fixture for the compatibility seam tests.
 *
 * Models the runtime's real layout — root `normalizeContext`, a
 * `providers/all.js` collection factory, and one `*.lazy.js` module per api —
 * behind injected `importPath` / `exists`, so stream dispatch is testable
 * without a real 0.86.x install.
 *
 * See change: adopt-piai-factory-api-registry.
 */
import { sep } from "node:path";
import { API_LAZY_TABLE } from "../piai-compat/api-table.js";
import { OAUTH_LOADER_EXPORTS } from "../piai-compat/oauth-facade.js";
import type { AdaptDeps } from "../piai-compat/types.js";

export const FIXTURE_PATH = ["", "fake", "pi-ai", "dist", "index.js"].join(sep);

export interface DispatchRecord {
  via: string;
  model: any;
  context: any;
  options: any;
}

export interface FactoryFixture {
  module: Record<string, any>;
  deps: Required<AdaptDeps>;
  /** Every `streamSimple` call, in order, tagged with what dispatched it. */
  dispatches: DispatchRecord[];
  /** True if the fixture's auth resolver was consulted (it must never be). */
  getAuthCalls: number;
  imported: string[];
}

export interface FixtureOptions {
  /** Built-in models, keyed `provider/id`. */
  models?: any[];
  /** Restrict which api lazy modules "exist". Defaults to the whole table. */
  availableApis?: string[];
  /** Provider ids the built-in collection knows. Defaults to the models' providers. */
  providers?: string[];
  /** Replace the root `normalizeContext` (omit to model the real one). */
  normalizeContext?: (ctx: any) => any;
  /** Omit `normalizeContext` from the root export, forcing the subpath probe. */
  normalizeOnSubpathOnly?: boolean;
  /** `dist/oauth.js` contents. Default: the ≥0.85 type-only stub. */
  oauthModule?: Record<string, unknown> | null;
  /** `dist/auth/oauth/load.js` contents. Default: every mapped loader. */
  oauthLoaders?: Record<string, unknown> | null;
}

async function* oneEvent(): AsyncIterable<any> {
  yield { type: "text_delta", delta: "ok" };
  yield { type: "done", reason: "stop" };
}

/** The real pi-ai normalizeContext, verbatim in behaviour. */
export function realNormalizeContext(context: any): any {
  const parts: any[] = [];
  if (context.systemPrompt) parts.push({ type: "text", text: context.systemPrompt });
  const initial =
    context.systemPrompt || context.tools
      ? {
          role: "system",
          content: parts,
          toolsAdded: (context.tools ?? []).map((t: any) => t.name ?? t),
        }
      : undefined;
  return { messages: initial ? [initial, ...context.messages] : context.messages };
}

export function makeFactoryFixture(opts: FixtureOptions = {}): FactoryFixture {
  const models = opts.models ?? [
    { provider: "anthropic", id: "claude-opus-5", api: "anthropic-messages" },
    { provider: "openai-codex", id: "gpt-6-astra", api: "openai-codex-responses" },
  ];
  const providerIds = opts.providers ?? [...new Set(models.map((m) => m.provider))];
  const availableApis = opts.availableApis ?? Object.keys(API_LAZY_TABLE);

  const fixture: FactoryFixture = {
    module: {},
    deps: { importPath: async () => ({}), exists: () => false },
    dispatches: [],
    getAuthCalls: 0,
    imported: [],
  };

  const normalize = opts.normalizeContext ?? realNormalizeContext;
  fixture.module = {
    createModels: () => ({}),
    createProvider: () => ({}),
    ...(opts.normalizeOnSubpathOnly ? {} : { normalizeContext: normalize }),
  };

  const record = (via: string) => ({
    streamSimple: (model: any, context: any, options: any) => {
      fixture.dispatches.push({ via, model, context, options });
      return oneEvent();
    },
    stream: () => oneEvent(),
  });

  const builtinCollection = {
    getProviders: () => providerIds.map((id) => ({ id, name: id })),
    // Provider-level dispatch. The single-api form IGNORES `model.api` — which
    // is exactly why api-first dispatch matters.
    getProvider: (id: string) => (providerIds.includes(id) ? record(`provider:${id}`) : undefined),
    getModels: (provider: string) => models.filter((m) => m.provider === provider),
    getModel: (provider: string, id: string) =>
      models.find((m) => m.provider === provider && m.id === id),
    // Must NEVER be reached on this path (design D3): reaching it means the
    // seam went through `Models.streamSimple` and would break OAuth-only
    // providers handed a caller key.
    getAuth: () => {
      fixture.getAuthCalls += 1;
      return undefined;
    },
  };

  const rel = (p: string) => p.split(sep).slice(4).join("/");

  const table: Record<string, Record<string, unknown>> = {
    "providers/all.js": { builtinModels: () => builtinCollection },
    "utils/transcript.js": { normalizeContext: normalize },
  };
  for (const [api, entry] of Object.entries(API_LAZY_TABLE)) {
    table[entry.module] = { [entry.exportName]: () => record(`api:${api}`) };
  }
  if (opts.oauthModule !== null) table["oauth.js"] = opts.oauthModule ?? {};
  if (opts.oauthLoaders !== null) {
    table["auth/oauth/load.js"] =
      opts.oauthLoaders ??
      Object.fromEntries(
        Object.values(OAUTH_LOADER_EXPORTS).map((exportName) => [
          exportName,
          async () => ({
            name: exportName,
            refresh: async (credential: any) => ({
              access: `new-${credential.access}`,
              refresh: `new-${credential.refresh}`,
              expires: 4_102_444_800_000,
            }),
          }),
        ]),
      );
  }

  const present = (relPath: string): boolean => {
    if (!(relPath in table)) return false;
    if (relPath.startsWith("api/")) {
      const api = Object.entries(API_LAZY_TABLE).find(([, e]) => e.module === relPath)?.[0];
      return api !== undefined && availableApis.includes(api);
    }
    return true;
  };

  fixture.deps = {
    exists: (p: string) => present(rel(p)),
    importPath: async (p: string) => {
      fixture.imported.push(p);
      const relPath = rel(p);
      if (!present(relPath)) throw new Error(`fixture: no module at ${p}`);
      return table[relPath];
    },
  };

  return fixture;
}
