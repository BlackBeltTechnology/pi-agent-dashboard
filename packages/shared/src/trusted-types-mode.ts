/**
 * Trusted Types mode resolution — the single rule for the server (`csp.ts`,
 * `server.ts`) and the Vite dev-server meta plugin.
 *
 * Precedence: `PI_DASHBOARD_TRUSTED_TYPES` (env) → `security.trustedTypes`
 * (config) → default. A source is *set* when it is not `undefined` and not a
 * whitespace-only string. The first set source decides. Total over `unknown`
 * inputs. A set value that, trimmed and lowercased, is not `off|report|enforce`
 * resolves to `report` (the `hostGate.mode` no-lockout convention: a mistyped
 * rollback still relaxes) and yields one warning naming the source, never the
 * raw value. Every set source is validated, including one shadowed by another.
 * See change: enforce-trusted-types-default.
 */

export type TrustedTypesMode = "off" | "report" | "enforce";
export type TrustedTypesSource = "env" | "config" | "default";

export interface TrustedTypesWarning {
  source: "env" | "config";
  message: string;
}

export interface TrustedTypesResolution {
  mode: TrustedTypesMode;
  /** Which source decided the mode. */
  source: TrustedTypesSource;
  /** One entry per set source holding an unrecognized value. */
  warnings: TrustedTypesWarning[];
}

const MODES: readonly TrustedTypesMode[] = ["off", "report", "enforce"];

function isSet(raw: unknown): boolean {
  return raw !== undefined && !(typeof raw === "string" && raw.trim() === "");
}

/** The mode a raw value names (trimmed, case-insensitive), or `null` when it is not `off|report|enforce`. */
export function recognizeTrustedTypesMode(raw: unknown): TrustedTypesMode | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  return (MODES as readonly string[]).includes(v) ? (v as TrustedTypesMode) : null;
}

const WHERE = {
  env: "PI_DASHBOARD_TRUSTED_TYPES",
  config: "config key security.trustedTypes",
} as const;

export function resolveTrustedTypesMode(input: {
  env: unknown;
  config: unknown;
  cspMode: TrustedTypesMode;
}): TrustedTypesResolution {
  const warnings: TrustedTypesWarning[] = [];
  let decided: { mode: TrustedTypesMode; source: "env" | "config" } | undefined;
  for (const source of ["env", "config"] as const) {
    const raw = input[source];
    if (!isSet(raw)) continue;
    const known = recognizeTrustedTypesMode(raw);
    const mode: TrustedTypesMode = known ?? "report";
    if (!known) {
      warnings.push({
        source,
        message: `Unrecognized Trusted Types mode in ${WHERE[source]}; using "report". Use one of: off, report, enforce.`,
      });
    }
    decided ??= { mode, source };
  }
  if (decided) return { ...decided, warnings };
  // Default: unchanged from the pre-knob behaviour (`report`, `off` with the CSP).
  return { mode: input.cspMode === "off" ? "off" : "report", source: "default", warnings };
}
