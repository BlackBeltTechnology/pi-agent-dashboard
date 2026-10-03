/**
 * The server's ONE pi `ModelRuntime`.
 *
 * Created once, lazily, with the dashboard's credential store:
 *   - `credentials: DashboardCredentialStore` — never pi's own file store;
 *   - `modelsPath: null` — built-in catalogue only; the dashboard keeps
 *     composing `models.json` + `providers.json` itself (D3);
 *   - `refreshOnCreate: false`, `allowModelNetwork: false` — no network and no
 *     credential write at boot (a near-expiry OAuth token is NOT refreshed by
 *     `create()`), D4.
 *
 * The model proxy, `/api/models`, the plugin model runtime and the
 * provider-auth OAuth flow listing all answer from it. A failed `create()` is
 * memoized, so every surface reports the SAME error (one failure domain, D6).
 *
 * See change: collapse-model-proxy-onto-modelruntime (D1, D4, D6).
 */
import { DashboardCredentialStore, type RuntimeCredentialStore } from "../auth/dashboard-credential-store.js";

/** Package the runtime comes from — the only pi surface the server loads. */
export const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";

/** The slice of pi-ai's `Provider` the server reads. */
export interface RuntimeProvider {
  id: string;
  auth?: { oauth?: unknown; apiKey?: unknown };
}

/** pi-ai `AuthResult` slice. */
export interface RuntimeAuthResult {
  auth: { apiKey?: string; headers?: Record<string, string>; baseUrl?: string };
}

/** pi-coding-agent `ProviderConfigInput` slice the server registers. */
export interface RuntimeProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  api?: string;
  headers?: Record<string, string>;
  models?: unknown[];
}

/**
 * The slice of pi-coding-agent's `ModelRuntime` the server consumes.
 * Structural so tests drive it with a fake and the server never imports pi-ai.
 */
export interface ServerModelRuntime {
  getProviders(): readonly RuntimeProvider[];
  getProvider(providerId: string): RuntimeProvider | undefined;
  getModels(providerId?: string): readonly any[];
  getAuth(model: any, overrides?: { signal?: AbortSignal }): Promise<RuntimeAuthResult | undefined>;
  streamSimple(model: any, context: any, options?: any): AsyncIterable<any>;
  registerProvider(providerId: string, config: RuntimeProviderConfig): void;
  unregisterProvider(providerId: string): void;
}

export interface CreateRuntimeOptions {
  credentials: RuntimeCredentialStore;
  modelsPath: null;
  refreshOnCreate: false;
  allowModelNetwork: false;
}

/** The slice of the pi-coding-agent index the server consumes. */
interface PiCodingAgentModule {
  ModelRuntime?: { create(options: CreateRuntimeOptions): Promise<ServerModelRuntime> };
  VERSION?: string;
}

export interface ServerModelRuntimeHandle {
  runtime: ServerModelRuntime;
  /** Resolved pi-coding-agent version (diagnostics). */
  version: string | undefined;
}

/** A failed `create()` carries the resolved version for diagnostics. */
export class ModelRuntimeUnavailableError extends Error {
  readonly version: string | undefined;
  constructor(message: string, version: string | undefined, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelRuntimeUnavailableError";
    this.version = version;
  }
}

export type ModuleLoader = () => Promise<unknown>;

/** The exact options every server runtime is created with. Exported so tests pin them. */
export function runtimeCreateOptions(credentials: RuntimeCredentialStore): CreateRuntimeOptions {
  return { credentials, modelsPath: null, refreshOnCreate: false, allowModelNetwork: false };
}

const defaultLoadModule: ModuleLoader = () => import(PI_CODING_AGENT_PACKAGE);

let loadModule: ModuleLoader = defaultLoadModule;
let pending: Promise<ServerModelRuntimeHandle> | null = null;

async function createRuntime(): Promise<ServerModelRuntimeHandle> {
  let version: string | undefined;
  try {
    const mod = (await loadModule()) as PiCodingAgentModule;
    if (typeof mod?.VERSION === "string" && mod.VERSION) version = mod.VERSION;
    const ModelRuntime = mod?.ModelRuntime;
    if (typeof ModelRuntime?.create !== "function") {
      throw new Error(`ModelRuntime.create is not exported by ${PI_CODING_AGENT_PACKAGE}`);
    }
    const runtime = await ModelRuntime.create(runtimeCreateOptions(new DashboardCredentialStore()));
    if (typeof runtime?.getProviders !== "function") {
      throw new Error("ModelRuntime.getProviders is not a function");
    }
    return { runtime, version };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ModelRuntimeUnavailableError(message, version, { cause: err });
  }
}

/** The server's single runtime. Created on first call; a rejection is memoized. */
export function getServerModelRuntime(): Promise<ServerModelRuntimeHandle> {
  pending ??= createRuntime();
  return pending;
}

/** Test seam: replace the pi-coding-agent loader and drop the memoized runtime. `null` restores the default. */
export function _setRuntimeModuleLoaderForTests(loader: ModuleLoader | null): void {
  loadModule = loader ?? defaultLoadModule;
  pending = null;
}

/** Drop the memoized runtime (next call re-creates). */
export function disposeServerModelRuntime(): void {
  pending = null;
}
