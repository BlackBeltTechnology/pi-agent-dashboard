/**
 * The dashboard's OAuth provider registry, sourced once at bootstrap from the
 * pi runtime the server already depends on.
 *
 * Why delegation instead of a local table: the previous three hand-ported
 * handlers re-declared every `CLIENT_ID`, token URL and PKCE step, so they
 * lagged pi-ai by construction — no `manual_code` path (remote dashboards could
 * not complete an auth-code sign-in at all) and no Codex device-code. pi-ai's
 * `OAuthAuth.login(interaction)` is already headless; the dashboard supplies an
 * interaction, not a flow.
 *
 * The build is deliberately late and injectable:
 *   - `await import("@earendil-works/pi-coding-agent")` is ~330 ms and pulls the
 *     whole SDK (TUI, WASM) into module-load order; it runs off the request path
 *     behind {@link oauthRegistryReady}.
 *   - every failure mode (`import()` throws, `create()` returns an empty
 *     provider list, an unknown shape) degrades to an EMPTY registry rather
 *     than a dead route: every other route keeps serving, `/handlers` answers
 *     `{ ids: [] }`, and {@link getRegistryError} names the cause — with the
 *     resolved version — so `/api/health` can explain why sign-in is
 *     unavailable.
 *
 * See change: delegate-provider-oauth-to-pi-ai (D1, D3, D6).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OAuthLoginFlow, OAuthRegistryEntry } from "./pi-oauth-types.js";

/** Package the registry is built from — the only pi-ai surface the server uses. */
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/**
 * Which pane the Add-provider dialog opens first. A HINT, not a fact: the pane
 * follows whatever the flow actually emits. Unknown ids default to
 * `device_code` (every provider added upstream since 0.80 is device-code) and a
 * wrong guess is cosmetic.
 */
export const FLOW_TYPE_HINT: Readonly<Record<string, "auth_code" | "device_code">> = {
  anthropic: "auth_code",
  "openai-codex": "auth_code",
  openrouter: "auth_code",
};

/**
 * The only per-provider exclusion left in the dashboard. `radius` is bundled by
 * `builtinProviders()` but its OAuth targets a gateway URL taken from pi's own
 * settings, which the dashboard does not manage.
 */
const EXCLUDED_PROVIDER_IDS: ReadonlySet<string> = new Set(["radius"]);

/**
 * Credential store handed to `ModelRuntime.create()`.
 *
 * The dashboard owns `auth.json` writes itself (locked, backed-up, with
 * clobber refusal), so the runtime must never touch credentials: this store
 * reads as empty and refuses every mutation. `create()` with an empty store
 * performs no network I/O — `refreshOnCreate` defaults to false.
 */
const EMPTY_READONLY_STORE = {
  async read(): Promise<undefined> {
    return undefined;
  },
  async list(): Promise<readonly never[]> {
    return [];
  },
  async modify(): Promise<undefined> {
    throw new Error("provider-auth registry credential store is read-only");
  },
  async delete(): Promise<void> {
    throw new Error("provider-auth registry credential store is read-only");
  },
};

/** The slice of pi-ai's `Provider` this module consumes. */
interface PiProviderLike {
  id: string;
  auth?: { oauth?: OAuthLoginFlow };
}

/** The slice of `ModelRuntime` this module consumes. */
interface PiRuntimeLike {
  getProviders(): readonly PiProviderLike[];
}

/** The slice of the pi-coding-agent index this module consumes. */
interface PiCodingAgentModule {
  ModelRuntime?: {
    create(options: {
      modelsPath: string | null;
      credentials: unknown;
    }): Promise<PiRuntimeLike>;
  };
  VERSION?: string;
}

type ModuleLoader = () => Promise<unknown>;

const defaultLoadModule: ModuleLoader = () => import(PI_PACKAGE);

type OAuthProvider = PiProviderLike & { auth: { oauth: OAuthLoginFlow } };

const isOAuthProvider = (p: PiProviderLike): p is OAuthProvider =>
  p?.auth?.oauth != null && !EXCLUDED_PROVIDER_IDS.has(p.id);

/**
 * Project the runtime's provider list onto the registry. Pure and exported so
 * the id-set / flow-type-hint / exclusion rules are testable without the SDK.
 */
export function mapProviders(
  providers: readonly PiProviderLike[],
): OAuthRegistryEntry[] {
  return providers.filter(isOAuthProvider).map((p) => ({
    id: p.id,
    name: p.auth.oauth.name,
    flowType: FLOW_TYPE_HINT[p.id] ?? "device_code",
    auth: p.auth.oauth,
  }));
}

let snapshot: OAuthRegistryEntry[] = [];
let snapshotError: string | null = null;

/** Sync registry view. Empty until {@link oauthRegistryReady} settles. */
export function getOAuthRegistry(): OAuthRegistryEntry[] {
  return snapshot;
}

/**
 * Why the registry is empty, or `null` when it built. Carries the resolved
 * pi-coding-agent version so `/api/health` reports a skew, not just a symptom.
 */
export function getRegistryError(): string | null {
  return snapshotError;
}

function setRegistry(entries: OAuthRegistryEntry[], error: string | null): void {
  snapshot = entries;
  snapshotError = error;
}

/**
 * Best-effort resolved pi-coding-agent version for the failure message.
 *
 * Deliberately a `node_modules` walk rather than `import.meta.resolve`: the
 * server is jiti-loaded, and jiti's non-file module URLs make the ESM resolver
 * unusable (see `scripts/__tests__/jiti-cjs-transpile-safety.test.mjs`). The
 * package's own `package.json` is not in its exports map, so `require.resolve`
 * cannot reach it either. Returns `unknown` when nothing is found — the version
 * is a diagnostic, never a gate.
 */
export function resolveVersionFallback(): string {
  try {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 8; depth += 1) {
      const pkgJson = path.join(dir, "node_modules", PI_PACKAGE, "package.json");
      if (fs.existsSync(pkgJson)) {
        const parsed = JSON.parse(fs.readFileSync(pkgJson, "utf8")) as {
          version?: string;
        };
        if (typeof parsed.version === "string" && parsed.version) return parsed.version;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* fall through to unknown */
  }
  return "unknown";
}

export interface OAuthRegistryInitDeps {
  /** Resolves the pi-coding-agent module. Injectable to drive the failure
   * branches (`X10`) without touching the real SDK. */
  loadModule?: ModuleLoader;
  /** Resolved version used only in the failure message. */
  readVersion?: () => string;
  /** Sink for the one-shot failure line. Defaults to `console.error`. */
  log?: (message: string) => void;
}

/**
 * Build the registry, once. Never rejects: every failure is absorbed into an
 * empty snapshot plus {@link getRegistryError}. Exported (with injectable
 * deps) so the degradation paths are testable and re-runnable.
 */
export async function initOAuthRegistry(deps: OAuthRegistryInitDeps = {}): Promise<void> {
  const loadModule = deps.loadModule ?? defaultLoadModule;
  const readVersion = deps.readVersion ?? resolveVersionFallback;
  const log = deps.log ?? ((message: string) => console.error(message));

  let version = readVersion();
  try {
    const mod = (await loadModule()) as PiCodingAgentModule;
    if (typeof mod?.VERSION === "string" && mod.VERSION) version = mod.VERSION;

    const ModelRuntime = mod?.ModelRuntime;
    if (typeof ModelRuntime?.create !== "function") {
      throw new Error(`ModelRuntime.create is not exported by ${PI_PACKAGE}`);
    }
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      credentials: EMPTY_READONLY_STORE,
    });
    if (typeof runtime?.getProviders !== "function") {
      throw new Error("ModelRuntime.getProviders is not a function");
    }
    const entries = mapProviders(runtime.getProviders());
    if (entries.length === 0) {
      throw new Error("the runtime exposes no provider with an OAuth login");
    }
    setRegistry(entries, null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = `${message} (pi-coding-agent ${version})`;
    setRegistry([], detail);
    log(`[provider-auth] OAuth registry unavailable: ${detail}`);
  }
}

/**
 * Build (once) and return the bootstrap promise. Lazy on purpose: importing
 * the runtime costs ~330 ms and pulls the whole SDK into module-load order, so
 * nothing pays for it until a provider-auth surface actually asks — the server
 * asks at route registration, tests that inject a registry never do.
 *
 * Never rejects: every failure is absorbed into an empty snapshot plus
 * {@link getRegistryError}.
 */
export function oauthRegistryReady(): Promise<void> {
  readyPromise ??= initOAuthRegistry();
  return readyPromise;
}

let readyPromise: Promise<void> | undefined;
