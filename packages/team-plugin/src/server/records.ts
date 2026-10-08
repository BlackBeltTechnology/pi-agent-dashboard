/**
 * Conversation records (D5): one JSON file per conversation under
 * `users/<uk>/conversations/<t>/<scope>-<slug>/<c>.json`, plus an in-memory
 * sessionId → locator index for event routing. See change: add-team-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import { atomicWriteJson, type FsOps, LOCAL_USER_KEY, personaDirName, realFs, type TeamPaths } from "./paths.js";
import { type ConversationRecord, TeamError } from "./types.js";

const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{22}$/;

export interface Locator {
  uk: string;
  t: string;
  personaKey: string;
  c: string;
}

export interface LocatedRecord extends Locator {
  record: ConversationRecord;
}

/**
 * Skill names the record's session was spawned with (audit F4): revocation is judged against
 * this set, not the persona's current list. `null` when the record carries no usable spawned
 * set (predates audit F4, or a broken shape) — callers fall back to `persona.skills`.
 */
export function spawnedSkillNames(rec: ConversationRecord): string[] | null {
  if (!Array.isArray(rec.skills)) return null;
  const out: string[] = [];
  for (const s of rec.skills) {
    if (!s || typeof s.name !== "string" || !s.name || typeof s.root !== "string" || !path.isAbsolute(s.root)) return null;
    out.push(s.name);
  }
  return out;
}

function personaKeyFromDir(name: string): string | null {
  if (name.startsWith("shared-")) return `shared:${name.slice(7)}`;
  if (name.startsWith("private-")) return `private:${name.slice(8)}`;
  return null;
}

export class RecordStore {
  private index = new Map<string, Locator>();

  constructor(
    private readonly paths: TeamPaths,
    private readonly ops: FsOps = realFs,
  ) {}

  private file(l: Locator): string {
    if (!CONVERSATION_ID_RE.test(l.c)) throw new TeamError(404, "conversation_not_found");
    return this.paths.confine(path.join(this.paths.conversationsDir(l.uk, l.t, l.personaKey), `${l.c}.json`));
  }

  read(l: Locator): ConversationRecord | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(l), "utf8")) as ConversationRecord;
      return raw?.schemaVersion === 1 ? raw : null;
    } catch {
      return null;
    }
  }

  write(l: Locator, record: ConversationRecord): void {
    atomicWriteJson(this.file(l), record, this.ops);
    this.index.set(record.sessionId, { ...l });
  }

  delete(l: Locator): void {
    const rec = this.read(l);
    fs.rmSync(this.file(l), { force: true });
    if (rec) this.index.delete(rec.sessionId);
  }

  /** Records of one user for a target, optionally one persona. */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
  list(uk: string, t: string, personaKey?: string): LocatedRecord[] {
    const out: LocatedRecord[] = [];
    let personaDirs: string[];
    const base = (() => {
      try {
        return this.paths.confine(path.join(this.paths.conversationsRoot(uk), t));
      } catch {
        return null;
      }
    })();
    if (!base) return out;
    if (personaKey) personaDirs = [personaDirName(personaKey)];
    else {
      try {
        personaDirs = fs.readdirSync(base);
      } catch {
        return out;
      }
    }
    for (const d of personaDirs) {
      const pk = personaKeyFromDir(d);
      if (!pk) continue;
      let files: string[];
      try {
        files = fs.readdirSync(path.join(base, d)).filter((f) => f.endsWith(".json"));
      } catch {
        continue;
      }
      for (const f of files) {
        const c = f.slice(0, -5);
        if (!CONVERSATION_ID_RE.test(c)) continue;
        const record = this.read({ uk, t, personaKey: pk, c });
        if (record) out.push({ uk, t, personaKey: pk, c, record });
      }
    }
    return out;
  }

  /** Every record of every user (startup index + idle sweep). */
  scanAll(): LocatedRecord[] {
    const out: LocatedRecord[] = [];
    const usersDir = path.join(this.paths.home, "users");
    let users: string[];
    try {
      users = fs.readdirSync(usersDir);
    } catch {
      return out;
    }
    for (const uk of users) {
      if (uk !== LOCAL_USER_KEY && !/^[0-9a-f]{32}$/.test(uk)) continue;
      let targets: string[];
      try {
        targets = fs.readdirSync(this.paths.conversationsRoot(uk));
      } catch {
        continue;
      }
      for (const t of targets) out.push(...this.list(uk, t));
    }
    for (const r of out) this.index.set(r.record.sessionId, { uk: r.uk, t: r.t, personaKey: r.personaKey, c: r.c });
    return out;
  }

  locate(sessionId: string): Locator | undefined {
    return this.index.get(sessionId);
  }
}
