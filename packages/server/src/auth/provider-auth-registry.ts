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
 *   - the runtime is the server's SINGLE `ModelRuntime` (the one the model
 *     proxy uses), injected via {@link setOAuthRegistryRuntimeSource}; loading
 *     it pulls the whole SDK, so it runs off the request path behind
 *     {@link oauthRegistryReady}.
 *   - every failure mode (`import()` throws, `create()` rejects or returns an
 *     empty provider list, an unknown shape) degrades to an EMPTY registry rather
 *     than a dead route: every other route keeps serving, `/handlers` answers
 *     `{ ids: [] }`, and {@link getRegistryError} names the cause — with the
 *     resolved version — so `/api/health` can explain why sign-in is
 *     unavailable.
 *
 * See changes: delegate-provider-oauth-to-pi-ai (D1, D3, D6),
 * collapse-model-proxy-onto-modelruntime (D6: one runtime, one failure domain).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OAuthLoginFlow, OAuthRegistryEntry } from "./pi-oauth-types.js";
import { applyRadiusOverride, setAgentDirSource } from "./radius-override.js";

/** Package the runtime comes from (version diagnostics only). */
const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/**
 * Which pane the Add-provider dialog opens first. A HINT, not a fact: the pane
 * follows whatever the flow actually emits. Unknown ids default to
 * `device_code` (every provider added upstream since 0.80 is device-code) and a
 * wrong guess is cosmetic.
 */
export const FLOW_TYPE_HINT: Readonly<Record<string, "auth_code" | "device_code">> = {
  anthropic: "auth_code",
  // pi 1.0.0 Sign in with ChatGPT. See change: update-pi-core-1-0-adopt-apis.
  openai: "auth_code",
  "openai-codex": "auth_code",
  openrouter: "auth_code",
  // Radius login starts with a browser/device `select`, like Codex.
  // See change: add-radius-provider-login.
  radius: "auth_code",
};

/** The slice of pi-ai's `Provider` this module consumes. */
interface PiProviderLike {
  id: string;
  auth?: { oauth?: OAuthLoginFlow };
}

/**
 * The server's single model runtime, as `server-model-runtime.ts` hands it out.
 * INJECTED (never imported) so `auth/` does not import `model-proxy/`: the
 * runtime's credential store imports `provider-auth-storage.ts`, which imports
 * this module. See change: collapse-model-proxy-onto-modelruntime (D6).
 */
interface RuntimeHandleLike {
  /** Provider shapes are checked at runtime by {@link mapProviders}'s filter. */
  runtime: { getProviders(): readonly unknown[] };
  version?: string;
  /** pi's `getAgentDir` (honours `PI_CODING_AGENT_DIR`); locates `models.json`. */
  getAgentDir?: () => string;
}

export type RuntimeSource = () => Promise<RuntimeHandleLike>;

let runtimeSource: RuntimeSource | undefined;

/**
 * Wire the server's single runtime in. Called once at boot by `server.ts`
 * before any provider-auth surface asks; resets the memoized build.
 */
export function setOAuthRegistryRuntimeSource(source: RuntimeSource | undefined): void {
  runtimeSource = source;
  readyPromise = undefined;
}

type OAuthProvider = PiProviderLike & { auth: { oauth: OAuthLoginFlow } };

const isOAuthProvider = (p: PiProviderLike): p is OAuthProvider =>
  p?.auth?.oauth != null;

/**
 * Project the runtime's provider list onto the registry. Pure and exported so
 * the id-set / flow-type-hint rules are testable without the SDK.
 */
export function mapProviders(
  providers: readonly PiProviderLike[],
): OAuthRegistryEntry[] {
  return providers.filter(isOAuthProvider).map((p) => ({
    id: p.id,
    name: p.auth.oauth.name,
    flowType: FLOW_TYPE_HINT[p.id] ?? "device_code",
    // pi's OAuth `isSubscription`; absent → false (an account sign-in).
    // See change: update-pi-core-1-0-adopt-apis (D8).
    subscription: p.auth.oauth.isSubscription === true,
    auth: p.auth.oauth,
  }));
}

let snapshot: OAuthRegistryEntry[] = [];
let snapshotError: string | null = null;

/**
 * Sync registry view. Empty until {@link oauthRegistryReady} settles. NOT a pure
 * snapshot read: `radius` is dropped while `models.json` declares a custom
 * Radius gateway (re-checked at most once a second).
 * See change: add-radius-provider-login (D2).
 */
export function getOAuthRegistry(): OAuthRegistryEntry[] {
  return applyRadiusOverride(snapshot);
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
  /** Supplies the server's single runtime. Defaults to the source wired by
   * {@link setOAuthRegistryRuntimeSource}. Injectable to drive the failure
   * branches (`X10`) without touching the real SDK. */
  getRuntime?: RuntimeSource;
  /** Resolved version used only in the failure message. */
  readVersion?: () => string;
  /** Sink for the one-shot failure line. Defaults to `console.error`. */
  log?: (message: string) => void;
}

/**
 * Build the registry from the shared runtime. Never rejects: every failure
 * (including a failed `ModelRuntime.create`, which the proxy reports too) is
 * absorbed into an empty snapshot plus {@link getRegistryError}. Exported
 * (with injectable deps) so the degradation paths are testable and re-runnable.
 */
export async function initOAuthRegistry(deps: OAuthRegistryInitDeps = {}): Promise<void> {
  const getRuntime = deps.getRuntime ?? runtimeSource;
  const readVersion = deps.readVersion ?? resolveVersionFallback;
  const log = deps.log ?? ((message: string) => console.error(message));

  let version = readVersion();
  try {
    if (!getRuntime) throw new Error("the server model runtime is not wired (setOAuthRegistryRuntimeSource)");
    let handle: RuntimeHandleLike;
    try {
      handle = await getRuntime();
    } catch (err) {
      const reported = (err as { version?: unknown } | null)?.version;
      if (typeof reported === "string" && reported) version = reported;
      throw err;
    }
    if (typeof handle?.version === "string" && handle.version) version = handle.version;
    setAgentDirSource(typeof handle?.getAgentDir === "function" ? handle.getAgentDir : undefined);
    const runtime = handle?.runtime;
    if (typeof runtime?.getProviders !== "function") {
      throw new Error("ModelRuntime.getProviders is not a function");
    }
    const entries = mapProviders(runtime.getProviders() as readonly PiProviderLike[]);
    if (entries.length === 0) {
      throw new Error("the runtime exposes no provider with an OAuth login");
    }
    setRegistry(entries, null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const detail = `${message} (pi-coding-agent ${version})`;
    setAgentDirSource(undefined);
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
