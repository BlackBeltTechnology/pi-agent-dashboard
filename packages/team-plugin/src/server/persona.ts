/**
 * Persona input validation (D3/D4). Pure: all environment (mode, admin,
 * allowed targets, skill catalog) arrives through `PersonaRules`.
 * See change: add-team-plugin.
 */
import { isSlug } from "./paths.js";
import { type AvatarSpec, type Caller, type Mode, type PersonaRole, type PersonaScope, type ToolsPreset, WORKSPACE_TARGET } from "./types.js";

export const LIMITS = {
  nameMax: 60,
  descriptionMax: 280,
  instructionsMaxBytes: 32768,
  modelMax: 200,
  projectsMax: 50,
  skillsMax: 50,
  privatePerUser: 50,
  shared: 200,
} as const;

export interface PersonaRules {
  mode: Mode;
  scope: PersonaScope;
  caller: Caller;
  skillCatalog: Record<string, string>;
  /** Targets the author may assign (always includes `_ws`). */
  assignableTargets: ReadonlySet<string>;
}

interface PersonaInput {
  slug?: string;
  name: string;
  description: string;
  avatar: AvatarSpec;
  role: PersonaRole;
  model?: string;
  instructions: string;
  tools: ToolsPreset;
  projects: string[];
  skills?: string[];
}

export type Validation =
  | { ok: true; value: PersonaInput }
  | { ok: false; fields: Record<string, string> };

const ALLOWED_KEYS = new Set([
  "slug",
  "scope",
  "name",
  "description",
  "avatar",
  "role",
  "model",
  "instructions",
  "tools",
  "projects",
  "skills",
]);

export const cpLength = (s: string): number => [...s].length;

export function validatePersonaInput(body: unknown, rules: PersonaRules, opts: { create: boolean }): Validation {
  const fields: Record<string, string> = {};
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, fields: { _: "body_required" } };
  }
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!ALLOWED_KEYS.has(k)) fields[k] = "unknown_field";

  let slug: string | undefined;
  if (opts.create) {
    if (!isSlug(b.slug)) fields.slug = "invalid_slug";
    else slug = b.slug;
  } else if (b.slug !== undefined) {
    fields.slug = "immutable";
  }

  const name = b.name;
  if (typeof name !== "string" || cpLength(name) < 1 || cpLength(name) > LIMITS.nameMax) fields.name = "invalid_length";

  const description = b.description === undefined ? "" : b.description;
  if (typeof description !== "string" || cpLength(description) > LIMITS.descriptionMax) fields.description = "invalid_length";

  const instructions = b.instructions === undefined ? "" : b.instructions;
  if (typeof instructions !== "string" || Buffer.byteLength(instructions, "utf8") > LIMITS.instructionsMaxBytes) {
    fields.instructions = "too_long";
  }

  let avatar: AvatarSpec = { kind: "initials" };
  if (b.avatar !== undefined) {
    const a = b.avatar as Record<string, unknown> | null;
    if (a && typeof a === "object" && a.kind === "initials" && Object.keys(a).length === 1) avatar = { kind: "initials" };
    else if (
      a &&
      typeof a === "object" &&
      a.kind === "gallery" &&
      typeof a.id === "string" &&
      /^[a-z0-9-]{1,40}$/.test(a.id) &&
      Object.keys(a).length === 2
    ) {
      avatar = { kind: "gallery", id: a.id };
    } else fields.avatar = "invalid_avatar";
  }

  let role: PersonaRole = "member";
  if (b.role !== undefined) {
    if (b.role === "leader" || b.role === "member") role = b.role;
    else fields.role = "invalid_role";
  }

  let model: string | undefined;
  if (b.model !== undefined) {
    if (typeof b.model !== "string" || b.model.length === 0 || b.model.length > LIMITS.modelMax || b.model.includes("\0")) {
      fields.model = "invalid_model";
    } else model = b.model;
  }

  let tools: ToolsPreset = "chat";
  if (b.tools !== undefined) {
    if (b.tools === "chat" || b.tools === "files" || b.tools === "full") tools = b.tools;
    else fields.tools = "invalid_tools";
  }
  if (tools === "full" && !(rules.mode === "single" && rules.scope === "shared")) fields.tools = "full_not_allowed";

  let projects: string[] = [WORKSPACE_TARGET];
  if (b.projects !== undefined) {
    const p = b.projects;
    if (!Array.isArray(p) || p.length < 1 || p.length > LIMITS.projectsMax) fields.projects = "invalid_projects";
    else if (new Set(p).size !== p.length) fields.projects = "duplicate_projects";
    else if (!p.every((x) => typeof x === "string" && rules.assignableTargets.has(x))) fields.projects = "unknown_project";
    else projects = p as string[];
  }

  let skills: string[] | undefined;
  if (b.skills !== undefined) {
    const s = b.skills;
    if (!Array.isArray(s) || s.length > LIMITS.skillsMax || new Set(s).size !== s.length) fields.skills = "invalid_skills";
    else if (!s.every((x) => typeof x === "string" && Object.hasOwn(rules.skillCatalog, x))) fields.skills = "unknown_skill";
    else skills = s as string[];
  }

  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: {
      slug,
      name: name as string,
      description: description as string,
      avatar,
      role,
      model,
      instructions: instructions as string,
      tools,
      projects,
      skills,
    },
  };
}

/** Fork slug: base truncated so `<base>-<n>` fits 40 chars. */
export function suffixedSlug(base: string, n: number): string {
  if (n <= 1) return base;
  const suffix = `-${n}`;
  const trimmed = base.slice(0, 40 - suffix.length).replace(/-+$/, "");
  return `${trimmed}${suffix}`;
}
