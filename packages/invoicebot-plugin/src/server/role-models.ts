/**
 * Role-plane audit — the second model-selection plane.
 *
 * `spawn-model.ts` pins which model an InvoiceBot SESSION boots with. The agents
 * that run inside it resolve their model through ROLE aliases instead, read from
 * the deployment's role map. The two planes can disagree: observed live, the
 * spawn model and most roles agreed while `rule-authoring` and `validation`
 * pointed at a different provider entirely — with no runtime signal, so the only
 * evidence was a human reading the settings UI.
 *
 * This module makes that divergence observable. It REPORTS, never repairs: the
 * role map is operator-owned configuration edited from the settings UI, and a
 * plugin silently rewriting it would erase a deliberate choice.
 *
 * Divergence is defined against the PIN, not a vendor deny-list — that catches
 * every wrong provider, including ones nobody thought to ban.
 *
 * Reads model identifiers only; `auth.json` is never opened.
 * See change: pin-invoicebot-role-models.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseModelRef } from "./spawn-model.js";

/** The roles InvoiceBot's agents resolve through. */
export const IB_DECLARED_ROLES: readonly string[] = [
  "classification",
  "extraction",
  "bank-intake",
  "rule-authoring",
  "validation",
  "fast",
  "smart",
];

/** Which configuration surface a finding came from. */
export type RoleSurface = "roles" | "activePreset";

/** A role whose assignment is not the pinned model. */
export interface RoleDivergence {
  role: string;
  assigned: string;
  surface: RoleSurface;
}

/** The role configuration, read defensively. */
export interface RoleMap {
  /** The EFFECTIVE role → model assignments. */
  roles: Record<string, string>;
  /** Name of the loaded preset, when one is active. */
  activePresetName?: string;
  /** The active preset's assignments (latent: loading it overwrites `roles`). */
  activePresetRoles: Record<string, string>;
}

/** Audit outcome. `ok` is true when nothing actionable was found. */
export interface RoleAudit {
  ok: boolean;
  /** True when no pinned model was available to compare against. */
  skipped: boolean;
  /** How many declared roles were compared. */
  checked: number;
  divergent: RoleDivergence[];
  /** Declared roles carrying no assignment (they fall through to a host default). */
  unset: string[];
}

/** Coerce an unknown value into a `role → model` string map, dropping junk. */
function toRoleRecord(raw: unknown): Record<string, string> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/**
 * Read the deployment role map from `<home>/.pi/agent/providers.json`.
 *
 * Defensive by contract: a missing, unreadable or malformed file yields an empty
 * map instead of throwing. Activation must never fail because a config file is
 * broken — that would turn a cosmetic misconfiguration into an outage.
 */
export function readRoleMap(home: string): RoleMap {
  const empty: RoleMap = { roles: {}, activePresetRoles: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(home, ".pi", "agent", "providers.json"), "utf-8"));
  } catch {
    return empty;
  }
  if (parsed === null || typeof parsed !== "object") return empty;

  const doc = parsed as { roles?: unknown; rolePresets?: unknown; activePreset?: unknown };
  const activePresetName = typeof doc.activePreset === "string" && doc.activePreset ? doc.activePreset : undefined;

  let activePresetRoles: Record<string, string> = {};
  if (activePresetName && Array.isArray(doc.rolePresets)) {
    const hit = (doc.rolePresets as Array<{ name?: unknown; roles?: unknown }>).find(
      (p) => p && typeof p === "object" && p.name === activePresetName,
    );
    if (hit) activePresetRoles = toRoleRecord(hit.roles);
  }

  return {
    roles: toRoleRecord(doc.roles),
    ...(activePresetName ? { activePresetName } : {}),
    activePresetRoles,
  };
}

/** True when `assigned` names the same provider + modelId as `pin`. */
function sameModel(assigned: string, pin: string): boolean {
  const a = parseModelRef(assigned);
  const b = parseModelRef(pin);
  if (!a.ok || !b.ok) return false;
  return a.provider === b.provider && a.modelId === b.modelId;
}

/**
 * Compare every declared InvoiceBot role — in the effective map AND in the
 * active preset — against the pinned spawn model.
 *
 * `pin` absent or malformed ⇒ `skipped`: with no trustworthy reference, an audit
 * would only produce false alarms.
 */
export function auditRoleModels(map: RoleMap, pin: string | undefined): RoleAudit {
  const base: RoleAudit = { ok: true, skipped: true, checked: 0, divergent: [], unset: [] };
  if (pin === undefined || !parseModelRef(pin).ok) return base;

  const divergent: RoleDivergence[] = [];
  const unset: string[] = [];

  for (const role of IB_DECLARED_ROLES) {
    const assigned = map.roles[role];
    if (assigned === undefined || assigned.trim() === "") {
      unset.push(role);
    } else if (!sameModel(assigned, pin)) {
      divergent.push({ role, assigned, surface: "roles" });
    }

    // A preset role is latent: loading the preset overwrites the effective map.
    const preset = map.activePresetRoles[role];
    if (preset !== undefined && preset.trim() !== "" && !sameModel(preset, pin)) {
      divergent.push({ role, assigned: preset, surface: "activePreset" });
    }
  }

  return {
    ok: divergent.length === 0 && unset.length === 0,
    skipped: false,
    checked: IB_DECLARED_ROLES.length,
    divergent,
    unset,
  };
}

/** One-line, operator-readable rendering of an audit for the activation log. */
export function describeRoleAudit(audit: RoleAudit, pin: string | undefined): string {
  if (audit.skipped) return "invoicebot role audit skipped — no spawn model configured to compare against";
  if (audit.ok) return `invoicebot roles: all ${audit.checked} declared roles pinned to ${pin}`;
  const parts: string[] = [];
  if (audit.divergent.length > 0) {
    parts.push(
      `NOT pinned to ${pin}: ${audit.divergent.map((d) => `@${d.role}=${d.assigned}${d.surface === "activePreset" ? " (active preset)" : ""}`).join(", ")}`,
    );
  }
  if (audit.unset.length > 0) parts.push(`unassigned (host default): ${audit.unset.map((r) => `@${r}`).join(", ")}`);
  return `invoicebot role audit found ${audit.divergent.length + audit.unset.length} issue(s) — ${parts.join("; ")}`;
}
