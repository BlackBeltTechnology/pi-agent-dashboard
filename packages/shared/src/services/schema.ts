/**
 * Managed-services definition schema: types, defaults, the closed reason set,
 * and the strict validator shared by `services.json` entries (user or
 * offer-origin) and `pi.services` offers.
 *
 * Strict by construction (`parseSkillTools` style): every object has an exact
 * key set, unknown keys are rejected AND named, and every rejection names the
 * offending key. `pi.services` / `services.json` are public file formats that
 * third-party packages depend on, so the parser is the compatibility gate.
 * See change: add-service-registry-core (D2, D5, D6, D7).
 */

export const SERVICE_SCHEMA_VERSION = 1 as const;

export type ServiceMode = "managed" | "attached" | "external";
export const SERVICE_MODES: readonly ServiceMode[] = ["managed", "attached", "external"];

export type ManagedDriverId = "oci:docker" | "oci:podman" | "native";
export const MANAGED_DRIVERS: readonly ManagedDriverId[] = ["oci:docker", "oci:podman", "native"];

/** Every concrete driver, including the mode-implied ones. */
export type DriverName = ManagedDriverId | "attached" | "external";

/** Closed set of `unavailable` reasons (D2 + `duplicate-instances`). */
export const UNAVAILABLE_REASONS = [
  "runtime-missing",
  "runtime-unreachable",
  "host-vm-stopped",
  "image-absent",
  "runner-absent",
  "package-absent",
  "secret-unavailable",
  "unsupported-platform",
  "invalid-definition",
  "adoption-uncertain",
  "owner-conflict",
  "duplicate-instances",
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

/** Lifecycle states (spec: exactly one per service). */
export const SERVICE_STATES = [
  "stopped",
  "starting",
  "healthy",
  "idle",
  "stopping",
  "stop-failed",
  "blocked",
  "failed",
  "unavailable",
] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

/** States an `ensure` payload can carry (D9). `idle`/`stopped` never surface. */
export type EnsureState =
  | "healthy"
  | "starting"
  | "blocked"
  | "failed"
  | "unavailable"
  | "not-added"
  | "no-server"
  | "stop-failed";

export type Exposure = "loopback" | "all-interfaces" | "unknown";

/** The ensure payload (D9). Never carries a secret value. */
export interface EnsurePayload {
  id: string;
  state: EnsureState;
  reason?: UnavailableReason;
  retryAt?: string;
  endpoints?: Record<string, string>;
  leaseId?: string;
  driver?: DriverName;
  exposure?: Exposure;
  updateAvailable?: boolean;
  restartRequired?: boolean;
  tried?: Array<{ driver: DriverName; reason: UnavailableReason }>;
  hint?: string;
}

// ── Definition types ────────────────────────────────────────────────────────

export type EndpointProtocol = "http" | "tcp" | "ws";

export type HealthProbe =
  | { kind: "http"; endpoint: string; path?: string; timeoutMs?: number }
  | { kind: "tcp"; endpoint: string; timeoutMs?: number }
  | { kind: "ws-first-message"; endpoint: string; path?: string; timeoutMs?: number }
  | { kind: "oci-healthcheck" };

export interface SecretSpec {
  /** `store:<id>/<name>` (default), `env:<NAME>`, or `keychain:<service>/<account>`. */
  ref?: string;
  /** Generate a random value at add time (implies the store). */
  generate?: { bytes: number };
  /** Env var the started process sees (native/attached) or that holds the mount path (oci). */
  env?: string;
}

export interface OciSpec {
  image: string;
  ports: Record<string, { container: number; protocol?: EndpointProtocol }>;
  /** Named volumes: volume name → container path. */
  volumes?: Record<string, string>;
  /** Host bind mounts (user-origin entries only): host path → container path. */
  binds?: Record<string, string>;
  /** Non-secret env. */
  env?: Record<string, string>;
  command?: string[];
  /** `--init` is on unless explicitly false. */
  init?: boolean;
}

export type NativeRunner = "uvx" | "npx";
export const NATIVE_RUNNERS: readonly NativeRunner[] = ["uvx", "npx"];

export interface NativeRecipe {
  runner: NativeRunner;
  /** `<name>@<exact version>`. */
  package: string;
  bin?: string;
  /** Literal args; the only substitution is `${port.<name>}`. */
  args: string[];
  ports: Record<string, { protocol?: EndpointProtocol }>;
  env?: Record<string, string>;
}

export type PlatformArgv = Partial<Record<"darwin" | "linux" | "win32", string[]>>;

export type ServiceOrigin = "user" | { package: string; version: string; templateHash: string };

export interface ServiceDefinition {
  id: string;
  mode: ServiceMode;
  description?: string;
  /** managed only, preference order. */
  drivers?: ManagedDriverId[];
  oci?: OciSpec;
  native?: NativeRecipe;
  /** attached / external: name → URL. */
  endpoints?: Record<string, string>;
  /** attached + user origin only. */
  lifecycle?: { start?: PlatformArgv; stop?: PlatformArgv };
  /** attached: exact executable basename matcher. */
  process?: { name: string };
  health: HealthProbe;
  secrets?: Record<string, SecretSpec>;
  startTimeoutSec?: number;
  stopTimeoutSec?: number;
  idleStopMinutes?: number | null;
  origin: ServiceOrigin;
}

/** A `pi.services` entry: a definition without `origin`, plus `schemaVersion`. */
export type ServiceTemplate = Omit<ServiceDefinition, "origin"> & { schemaVersion: 1 };

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_START_TIMEOUT_SEC = 120;
export const DEFAULT_STOP_TIMEOUT_SEC = 15;
export const DEFAULT_IDLE_STOP_MINUTES = 15;
export const DEFAULT_LEASE_TTL_SEC = 300;

export interface EffectiveTimings {
  startTimeoutMs: number;
  stopTimeoutMs: number;
  /** null disables idle-stop (default for `attached`). */
  idleStopMinutes: number | null;
}

export function effectiveTimings(def: ServiceDefinition): EffectiveTimings {
  const idle =
    def.idleStopMinutes !== undefined
      ? def.idleStopMinutes
      : def.mode === "attached"
        ? null
        : DEFAULT_IDLE_STOP_MINUTES;
  return {
    startTimeoutMs: (def.startTimeoutSec ?? DEFAULT_START_TIMEOUT_SEC) * 1000,
    stopTimeoutMs: (def.stopTimeoutSec ?? DEFAULT_STOP_TIMEOUT_SEC) * 1000,
    idleStopMinutes: idle,
  };
}

// ── Validation ──────────────────────────────────────────────────────────────

export const SERVICE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VOLUME_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const BIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
/** `<name>@<exact semver>`; npm scopes allowed. No ranges, tags or `latest`. */
const EXACT_PACKAGE_PATTERN = /^(@[a-z0-9][\w.-]*\/)?[A-Za-z0-9][\w.-]*@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SECRET_REF_PATTERN = /^(store:[a-z0-9][a-z0-9-]*\/[A-Za-z][A-Za-z0-9_]*|env:[A-Za-z_][A-Za-z0-9_]*|keychain:[^/\s]+\/[^\s]+)$/;
const PORT_PLACEHOLDER = /\$\{port\.([A-Za-z][A-Za-z0-9_]*)\}/g;
const PLATFORMS = ["darwin", "linux", "win32"] as const;
const PROTOCOLS: readonly EndpointProtocol[] = ["http", "tcp", "ws"];

const TOP_KEYS = [
  "id", "mode", "description", "drivers", "oci", "native", "endpoints", "lifecycle",
  "process", "health", "secrets", "startTimeoutSec", "stopTimeoutSec", "idleStopMinutes", "origin",
] as const;
const OCI_KEYS = ["image", "ports", "volumes", "binds", "env", "command", "init"] as const;
const NATIVE_KEYS = ["runner", "package", "bin", "args", "ports", "env"] as const;
const SECRET_KEYS = ["ref", "generate", "env"] as const;
const HEALTH_KEYS: Record<HealthProbe["kind"], readonly string[]> = {
  http: ["kind", "endpoint", "path", "timeoutMs"],
  tcp: ["kind", "endpoint", "timeoutMs"],
  "ws-first-message": ["kind", "endpoint", "path", "timeoutMs"],
  "oci-healthcheck": ["kind"],
};

/** Keys with a dedicated, more specific rejection than "unknown key". */
const DANGEROUS_KEY_MESSAGES: Record<string, string> = {
  privileged: "privileged mode is never allowed",
  network: "host / custom networking is never allowed",
  networkMode: "host / custom networking is never allowed",
  hostNetwork: "host networking is never allowed",
  pid: "host pid namespace is never allowed",
  cap_add: "added capabilities are never allowed",
  capAdd: "added capabilities are never allowed",
  devices: "device passthrough is never allowed",
  host: "non-loopback port bindings are never allowed (ports publish on 127.0.0.1 only)",
  hostIp: "non-loopback port bindings are never allowed (ports publish on 127.0.0.1 only)",
  hostPort: "fixed host ports are not allowed (the runtime assigns a loopback port)",
};

export interface ValidateOptions {
  /** `offer`: a `pi.services` template (no `origin`, `schemaVersion` required). */
  kind?: "definition" | "offer";
  /**
   * Whether the OCI image declares a HEALTHCHECK, when known (checked at add
   * time). `false` makes an `oci-healthcheck` probe invalid.
   */
  imageHasHealthcheck?: boolean;
}

export type ValidateResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function extraKeys(obj: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

function rejectKeys(where: string, obj: Record<string, unknown>, allowed: readonly string[], errors: string[]): void {
  for (const k of extraKeys(obj, allowed)) {
    const special = DANGEROUS_KEY_MESSAGES[k];
    errors.push(special ? `${where}.${k}: ${special}` : `${where}.${k}: unknown key`);
  }
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function isValidUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return ["http:", "https:", "ws:", "wss:", "tcp:"].includes(u.protocol) && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Names of the endpoints a definition exposes (for health / secret validation). */
export function endpointNames(def: Pick<ServiceDefinition, "mode" | "oci" | "native" | "endpoints">): string[] {
  if (def.mode !== "managed") return Object.keys(def.endpoints ?? {});
  return [...new Set([...Object.keys(def.oci?.ports ?? {}), ...Object.keys(def.native?.ports ?? {})])];
}

function validateOci(oci: unknown, isUser: boolean, errors: string[]): void {
  if (!isPlainObject(oci)) {
    errors.push("oci: must be an object");
    return;
  }
  rejectKeys("oci", oci, OCI_KEYS, errors);
  if (typeof oci.image !== "string" || oci.image.trim() === "") {
    errors.push("oci.image: must be a non-empty string");
  } else if (!isUser && !/@sha256:[0-9a-f]{64}$/.test(oci.image)) {
    errors.push(`oci.image: offer images must be digest-pinned (@sha256:…), got ${JSON.stringify(oci.image)}`);
  }
  if (!isPlainObject(oci.ports) || Object.keys(oci.ports).length === 0) {
    errors.push("oci.ports: must name at least one port");
  } else {
    for (const [name, spec] of Object.entries(oci.ports)) {
      if (!NAME_PATTERN.test(name)) errors.push(`oci.ports.${name}: invalid port name`);
      if (!isPlainObject(spec)) {
        errors.push(`oci.ports.${name}: must be { container, protocol? } — non-loopback port bindings (e.g. ${JSON.stringify(spec)}) are not allowed`);
        continue;
      }
      rejectKeys(`oci.ports.${name}`, spec, ["container", "protocol"], errors);
      const c = spec.container;
      if (typeof c !== "number" || !Number.isInteger(c) || c < 1 || c > 65535) {
        errors.push(`oci.ports.${name}.container: must be a port number`);
      }
      if (spec.protocol !== undefined && !PROTOCOLS.includes(spec.protocol as EndpointProtocol)) {
        errors.push(`oci.ports.${name}.protocol: must be one of ${PROTOCOLS.join(", ")}`);
      }
    }
  }
  if (oci.volumes !== undefined) {
    if (!isPlainObject(oci.volumes)) errors.push("oci.volumes: must be an object");
    else {
      for (const [vol, target] of Object.entries(oci.volumes)) {
        if (!VOLUME_NAME_PATTERN.test(vol)) {
          errors.push(`oci.volumes.${vol}: bind mounts are not allowed here — a volume must be a named volume`);
        }
        if (typeof target !== "string" || !target.startsWith("/")) {
          errors.push(`oci.volumes.${vol}: container path must be absolute`);
        }
      }
    }
  }
  if (oci.binds !== undefined) {
    if (!isUser) errors.push("oci.binds: bind mounts are not allowed in a package offer");
    else if (!isPlainObject(oci.binds)) errors.push("oci.binds: must be an object");
    else {
      for (const [host, target] of Object.entries(oci.binds)) {
        if (!host.startsWith("/")) errors.push(`oci.binds.${host}: host path must be absolute`);
        if (typeof target !== "string" || !target.startsWith("/")) {
          errors.push(`oci.binds.${host}: container path must be absolute`);
        }
      }
    }
  }
  if (oci.env !== undefined) {
    if (!isPlainObject(oci.env) || !Object.values(oci.env).every((v) => typeof v === "string")) {
      errors.push("oci.env: must map names to strings");
    } else {
      for (const k of Object.keys(oci.env)) if (!ENV_NAME_PATTERN.test(k)) errors.push(`oci.env.${k}: invalid env name`);
    }
  }
  if (oci.command !== undefined && !isStringArray(oci.command)) errors.push("oci.command: must be an argv array");
  if (oci.init !== undefined && typeof oci.init !== "boolean") errors.push("oci.init: must be a boolean");
}

function validateNative(native: unknown, errors: string[]): void {
  if (!isPlainObject(native)) {
    errors.push("native: must be an object");
    return;
  }
  rejectKeys("native", native, NATIVE_KEYS, errors);
  if (!NATIVE_RUNNERS.includes(native.runner as NativeRunner)) {
    errors.push(`native.runner: ${JSON.stringify(native.runner)} is not an allowed runner (${NATIVE_RUNNERS.join(", ")})`);
  }
  if (typeof native.package !== "string" || !EXACT_PACKAGE_PATTERN.test(native.package)) {
    errors.push(`native.package: must pin an exact version (<name>@<x.y.z>), got ${JSON.stringify(native.package)}`);
  }
  if (native.bin !== undefined && (typeof native.bin !== "string" || !BIN_PATTERN.test(native.bin))) {
    errors.push("native.bin: invalid binary name");
  }
  const ports = isPlainObject(native.ports) ? native.ports : null;
  if (!ports || Object.keys(ports).length === 0) errors.push("native.ports: must name at least one port");
  else {
    for (const [name, spec] of Object.entries(ports)) {
      if (!NAME_PATTERN.test(name)) errors.push(`native.ports.${name}: invalid port name`);
      if (!isPlainObject(spec)) {
        errors.push(`native.ports.${name}: must be { protocol? }`);
        continue;
      }
      rejectKeys(`native.ports.${name}`, spec, ["protocol"], errors);
      if (spec.protocol !== undefined && !PROTOCOLS.includes(spec.protocol as EndpointProtocol)) {
        errors.push(`native.ports.${name}.protocol: must be one of ${PROTOCOLS.join(", ")}`);
      }
    }
  }
  if (!isStringArray(native.args)) {
    errors.push("native.args: must be an argv array of strings");
  } else {
    native.args.forEach((arg, i) => {
      // Only `${port.<name>}` may appear; anything shell-like is rejected so an
      // arg can never be read as a command substitution by any runner.
      const stripped = arg.replace(PORT_PLACEHOLDER, (_m, name: string) => {
        if (ports && !(name in ports)) errors.push(`native.args[${i}]: placeholder \${port.${name}} names no declared port`);
        return "";
      });
      if (/\$|`/.test(stripped)) {
        errors.push(`native.args[${i}]: only \${port.<name>} placeholders are allowed, got ${JSON.stringify(arg)}`);
      }
    });
  }
  if (native.env !== undefined) {
    if (!isPlainObject(native.env) || !Object.values(native.env).every((v) => typeof v === "string")) {
      errors.push("native.env: must map names to strings");
    }
  }
}

function validatePlatformArgv(where: string, v: unknown, errors: string[]): void {
  if (!isPlainObject(v)) {
    errors.push(`${where}: must map platforms to argv arrays`);
    return;
  }
  rejectKeys(where, v, PLATFORMS, errors);
  for (const p of PLATFORMS) {
    if (v[p] !== undefined && (!isStringArray(v[p]) || (v[p] as string[]).length === 0)) {
      errors.push(`${where}.${p}: must be a non-empty argv array (no shell string)`);
    }
  }
}

function validateHealth(health: unknown, def: Record<string, unknown>, opts: ValidateOptions, errors: string[]): void {
  if (!isPlainObject(health)) {
    errors.push("health: every definition must declare a health probe");
    return;
  }
  const kind = health.kind as HealthProbe["kind"];
  if (!(kind in HEALTH_KEYS)) {
    errors.push(`health.kind: must be one of ${Object.keys(HEALTH_KEYS).join(", ")}`);
    return;
  }
  rejectKeys("health", health, HEALTH_KEYS[kind], errors);
  if (kind === "oci-healthcheck") {
    const drivers = Array.isArray(def.drivers) ? (def.drivers as string[]) : [];
    if (def.mode !== "managed" || !drivers.some((d) => d.startsWith("oci:"))) {
      errors.push("health.kind: oci-healthcheck needs a managed OCI service");
    }
    if (opts.imageHasHealthcheck === false) {
      errors.push("health.kind: oci-healthcheck requires an image that declares a HEALTHCHECK");
    }
    return;
  }
  const names = endpointNames(def as unknown as ServiceDefinition);
  if (typeof health.endpoint !== "string" || !names.includes(health.endpoint)) {
    errors.push(`health.endpoint: must name a declared endpoint/port (${names.join(", ") || "none"})`);
  }
  if (health.path !== undefined && (typeof health.path !== "string" || !health.path.startsWith("/"))) {
    errors.push("health.path: must start with /");
  }
  if (health.timeoutMs !== undefined && !isPositiveNumber(health.timeoutMs)) errors.push("health.timeoutMs: must be positive");
}

function validateSecrets(secrets: unknown, isOffer: boolean, errors: string[]): void {
  if (!isPlainObject(secrets)) {
    errors.push("secrets: must be an object");
    return;
  }
  for (const [name, spec] of Object.entries(secrets)) {
    if (!NAME_PATTERN.test(name)) errors.push(`secrets.${name}: invalid secret name`);
    if (!isPlainObject(spec)) {
      errors.push(`secrets.${name}: must be an object`);
      continue;
    }
    rejectKeys(`secrets.${name}`, spec, SECRET_KEYS, errors);
    if (spec.ref !== undefined) {
      if (typeof spec.ref !== "string" || !SECRET_REF_PATTERN.test(spec.ref)) {
        errors.push(`secrets.${name}.ref: must be store:<id>/<name>, env:<NAME> or keychain:<service>/<account>`);
      } else if (isOffer && !spec.ref.startsWith("store:")) {
        errors.push(`secrets.${name}.ref: a package offer may not reference env: or keychain: secrets`);
      }
    }
    if (spec.generate !== undefined) {
      const bytes = isPlainObject(spec.generate) ? spec.generate.bytes : undefined;
      if (!isPlainObject(spec.generate) || extraKeys(spec.generate, ["bytes"]).length > 0 ||
          typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 16 || bytes > 1024) {
        errors.push(`secrets.${name}.generate: must be { bytes: 16..1024 }`);
      }
      if (spec.ref !== undefined && !String(spec.ref).startsWith("store:")) {
        errors.push(`secrets.${name}: a generated secret lives in the store; it cannot also carry an ${String(spec.ref).split(":")[0]}: ref`);
      }
    }
    if (spec.env !== undefined && (typeof spec.env !== "string" || !ENV_NAME_PATTERN.test(spec.env))) {
      errors.push(`secrets.${name}.env: invalid env name`);
    }
  }
}

/**
 * Validate a definition (`kind: "definition"`, needs `origin`) or an offer
 * template (`kind: "offer"`, needs `schemaVersion: 1`, no `origin`).
 * Every error names the offending key.
 */
export function validateDefinition(input: unknown, opts: ValidateOptions = {}): ValidateResult<ServiceDefinition> {
  const errors: string[] = [];
  const isOffer = opts.kind === "offer";
  if (!isPlainObject(input)) return { ok: false, errors: ["definition: must be an object"] };
  const def = input;

  if (isOffer) {
    if (def.schemaVersion !== SERVICE_SCHEMA_VERSION) {
      errors.push(`schemaVersion: must be ${SERVICE_SCHEMA_VERSION}`);
    }
    rejectKeys("offer", def, [...TOP_KEYS.filter((k) => k !== "origin"), "schemaVersion"], errors);
    if ("origin" in def) errors.push("offer.origin: an offer may not declare its own origin");
  } else {
    rejectKeys("definition", def, TOP_KEYS, errors);
  }

  const origin = def.origin;
  const isUser = !isOffer && origin === "user";
  if (!isOffer) {
    const pkgOrigin =
      isPlainObject(origin) &&
      typeof origin.package === "string" &&
      typeof origin.version === "string" &&
      typeof origin.templateHash === "string" &&
      extraKeys(origin, ["package", "version", "templateHash"]).length === 0;
    if (origin !== "user" && !pkgOrigin) {
      errors.push('origin: must be "user" or { package, version, templateHash }');
    }
  }

  if (typeof def.id !== "string" || !SERVICE_ID_PATTERN.test(def.id)) {
    errors.push(`id: must match ${SERVICE_ID_PATTERN}`);
  }
  if (def.description !== undefined && typeof def.description !== "string") errors.push("description: must be a string");

  const mode = def.mode;
  if (mode === "native") {
    errors.push('mode: "native" is a driver, not a mode — use mode "managed" with drivers ["native"]');
  } else if (!SERVICE_MODES.includes(mode as ServiceMode)) {
    errors.push(`mode: must be one of ${SERVICE_MODES.join(", ")}`);
  }

  if (mode === "managed") {
    const drivers = def.drivers;
    if (!Array.isArray(drivers) || drivers.length === 0 ||
        !drivers.every((d) => MANAGED_DRIVERS.includes(d as ManagedDriverId)) ||
        new Set(drivers).size !== drivers.length) {
      errors.push(`drivers: must be a non-empty, duplicate-free list of ${MANAGED_DRIVERS.join(", ")}`);
    } else {
      if (drivers.some((d) => String(d).startsWith("oci:")) && def.oci === undefined) errors.push("oci: required by an oci driver");
      if (drivers.includes("native") && def.native === undefined) errors.push("native: required by the native driver");
    }
    if (def.oci !== undefined) validateOci(def.oci, isUser, errors);
    if (def.native !== undefined) validateNative(def.native, errors);
    for (const k of ["endpoints", "lifecycle", "process"] as const) {
      if (def[k] !== undefined) errors.push(`${k}: not allowed for a managed service`);
    }
  } else if (mode === "attached" || mode === "external") {
    for (const k of ["drivers", "oci", "native"] as const) {
      if (def[k] !== undefined) errors.push(`${k}: not allowed for an ${mode} service`);
    }
    if (!isPlainObject(def.endpoints) || Object.keys(def.endpoints).length === 0) {
      errors.push("endpoints: must name at least one endpoint URL");
    } else {
      for (const [name, url] of Object.entries(def.endpoints)) {
        if (!NAME_PATTERN.test(name)) errors.push(`endpoints.${name}: invalid endpoint name`);
        if (!isValidUrl(url)) errors.push(`endpoints.${name}: must be an http(s)/ws(s)/tcp URL`);
      }
    }
    if (mode === "external") {
      for (const k of ["lifecycle", "process"] as const) {
        if (def[k] !== undefined) errors.push(`${k}: an external service has no lifecycle`);
      }
    } else {
      if (def.lifecycle !== undefined) {
        if (!isUser) {
          errors.push("lifecycle: lifecycle commands are allowed only in user-authored entries");
        } else if (!isPlainObject(def.lifecycle)) {
          errors.push("lifecycle: must be { start?, stop? }");
        } else {
          rejectKeys("lifecycle", def.lifecycle, ["start", "stop"], errors);
          if (def.lifecycle.start !== undefined) validatePlatformArgv("lifecycle.start", def.lifecycle.start, errors);
          if (def.lifecycle.stop !== undefined) validatePlatformArgv("lifecycle.stop", def.lifecycle.stop, errors);
        }
      }
      if (def.process !== undefined) {
        if (!isPlainObject(def.process) || typeof def.process.name !== "string" || def.process.name.trim() === "" ||
            extraKeys(def.process, ["name"]).length > 0 || /[\\/]/.test(def.process.name)) {
          errors.push("process: must be { name: <exact executable basename> }");
        }
      }
      const hasStop = isPlainObject(def.lifecycle) && def.lifecycle.stop !== undefined;
      if (hasStop && def.process === undefined) {
        errors.push("process: an entry that declares lifecycle.stop must declare a process matcher");
      }
      if (!hasStop && def.idleStopMinutes !== undefined && def.idleStopMinutes !== null) {
        errors.push("idleStopMinutes: must be null for an attached entry without lifecycle.stop (it cannot be stopped)");
      }
    }
  }

  validateHealth(def.health, def, opts, errors);
  if (def.secrets !== undefined) validateSecrets(def.secrets, isOffer, errors);
  for (const k of ["startTimeoutSec", "stopTimeoutSec"] as const) {
    if (def[k] !== undefined && !isPositiveNumber(def[k])) errors.push(`${k}: must be a positive number`);
  }
  if (def.idleStopMinutes !== undefined && def.idleStopMinutes !== null && !isPositiveNumber(def.idleStopMinutes)) {
    errors.push("idleStopMinutes: must be a positive number or null");
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: def as unknown as ServiceDefinition };
}

/** Canonical JSON (sorted keys) — the input to every hash in this module. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The env var `service exec` sets for a secret: `SVC_<ID>_<NAME>`, uppercased, non-alnum → `_`. */
export function execSecretEnvName(id: string, name: string): string {
  return `SVC_${id}_${name}`.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}
