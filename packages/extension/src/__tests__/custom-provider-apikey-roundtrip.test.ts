/**
 * Faux-provider end-to-end test for custom-provider apiKey handling.
 *
 * `toRegisterApiKey` turns the providers.json `apiKey` (literal or `$ENV`
 * reference) into the value handed to `pi.registerProvider(...)`. pi resolves
 * that field natively at request time. This test wires a FAUX provider with
 * custom keys through a FAITHFUL port of pi's config-value resolver and a faux
 * upstream request to assert the real secret reaches the wire intact — and that
 * nothing is leaked into `process.env`.
 *
 * The resolver below mirrors @earendil-works/pi-coding-agent
 * `dist/core/resolve-config-value.js` (parseConfigValueTemplate / command
 * detection). Keep it in sync if pi's resolution semantics change.
 * See change: fix-custom-provider-save-and-auth.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { toRegisterApiKey } from "../provider-register.js";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*/;
const ENV_NAME_FULL = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Faithful port of pi's resolveConfigValue (literal / $ENV / ${ENV} / command). */
function resolvePiConfigValue(
  config: string,
  env: Record<string, string | undefined> = process.env,
): string {
  if (config.startsWith("!")) {
    throw new Error(`pi would execute this apiKey as a shell command: ${config}`);
  }
  let out = "";
  let i = 0;
  while (i < config.length) {
    const d = config.indexOf("$", i);
    if (d < 0) {
      out += config.slice(i);
      break;
    }
    out += config.slice(i, d);
    const next = config[d + 1];
    if (next === "$" || next === "!") {
      out += next;
      i = d + 2;
      continue;
    }
    if (next === "{") {
      const end = config.indexOf("}", d + 2);
      if (end < 0) {
        out += "$";
        i = d + 1;
        continue;
      }
      const name = config.slice(d + 2, end);
      out += ENV_NAME_FULL.test(name) ? (env[name] ?? "") : config.slice(d, end + 1);
      i = end + 1;
      continue;
    }
    const m = config.slice(d + 1).match(ENV_NAME);
    if (m) {
      out += env[m[0]] ?? "";
      i = d + 1 + m[0].length;
      continue;
    }
    out += "$";
    i = d + 1;
  }
  return out;
}

/**
 * Faux pi model-registry auth resolution. Mirrors
 * `getApiKeyAndHeaders`: auth.json key wins; otherwise resolve the registered
 * provider apiKey via pi's config-value semantics. Returns the Authorization
 * header the upstream HTTP request would carry.
 */
function fauxUpstreamAuthHeader(
  registeredApiKey: string,
  authJsonKey?: string,
): string {
  const apiKey = authJsonKey ?? resolvePiConfigValue(registeredApiKey);
  return `Bearer ${apiKey}`;
}

describe("custom-provider apiKey round-trip (faux provider)", () => {
  beforeEach(() => {
    delete process.env.PROXY_KEY;
    // Guard against the removed JUDO_* synthetic-env hack reappearing.
    for (const k of Object.keys(process.env)) {
      if (k.startsWith("JUDO_")) delete process.env[k];
    }
  });

  it("literal key reaches the upstream Bearer header intact", () => {
    const registered = toRegisterApiKey("sk-faux-secret-123");
    expect(fauxUpstreamAuthHeader(registered)).toBe("Bearer sk-faux-secret-123");
  });

  it("$ENV reference resolves from the environment", () => {
    process.env.PROXY_KEY = "sk-env-secret-456";
    const registered = toRegisterApiKey("$PROXY_KEY");
    expect(registered).toBe("$PROXY_KEY");
    expect(fauxUpstreamAuthHeader(registered)).toBe("Bearer sk-env-secret-456");
  });

  it("literal key containing $ is not corrupted by env interpolation", () => {
    const registered = toRegisterApiKey("sk-a$BHOME-b$c");
    // The escaped form must round-trip back to the exact original secret.
    expect(fauxUpstreamAuthHeader(registered)).toBe("Bearer sk-a$BHOME-b$c");
  });

  it("literal key starting with ! is not run as a shell command", () => {
    const registered = toRegisterApiKey("!literal-key");
    expect(() => fauxUpstreamAuthHeader(registered)).not.toThrow();
    expect(fauxUpstreamAuthHeader(registered)).toBe("Bearer !literal-key");
  });

  it("auth.json credential takes precedence over the registered key", () => {
    const registered = toRegisterApiKey("sk-from-providers-json");
    expect(fauxUpstreamAuthHeader(registered, "sk-from-auth-json")).toBe(
      "Bearer sk-from-auth-json",
    );
  });

  it("never promotes a literal secret into process.env (no JUDO_* leak)", () => {
    toRegisterApiKey("sk-faux-secret-123");
    const leaked = Object.keys(process.env).filter((k) => k.startsWith("JUDO_"));
    expect(leaked).toEqual([]);
  });
});
