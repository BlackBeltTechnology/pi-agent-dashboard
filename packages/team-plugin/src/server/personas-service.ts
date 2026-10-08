/**
 * Persona operations (D3/D4): create / update / delete / fork with the
 * admin + owner gates and caps. See change: add-team-plugin.
 */
import type { Access } from "./access.js";
import { isSlug, parsePersonaKey } from "./paths.js";
import { LIMITS, type PersonaRules, suffixedSlug, validatePersonaInput } from "./persona.js";
import type { ProjectRegistry } from "./projects.js";
import type { SkillsService } from "./skills-service.js";
import type { PersonaStore as FsPersonaStore } from "./store.js";
import { type Caller, type Persona, type PersonaScope, type TeamConfig, TeamError, WORKSPACE_TARGET } from "./types.js";

export interface PersonaServiceDeps {
  store: FsPersonaStore;
  projects: ProjectRegistry;
  access: Access;
  skills: SkillsService;
  config: () => TeamConfig;
  now?: () => Date;
}

/** Wire form: no `owner` (callers only ever see their own private personas). */
function publicPersona(p: Persona): Omit<Persona, "owner"> {
  const { owner: _owner, ...rest } = p;
  return rest;
}

export class PersonaService {
  constructor(private readonly d: PersonaServiceDeps) {}

  private now(): string {
    return (this.d.now?.() ?? new Date()).toISOString();
  }

  private assignable(caller: Caller, scope: PersonaScope): Set<string> {
    const mode = this.d.access.mode();
    const ids = scope === "shared" ? this.d.projects.all().map((p) => p.id) : this.d.projects.usableBy(caller, mode).map((p) => p.id);
    return new Set([WORKSPACE_TARGET, ...ids]);
  }

  private rules(caller: Caller, scope: PersonaScope): PersonaRules {
    // One catalog snapshot per save (D14), shared by every skillRule call.
    const snap = this.d.skills.snapshot();
    return {
      mode: this.d.access.mode(),
      scope,
      caller,
      skillRule: (name, target) => this.d.skills.checkSave(name, caller, target, scope, snap),
      assignableTargets: this.assignable(caller, scope),
    };
  }

  list(caller: Caller): Omit<Persona, "owner">[] {
    return [...this.d.store.listShared(), ...this.d.store.listPrivate(caller.uk)].map(publicPersona);
  }

  private requireWritable(caller: Caller, key: string): Persona {
    const parsed = parsePersonaKey(key);
    if (!parsed) throw new TeamError(404, "persona_not_found");
    const p = this.d.store.get(key, caller.uk);
    if (!p) throw new TeamError(404, "persona_not_found");
    if (parsed.scope === "shared" && !caller.admin) throw new TeamError(403, "admin_required");
    return p;
  }

  private capCheck(scope: PersonaScope, caller: Caller): void {
    const n = this.d.store.count(scope, caller.uk);
    if (n >= (scope === "shared" ? LIMITS.shared : LIMITS.privatePerUser)) throw new TeamError(409, "persona_limit");
  }

  create(caller: Caller, body: unknown): Omit<Persona, "owner"> {
    const raw = (body && typeof body === "object" ? (body as Record<string, unknown>).scope : undefined) ?? "private";
    if (raw !== "shared" && raw !== "private") throw new TeamError(400, "invalid_persona", { fields: { scope: "invalid_scope" } });
    const scope: PersonaScope = raw;
    if (scope === "shared" && !caller.admin) throw new TeamError(403, "admin_required");
    const v = validatePersonaInput(body, this.rules(caller, scope), { create: true });
    if (!v.ok) throw new TeamError(400, "invalid_persona", { fields: v.fields });
    const slug = v.value.slug as string;
    const key = `${scope}:${slug}`;
    if (this.d.store.exists(key, caller.uk)) throw new TeamError(409, "slug_taken");
    this.capCheck(scope, caller);
    const stamp = this.now();
    const persona: Persona = {
      schemaVersion: 1,
      key,
      scope,
      ...(scope === "private" ? { owner: { iss: caller.iss, sub: caller.sub } } : {}),
      name: v.value.name,
      description: v.value.description,
      avatar: v.value.avatar,
      role: v.value.role,
      ...(v.value.model ? { model: v.value.model } : {}),
      instructions: v.value.instructions,
      tools: v.value.tools,
      projects: v.value.projects,
      ...(v.value.skills ? { skills: v.value.skills } : {}),
      createdAt: stamp,
      updatedAt: stamp,
      updatedBy: caller.uk,
    };
    this.d.store.put(persona, caller.uk);
    return publicPersona(persona);
  }

  update(caller: Caller, key: string, body: unknown): Omit<Persona, "owner"> {
    const cur = this.requireWritable(caller, key);
    const v = validatePersonaInput(body, this.rules(caller, cur.scope), { create: false });
    if (!v.ok) throw new TeamError(400, "invalid_persona", { fields: v.fields });
    // A scope in the body is only legal when unchanged.
    const bodyScope = (body as Record<string, unknown>).scope;
    if (bodyScope !== undefined && bodyScope !== cur.scope) throw new TeamError(400, "invalid_persona", { fields: { scope: "immutable" } });
    let updatedAt = this.now();
    if (updatedAt <= cur.updatedAt) updatedAt = new Date(Date.parse(cur.updatedAt) + 1).toISOString();
    const next: Persona = {
      ...cur,
      name: v.value.name,
      description: v.value.description,
      avatar: v.value.avatar,
      role: v.value.role,
      model: v.value.model,
      instructions: v.value.instructions,
      tools: v.value.tools,
      projects: v.value.projects,
      skills: v.value.skills,
      updatedAt,
      updatedBy: caller.uk,
    };
    if (!next.model) delete next.model;
    if (!next.skills) delete next.skills;
    this.d.store.put(next, caller.uk);
    return publicPersona(next);
  }

  remove(caller: Caller, key: string): void {
    this.requireWritable(caller, key);
    this.d.store.remove(key, caller.uk);
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
  fork(caller: Caller, key: string, body: unknown): Omit<Persona, "owner"> {
    const src = this.d.store.get(key, caller.uk);
    if (!src) throw new TeamError(404, "persona_not_found");
    const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    for (const k of Object.keys(b)) if (k !== "slug") throw new TeamError(400, "invalid_persona", { fields: { [k]: "unknown_field" } });
    const srcSlug = (parsePersonaKey(key) as { slug: string }).slug;
    let slug: string;
    if (b.slug !== undefined) {
      if (!isSlug(b.slug)) throw new TeamError(400, "invalid_persona", { fields: { slug: "invalid_slug" } });
      if (this.d.store.exists(`private:${b.slug}`, caller.uk)) throw new TeamError(409, "slug_taken");
      slug = b.slug;
    } else {
      let n = 1;
      slug = suffixedSlug(srcSlug, n);
      while (this.d.store.exists(`private:${slug}`, caller.uk)) slug = suffixedSlug(srcSlug, ++n);
    }
    this.capCheck("private", caller);
    const usable = this.assignable(caller, "private");
    const kept = src.projects.filter((id) => usable.has(id));
    const forkProjects = kept.length > 0 ? kept : [WORKSPACE_TARGET];
    // D5: the fork keeps only skills allowed for the forking user on every kept project.
    const snap = this.d.skills.snapshot();
    const keptSkills = src.skills?.filter((n) => forkProjects.every((t) => this.d.skills.checkSave(n, caller, t, "private", snap) === "ok"));
    const stamp = this.now();
    const fork: Persona = {
      schemaVersion: 1,
      key: `private:${slug}`,
      scope: "private",
      owner: { iss: caller.iss, sub: caller.sub },
      name: src.name,
      description: src.description,
      avatar: src.avatar,
      role: src.role,
      ...(src.model ? { model: src.model } : {}),
      instructions: src.instructions,
      tools: src.tools === "full" ? "files" : src.tools,
      projects: kept.length > 0 ? kept : [WORKSPACE_TARGET],
      ...(src.skills ? { skills: keptSkills } : {}),
      forkedFrom: src.key,
      createdAt: stamp,
      updatedAt: stamp,
      updatedBy: caller.uk,
    };
    this.d.store.put(fork, caller.uk);
    return publicPersona(fork);
  }
}
