/**
 * Persona store (D2/D3): one JSON file per persona, atomic writes, unknown
 * schemaVersion skipped on read. See change: add-team-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson, type FsOps, parsePersonaKey, realFs, type TeamPaths } from "./paths.js";
import { type Persona, TeamError } from "./types.js";

export interface StoreLogger {
  warn(msg: string): void;
}

export class PersonaStore {
  constructor(
    private readonly paths: TeamPaths,
    private readonly logger: StoreLogger,
    private readonly ops: FsOps = realFs,
  ) {}

  private dirFor(scope: "shared" | "private", uk: string): string {
    return scope === "shared" ? this.paths.sharedPersonasDir() : this.paths.privatePersonasDir(uk);
  }

  private fileFor(scope: "shared" | "private", slug: string, uk: string): string {
    return this.paths.confine(path.join(this.dirFor(scope, uk), `${slug}.json`));
  }

  private readDir(dir: string): Persona[] {
    let names: string[];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
    } catch {
      return [];
    }
    const out: Persona[] = [];
    for (const n of names) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")) as Persona;
        if (raw?.schemaVersion !== 1) {
          this.logger.warn(`team.persona_skipped file=${n} reason=schema_version`);
          continue;
        }
        out.push(raw);
      } catch {
        this.logger.warn(`team.persona_skipped file=${n} reason=unreadable`);
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  listShared(): Persona[] {
    return this.readDir(this.paths.sharedPersonasDir());
  }

  listPrivate(uk: string): Persona[] {
    return this.readDir(this.paths.privatePersonasDir(uk));
  }

  /** `private:` keys resolve inside the caller's own folder only. */
  get(key: string, uk: string): Persona | null {
    const p = parsePersonaKey(key);
    if (!p) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(this.fileFor(p.scope, p.slug, uk), "utf8")) as Persona;
      return raw?.schemaVersion === 1 ? raw : null;
    } catch {
      return null;
    }
  }

  exists(key: string, uk: string): boolean {
    return this.get(key, uk) !== null;
  }

  put(persona: Persona, uk: string): void {
    const p = parsePersonaKey(persona.key);
    if (!p) throw new TeamError(400, "invalid_persona_key");
    atomicWriteJson(this.fileFor(p.scope, p.slug, uk), persona, this.ops);
  }

  remove(key: string, uk: string): boolean {
    const p = parsePersonaKey(key);
    if (!p) return false;
    const file = this.fileFor(p.scope, p.slug, uk);
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file, { force: true });
    return true;
  }

  count(scope: "shared" | "private", uk: string): number {
    return this.readDir(this.dirFor(scope, uk)).length;
  }
}
