/**
 * Per-session store for dashboard-local `/view` preview rows. Separate from
 * pi's events.jsonl so the agent NEVER observes these rows. Persisted as
 * one JSON file per session under `~/.pi/dashboard/view-messages/<sid>.json`
 * so previews survive server restarts. See change: render-file-previews.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface ViewMessage {
  id: string;
  role: "user";
  content: "";
  timestamp: number;
  view: ViewTarget;
}

const DEFAULT_DIR = path.join(os.homedir(), ".pi", "dashboard", "view-messages");

function fileFor(dir: string, sessionId: string): string {
  // sessionId is server-issued (uuid-ish); still strip dangerous chars.
  const safe = sessionId.replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(dir, `${safe}.json`);
}

export class ViewMessageStore {
  private dir: string;
  private cache = new Map<string, ViewMessage[]>();

  constructor(dir: string = DEFAULT_DIR) {
    this.dir = dir;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
    } catch {
      // Best-effort; failures surface on first write.
    }
  }

  /** Get the current view-message list for a session (loads from disk on first access). */
  get(sessionId: string): ViewMessage[] {
    const cached = this.cache.get(sessionId);
    if (cached) return cached;
    try {
      const raw = fs.readFileSync(fileFor(this.dir, sessionId), "utf-8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.cache.set(sessionId, parsed);
        return parsed;
      }
    } catch {
      // Missing file or bad JSON — start empty.
    }
    const empty: ViewMessage[] = [];
    this.cache.set(sessionId, empty);
    return empty;
  }

  /** Append a new view-message and persist. Returns the appended message. */
  append(sessionId: string, target: ViewTarget): ViewMessage {
    const list = this.get(sessionId).slice();
    const msg: ViewMessage = {
      id: `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      role: "user",
      content: "",
      timestamp: Date.now(),
      view: target,
    };
    list.push(msg);
    this.cache.set(sessionId, list);
    this.persist(sessionId).catch(() => {
      /* persistence failure non-fatal — log already noisy elsewhere */
    });
    return msg;
  }

  /** Remove all view-messages for a session (on session removal). */
  async remove(sessionId: string): Promise<void> {
    this.cache.delete(sessionId);
    try {
      await fsp.unlink(fileFor(this.dir, sessionId));
    } catch {
      // Missing is fine.
    }
  }

  private async persist(sessionId: string): Promise<void> {
    const list = this.cache.get(sessionId) ?? [];
    const f = fileFor(this.dir, sessionId);
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      await fsp.writeFile(f, JSON.stringify(list), "utf-8");
    } catch {
      /* best-effort */
    }
  }
}
