/**
 * pi session JSONL → ordered event model (design M3).
 * A tool result links to its call by `toolCallId`; its text is the join of
 * `content[].text`. Events order by embedded ISO timestamp, ties broken by
 * file name, then line number.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { sha256, toUtcIso } from "./util.js";

export interface BaseEv {
  ts: string; // UTC ISO
  ms: number;
  session: string;
  file: string;
  line: number;
}
export interface UserEv extends BaseEv {
  kind: "user";
  text: string;
}
export interface CallEv extends BaseEv {
  kind: "call";
  tool: string;
  id: string;
  args: Record<string, unknown>;
}
export interface ResEv extends BaseEv {
  kind: "res";
  tool: string;
  id: string;
  text: string;
  isError: boolean;
}
export type Ev = UserEv | CallEv | ResEv;

export interface SessionFile {
  file: string; // file name (no dir)
  sha256: string;
}

export interface ParsedSessions {
  /** Session ids ordered by first embedded timestamp (ties: file name). */
  sessions: string[];
  /** Events per session in order. */
  bySession: Map<string, Ev[]>;
  files: SessionFile[];
}

const UUID_IN_NAME = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const c of content) {
    if (c && typeof c === "object" && (c as { type?: string }).type === "text" && typeof (c as { text?: unknown }).text === "string") {
      parts.push((c as { text: string }).text);
    }
  }
  return parts.join("");
}

/** Parse one session file's text into events (unsorted). */
export function parseSessionText(file: string, raw: string): { session: string; events: Ev[] } {
  let session = file.match(UUID_IN_NAME)?.[1] ?? basename(file, ".jsonl");
  const events: Ev[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    let d: any;
    try {
      d = JSON.parse(l);
    } catch {
      continue;
    }
    if (d?.type === "session" && typeof d.id === "string") {
      session = d.id;
      continue;
    }
    if (d?.type !== "message" || !d.message) continue;
    const iso = toUtcIso(d.timestamp);
    if (!iso) continue;
    const base = { ts: iso, ms: Date.parse(iso), session, file, line: i + 1 };
    const m = d.message;
    if (m.role === "user") {
      events.push({ ...base, kind: "user", text: textOf(m.content) });
    } else if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c?.type === "toolCall" && typeof c.id === "string") {
          events.push({ ...base, kind: "call", tool: String(c.name ?? ""), id: c.id, args: (c.arguments ?? {}) as Record<string, unknown> });
        }
      }
    } else if (m.role === "toolResult" && typeof m.toolCallId === "string") {
      events.push({ ...base, kind: "res", tool: String(m.toolName ?? ""), id: m.toolCallId, text: textOf(m.content), isError: m.isError === true });
    }
  }
  // The session id is only known after the header; back-fill events parsed before it.
  for (const e of events) e.session = session;
  return { session, events };
}

export function listSessionFiles(dirs: string[]): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      if (!statSync(dir).isDirectory()) continue;
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) if (n.endsWith(".jsonl")) out.push(join(dir, n));
  }
  return out.sort();
}

export function parseSessionFiles(paths: string[]): ParsedSessions {
  const all: Ev[] = [];
  const files: SessionFile[] = [];
  for (const p of paths) {
    const raw = readFileSync(p, "utf8");
    files.push({ file: basename(p), sha256: sha256(raw) });
    all.push(...parseSessionText(basename(p), raw).events);
  }
  all.sort((a, b) => a.ms - b.ms || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line);
  const bySession = new Map<string, Ev[]>();
  const firstMs = new Map<string, { ms: number; file: string }>();
  for (const e of all) {
    let list = bySession.get(e.session);
    if (!list) {
      list = [];
      bySession.set(e.session, list);
      firstMs.set(e.session, { ms: e.ms, file: e.file });
    }
    list.push(e);
  }
  const sessions = [...bySession.keys()].sort((a, b) => {
    const fa = firstMs.get(a)!;
    const fb = firstMs.get(b)!;
    return fa.ms - fb.ms || (fa.file < fb.file ? -1 : fa.file > fb.file ? 1 : 0);
  });
  return { sessions, bySession, files };
}
