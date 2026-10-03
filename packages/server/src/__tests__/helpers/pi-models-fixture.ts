/**
 * Drives `DashboardCredentialStore` exactly as pi drives it: a REAL pi-ai
 * `createModels({ credentials })` collection whose `getAuth` runs pi's own
 * `resolveStoredOAuth` (expiry window, `store.modify` refresh callback,
 * `ModelsError` wrapping). Only the provider's OAuth `refresh` is faked.
 *
 * See change: collapse-model-proxy-onto-modelruntime (test-plan #X1–#X6, #X10, #X14, #X15).
 */
import * as piAi from "@earendil-works/pi-ai";
import { DashboardCredentialStore } from "../../auth/dashboard-credential-store.js";
import { runtimeCreateOptions, type ServerModelRuntime } from "../../model-proxy/server-model-runtime.js";

// pi-ai's published `index.d.ts` re-exports `./models.ts` etc. with `.ts`
// specifiers the repo's tsc does not follow; the runtime exports exist.
const { createAssistantMessageEventStream, createModels, createProvider } = piAi as unknown as {
  createAssistantMessageEventStream: () => any;
  createModels: (options: { credentials: unknown }) => any;
  createProvider: (input: unknown) => any;
};

export type FakeRefresh = (credential: any, signal: AbortSignal) => Promise<any>;

const noStream = {
  stream: () => {
    throw new Error("stream not used by these tests");
  },
  streamSimple: () => {
    throw new Error("streamSimple not used by these tests");
  },
};

/** What a capturing provider's `streamSimple` received after the runtime prepared the request. */
export interface CapturedRequest {
  model: any;
  context: any;
  options: any;
}

/**
 * A REAL pi-coding-agent `ModelRuntime`, created with the exact server options
 * over a fresh `DashboardCredentialStore`.
 */
export async function createRealRuntime(): Promise<ServerModelRuntime> {
  const { ModelRuntime } = (await import("@earendil-works/pi-coding-agent")) as unknown as {
    ModelRuntime: { create(options: unknown): Promise<unknown> };
  };
  return (await ModelRuntime.create(runtimeCreateOptions(new DashboardCredentialStore()) as never)) as never;
}

/** A minimal finished stream: one `done` event carrying an assistant "ok". */
function doneStream(model: any) {
  const stream = createAssistantMessageEventStream();
  const message = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "done", reason: "stop", message } as never);
    stream.end(message as never);
  });
  return stream;
}

/**
 * Intercept the composed provider the runtime dispatches `providerId` to: every
 * request records what the runtime handed the provider (resolved credential,
 * merged headers, normalized transcript) and answers with one `done` event.
 * Nothing reaches the network. Awaits a local runtime refresh first: a
 * pending background refresh (every `registerProvider` starts one) would
 * otherwise recompose the provider and drop the interception.
 */
export async function captureProviderStreams(runtime: ServerModelRuntime, providerId: string): Promise<CapturedRequest[]> {
  await (runtime as unknown as { refresh(o: { allowNetwork: boolean }): Promise<unknown> }).refresh({ allowNetwork: false });
  const provider = runtime.getProvider(providerId) as { streamSimple: (...a: any[]) => unknown } | undefined;
  if (!provider) throw new Error(`no runtime provider "${providerId}"`);
  const captured: CapturedRequest[] = [];
  provider.streamSimple = (model: any, context: any, options: any) => {
    captured.push({ model, context, options });
    return doneStream(model);
  };
  return captured;
}

/**
 * Register `providerId` (one model `m1`) on a real runtime whose extension
 * `streamSimple` records each request — survives provider recomposition.
 */
export function registerCapturingProvider(
  runtime: ServerModelRuntime,
  providerId: string,
  config: { apiKey: string; modelHeaders?: Record<string, string> },
): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  runtime.registerProvider(providerId, {
    baseUrl: "http://127.0.0.1:9/v1",
    api: "openai-completions",
    apiKey: config.apiKey,
    streamSimple: (model: any, context: any, options: any) => {
      captured.push({ model, context, options });
      return doneStream(model);
    },
    models: [
      {
        id: "m1",
        name: "m1",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 1024,
        ...(config.modelHeaders ? { headers: config.modelHeaders } : {}),
      },
    ],
  } as never);
  return captured;
}

export interface PiModelsFixture {
  store: DashboardCredentialStore;
  /** pi-ai `Models` over the store: `getAuth`, `getProvider`, … */
  models: any;
}

/**
 * `oauth` providers get a faked `refresh` and `toAuth` = `{ apiKey: access }`;
 * `apiKey` providers resolve a stored key literally; `bare` providers expose
 * no auth method the store could serve (no `auth.oauth`).
 */
export function piModelsOver(opts: {
  oauth?: Record<string, FakeRefresh>;
  apiKey?: string[];
  bare?: string[];
}): PiModelsFixture {
  const store = new DashboardCredentialStore();
  const models = createModels({ credentials: store as never });
  for (const [id, refresh] of Object.entries(opts.oauth ?? {})) {
    models.setProvider(
      createProvider({
        id,
        auth: {
          oauth: {
            name: id,
            login: async () => {
              throw new Error("login not used by these tests");
            },
            refresh: (credential: any, signal: AbortSignal) => refresh(credential, signal),
            toAuth: async (credential: any) => ({ apiKey: credential.access }),
          },
        },
        models: [],
        api: noStream,
      } as never),
    );
  }
  for (const id of [...(opts.apiKey ?? []), ...(opts.bare ?? [])]) {
    const withKey = opts.apiKey?.includes(id) ?? false;
    models.setProvider(
      createProvider({
        id,
        auth: withKey
          ? {
              apiKey: {
                resolve: async ({ credential }: { credential?: { key?: string } }) =>
                  credential?.key ? { auth: { apiKey: credential.key }, source: "stored" } : undefined,
              },
            }
          : {},
        models: [],
        api: noStream,
      } as never),
    );
  }
  return { store, models };
}
