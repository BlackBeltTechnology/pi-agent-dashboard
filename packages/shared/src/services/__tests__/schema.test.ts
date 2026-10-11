/**
 * Definition validator: modes, attached idle rule, native recipes, lifecycle
 * origin rule, oci-healthcheck. See change: add-service-registry-core
 * (test-plan E11, E24, E35, E37, E41).
 */
import { describe, expect, it } from "vitest";
import { effectiveTimings, execSecretEnvName, validateDefinition } from "../schema.js";

const DIGEST = `ghcr.io/x/docling@sha256:${"a".repeat(64)}`;

function nativeDef(overrides: Record<string, unknown> = {}) {
  return {
    id: "docling",
    mode: "managed",
    drivers: ["native"],
    native: { runner: "uvx", package: "docling-serve@1.36.0", args: ["--port", "${port.http}"], ports: { http: { protocol: "http" } } },
    health: { kind: "http", endpoint: "http", path: "/health" },
    origin: "user",
    ...overrides,
  };
}

function attachedDef(overrides: Record<string, unknown> = {}) {
  return {
    id: "obs",
    mode: "attached",
    endpoints: { ws: "ws://127.0.0.1:4455" },
    health: { kind: "ws-first-message", endpoint: "ws" },
    origin: "user",
    ...overrides,
  };
}

const errorsOf = (input: unknown, opts = {}) => {
  const r = validateDefinition(input, opts);
  return r.ok ? [] : r.errors;
};

describe("E11 — native is a driver, not a mode", () => {
  it("rejects mode:native as invalid-definition", () => {
    const errors = errorsOf(nativeDef({ mode: "native" }));
    expect(errors.some((e) => e.startsWith("mode:") && e.includes("driver"))).toBe(true);
  });
  it("accepts the same recipe as a managed native driver", () => {
    expect(validateDefinition(nativeDef()).ok).toBe(true);
  });
});

describe("E24 — attached without stop cannot idle-stop", () => {
  it("rejects lifecycle.start only + idleStopMinutes 15", () => {
    const errors = errorsOf(attachedDef({ lifecycle: { start: { darwin: ["open", "-a", "OBS"] } }, idleStopMinutes: 15 }));
    expect(errors.some((e) => e.startsWith("idleStopMinutes:"))).toBe(true);
  });
  it("accepts it with idleStopMinutes null, and defaults attached idle to null", () => {
    const def = attachedDef({ lifecycle: { start: { darwin: ["open", "-a", "OBS"] } }, idleStopMinutes: null });
    const r = validateDefinition(def);
    expect(r.ok).toBe(true);
    if (r.ok) expect(effectiveTimings({ ...r.value, idleStopMinutes: undefined }).idleStopMinutes).toBeNull();
  });
});

describe("E35 — native recipe allowlist and literal args", () => {
  it.each([
    ["runner bash", { runner: "bash" }, "native.runner"],
    ["unversioned package", { package: "x" }, "native.package"],
    ["range package", { package: "x@^1.0.0" }, "native.package"],
    ["command substitution", { args: ["$(curl evil)"] }, "native.args[0]"],
    ["backtick", { args: ["`id`"] }, "native.args[0]"],
    ["foreign placeholder", { args: ["${HOME}"] }, "native.args[0]"],
  ])("%s → invalid-definition naming %s", (_label, patch, key) => {
    const def = nativeDef();
    const errors = errorsOf({ ...def, native: { ...def.native, ...patch } });
    expect(errors.some((e) => e.startsWith(key as string))).toBe(true);
  });
});

describe("E37 — lifecycle commands are user-authored only", () => {
  it("rejects a package-origin attached entry declaring lifecycle.start", () => {
    const errors = errorsOf(
      attachedDef({
        lifecycle: { start: { darwin: ["open", "-a", "OBS"] } },
        origin: { package: "@x/obs", version: "1.0.0", templateHash: "sha256:x" },
      }),
    );
    expect(errors.some((e) => e.startsWith("lifecycle:") && e.includes("user-authored"))).toBe(true);
  });
  it("rejects a user entry with lifecycle.stop but no process matcher", () => {
    const errors = errorsOf(attachedDef({ lifecycle: { stop: { darwin: ["osascript", "-e", "quit app \"OBS\""] } } }));
    expect(errors.some((e) => e.startsWith("process:"))).toBe(true);
  });
  it("accepts a user entry with stop + process matcher", () => {
    expect(
      validateDefinition(
        attachedDef({ lifecycle: { stop: { darwin: ["osascript", "-e", "quit"] } }, process: { name: "OBS" }, idleStopMinutes: 15 }),
      ).ok,
    ).toBe(true);
  });
});

describe("E41 — oci-healthcheck needs an image HEALTHCHECK", () => {
  const ociDef = {
    id: "neo4j",
    mode: "managed",
    drivers: ["oci:docker"],
    oci: { image: DIGEST, ports: { http: { container: 7474, protocol: "http" } } },
    health: { kind: "oci-healthcheck" },
    origin: "user",
  };
  it("is invalid when the image declares no HEALTHCHECK (checked at add)", () => {
    expect(errorsOf(ociDef, { imageHasHealthcheck: false }).some((e) => e.startsWith("health.kind"))).toBe(true);
  });
  it("is valid when the image declares one", () => {
    expect(validateDefinition(ociDef, { imageHasHealthcheck: true }).ok).toBe(true);
  });
  it("is invalid on a non-OCI service", () => {
    expect(errorsOf(nativeDef({ health: { kind: "oci-healthcheck" } })).length).toBeGreaterThan(0);
  });
});

describe("user OCI entries", () => {
  const base = {
    id: "web",
    mode: "managed",
    drivers: ["oci:podman"],
    oci: { image: "nginx:latest", ports: { http: { container: 80 } }, binds: { "/tmp/site": "/usr/share/nginx/html" } },
    health: { kind: "http", endpoint: "http" },
    origin: "user",
  };
  it("may use unpinned tags and bind mounts", () => {
    expect(validateDefinition(base).ok).toBe(true);
  });
  it("may not declare privileged, host networking or a non-loopback port", () => {
    expect(errorsOf({ ...base, oci: { ...base.oci, privileged: true } }).join()).toMatch(/privileged/);
    expect(errorsOf({ ...base, oci: { ...base.oci, network: "host" } }).join()).toMatch(/network/);
    expect(errorsOf({ ...base, oci: { ...base.oci, ports: { http: { container: 80, hostIp: "0.0.0.0" } } } }).join()).toMatch(/loopback/);
  });
});

describe("execSecretEnvName", () => {
  it("uppercases and replaces non-alphanumerics", () => {
    expect(execSecretEnvName("obs", "password")).toBe("SVC_OBS_PASSWORD");
    expect(execSecretEnvName("neo4j-db", "admin_pw")).toBe("SVC_NEO4J_DB_ADMIN_PW");
  });
});
