/** Known team users (recorded on `GET /me`), for the folder-enable user picker. */
import fs from "node:fs";
import { atomicWriteJson, type FsOps, realFs, type TeamPaths } from "./paths.js";
import type { Caller } from "./types.js";

export interface KnownUser {
  iss: string;
  sub: string;
  email?: string;
  name?: string;
  lastSeenAt: string;
}

export class UsersStore {
  constructor(
    private readonly paths: TeamPaths,
    private readonly ops: FsOps = realFs,
  ) {}

  list(): KnownUser[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.paths.usersFile(), "utf8")) as { schemaVersion?: number; users?: KnownUser[] };
      return raw?.schemaVersion === 1 && Array.isArray(raw.users) ? raw.users : [];
    } catch {
      return [];
    }
  }

  record(caller: Caller, now: Date = new Date()): void {
    const users = this.list();
    const i = users.findIndex((u) => u.iss === caller.iss && u.sub === caller.sub);
    const prev = users[i];
    const same = prev && prev.email === caller.email && prev.name === caller.name;
    // `lastSeenAt` is a coarse hint: skip the file rewrite unless the profile changed or an hour passed.
    if (same && now.getTime() - Date.parse(prev.lastSeenAt) < 3_600_000) return;
    const entry: KnownUser = {
      iss: caller.iss,
      sub: caller.sub,
      ...(caller.email ? { email: caller.email } : {}),
      ...(caller.name ? { name: caller.name } : {}),
      lastSeenAt: now.toISOString(),
    };
    if (i >= 0) users[i] = entry;
    else users.push(entry);
    atomicWriteJson(this.paths.usersFile(), { schemaVersion: 1, users: users.slice(-1000) }, this.ops);
  }
}
