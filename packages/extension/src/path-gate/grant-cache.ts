/**
 * Read-only, mtime-gated reader of `~/.pi/dashboard/access-grants.json` for the
 * gate's local grant check (D3). Project-scope subjects only; missing/malformed
 * → empty (fail closed to "ask"). The bridge never writes the store.
 * See change: ask-agent-file-access-in-chat.
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";

export interface GrantCacheOptions {
  file?: string;
  statSync?: (p: string) => { mtimeMs: number; size: number; ino?: number; ctimeMs?: number };
  readFileSync?: (p: string) => string;
}

function defaultGrantsFile(): string {
  return nodePath.join(os.homedir(), ".pi", "dashboard", "access-grants.json");
}

export class GrantCache {
  private sig = "";
  private subjects: string[] = [];
  private readonly file: string;
  constructor(private readonly opts: GrantCacheOptions = {}) {
    this.file = opts.file ?? defaultGrantsFile();
  }

  /** Project-scope grant subjects; re-read only when mtime/size changed. */
  get(): readonly string[] {
    const stat = this.opts.statSync ?? ((p: string) => fs.statSync(p));
    let st: { mtimeMs: number; size: number; ino?: number; ctimeMs?: number };
    try {
      st = stat(this.file);
    } catch {
      this.sig = "";
      this.subjects = [];
      return this.subjects;
    }
    // mtime+size alone can repeat across an atomic same-size rewrite on a coarse
    // clock; the store replaces the file by rename, which changes ino/ctime.
    const sig = `${st.mtimeMs}:${st.size}:${st.ino ?? 0}:${st.ctimeMs ?? 0}`;
    if (sig === this.sig) return this.subjects;
    this.sig = sig;
    this.subjects = this.parse();
    return this.subjects;
  }

  private parse(): string[] {
    try {
      const raw = (this.opts.readFileSync ?? ((p: string) => fs.readFileSync(p, "utf8")))(this.file);
      const json = JSON.parse(raw) as unknown;
      // Store shape: { version: 1, grants: AccessGrant[] }. Unknown version → empty.
      const store = json as { version?: unknown; grants?: unknown };
      if (!store || store.version !== 1 || !Array.isArray(store.grants)) return [];
      const list: unknown[] = store.grants;
      const out: string[] = [];
      for (const g of list) {
        if (!g || typeof g !== "object") continue;
        const { subject, scope } = g as { subject?: unknown; scope?: unknown };
        if (typeof subject === "string" && subject && (scope === undefined || scope === "project")) out.push(subject);
      }
      return out;
    } catch {
      return [];
    }
  }
}
