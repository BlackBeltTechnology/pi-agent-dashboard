/**
 * Standalone session discovery — lists pi sessions for a given cwd
 * without requiring @earendil-works/pi-coding-agent.
 * Reads session JSONL files from ~/.pi/agent/sessions/<encoded-cwd>/.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { resolvePiSessionsDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { condenseForFirstMessage } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";

export interface DiscoveredSession {
  id: string;
  cwd: string;
  name?: string;
  startedAt: number;
  modifiedAt: number;
  firstMessage?: string;
  sessionFile: string;
  sessionDir: string;
}

/** Encode cwd to the safe directory name pi uses */
function encodeCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function getSessionsDir(): string {
  return resolvePiSessionsDir({ piSessionsDir: loadConfig().piSessionsDir });
}

/** Read the header and first user message from a JSONL session file */
function readSessionHeader(filePath: string): {
  id: string;
  cwd: string;
  name?: string;
  firstMessage?: string;
  timestamp: string;
} | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    let header: any = null;
    let name: string | undefined;
    let firstMessage: string | undefined;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "session" && entry.id) {
          header = entry;
        }
        if (entry.type === "session_info" && entry.name) {
          name = entry.name;
        }
        // Find first user message. Skill invocations are stored as a
        // `<skill name=...>...</skill>\n\nargs` envelope (~264 chars for typical
        // absolute paths) which is longer than the 200-char firstMessage budget,
        // so a naive .slice(0, 200) cuts the wrapper in half. condenseForFirstMessage
        // returns the condensed slash form (`/skill:name args`) when the input
        // matches the envelope, falling back to the raw slice otherwise.
        // See change: render-skill-invocations-collapsibly.
        if (!firstMessage && entry.type === "message" && entry.message?.role === "user") {
          const msg = entry.message;
          if (typeof msg.content === "string") {
            firstMessage = condenseForFirstMessage(msg.content, 200);
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === "text" && part.text) {
                firstMessage = condenseForFirstMessage(part.text, 200);
                break;
              }
            }
          }
        }
        // Stop scanning after finding what we need (optimization for large files)
        if (header && firstMessage) break;
      } catch {
        // Skip malformed lines
      }
    }

    if (!header) return null;
    return {
      id: header.id,
      cwd: header.cwd ?? "",
      name,
      firstMessage,
      timestamp: header.timestamp ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Discover all sessions for a given cwd by reading JSONL files from disk.
 * Returns sessions sorted by modified time (newest first).
 */
export function discoverSessionsForCwd(cwd: string): DiscoveredSession[] {
  const sessionsDir = getSessionsDir();
  const encoded = encodeCwd(cwd);
  const dir = join(sessionsDir, encoded);

  if (!existsSync(dir)) return [];

  const sessions: DiscoveredSession[] = [];

  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));

    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const stat = statSync(filePath);
        const header = readSessionHeader(filePath);
        if (!header) continue;

        sessions.push({
          id: header.id,
          cwd: header.cwd || cwd,
          name: header.name,
          startedAt: new Date(header.timestamp).getTime(),
          modifiedAt: stat.mtimeMs,
          firstMessage: header.firstMessage,
          sessionFile: filePath,
          sessionDir: dir,
        });
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    return [];
  }

  // Sort by modified time, newest first
  sessions.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return sessions;
}
