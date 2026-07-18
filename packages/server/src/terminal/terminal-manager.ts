/**
 * Server-side terminal session management with PTY lifecycle and output buffering.
 */
import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { randomBytes } from "node:crypto";
import { fixPtyPermissions } from "../fix-pty-permissions.js";
import type { TerminalSession, TerminalControlMessage } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import type { WebSocket } from "ws";

const DEFAULT_BUFFER_SIZE = 256 * 1024; // 256KB

// Delegate shell detection to the shared platform primitive. Back-compat
// wrapper preserved so callers (and tests) that import `detectShell` from
// this module continue to work. See change: consolidate-platform-handlers.
import {
  detectShell as platformDetectShell,
  getTerminalEnvHints as platformTerminalEnvHints,
} from "@blackbelt-technology/pi-dashboard-shared/platform/shell.js";
import { killProcess } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
import { augmentEnvWithGitSource } from "@blackbelt-technology/pi-dashboard-shared/platform/git-source.js";
import { whichSync } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";

/** Detect the appropriate shell for the current platform. */
export function detectShell(platform?: string): string {
  // Keep the old `platform?: string` signature; coerce to the shared primitive's opts.
  return platformDetectShell(platform ? { platform: platform as NodeJS.Platform } : undefined);
}

/** Circular buffer for PTY output replay. */
export class RingBuffer {
  private buf: Buffer;
  private capacity: number;
  private writePos = 0;
  private filled = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = Buffer.alloc(capacity);
  }

  write(data: Buffer): void {
    const len = data.length;

    if (len >= this.capacity) {
      // Data larger than buffer: keep only the last `capacity` bytes
      data.copy(this.buf, 0, len - this.capacity, len);
      this.writePos = 0;
      this.filled = this.capacity;
      return;
    }

    const spaceToEnd = this.capacity - this.writePos;
    if (len <= spaceToEnd) {
      data.copy(this.buf, this.writePos);
    } else {
      // Wrap around
      data.copy(this.buf, this.writePos, 0, spaceToEnd);
      data.copy(this.buf, 0, spaceToEnd);
    }

    this.writePos = (this.writePos + len) % this.capacity;
    this.filled = Math.min(this.filled + len, this.capacity);
  }

  contents(): Buffer {
    if (this.filled === 0) return Buffer.alloc(0);

    if (this.filled < this.capacity) {
      // Haven't wrapped yet
      return Buffer.from(this.buf.subarray(0, this.filled));
    }

    // Wrapped: readPos is at writePos (oldest data)
    const result = Buffer.alloc(this.capacity);
    const readPos = this.writePos; // oldest byte is at writePos after wrap
    const tailLen = this.capacity - readPos;
    this.buf.copy(result, 0, readPos, readPos + tailLen);
    this.buf.copy(result, tailLen, 0, readPos);
    return result;
  }
}

interface TerminalEntry {
  session: TerminalSession;
  pty: IPty;
  buffer: RingBuffer;
  clients: Set<WebSocket>;
}

export interface TerminalManagerOptions {
  onExit?: (terminalId: string) => void;
  bufferSize?: number;
}

export interface TerminalManager {
  spawn(cwd: string, opts?: { ephemeral?: boolean }): TerminalSession;
  attach(id: string, ws: WebSocket): void;
  detach(id: string, ws: WebSocket): void;
  kill(id: string): void;
  get(id: string): TerminalSession | undefined;
  list(): TerminalSession[];
  updateTitle(id: string, title: string): void;
  /**
   * Current ring-buffer contents decoded as a UTF-8 string. Used to capture
   * the final transcript of an ephemeral inline terminal at close time.
   * See change: add-inline-terminal-card.
   */
  getTranscript(id: string): string;
}

function generateId(): string {
  return "term-" + randomBytes(8).toString("hex");
}

export function createTerminalManager(options?: TerminalManagerOptions): TerminalManager {
  // Fix node-pty spawn-helper permissions at runtime (defense in depth)
  fixPtyPermissions();

  const entries = new Map<string, TerminalEntry>();
  const bufferSize = options?.bufferSize ?? DEFAULT_BUFFER_SIZE;

  function spawn(cwd: string, opts?: { ephemeral?: boolean }): TerminalSession {
    const shell = detectShell();
    const id = generateId();

    // PTY bypasses ToolResolver.buildSpawnEnv, so augment bundled git/sh
    // here too — otherwise `!`/`!!` bang-prefix commands run in the
    // terminal would miss bundled git/sh. See change: embed-git-bash-on-windows.
    const baseEnv = { ...process.env, ...platformTerminalEnvHints() } as Record<string, string>;
    const env = augmentEnvWithGitSource(baseEnv, whichSync) as Record<string, string>;

    const p = pty.spawn(shell, [], {
      cwd,
      env,
      cols: 80,
      rows: 24,
    });

    const session: TerminalSession = {
      id,
      cwd,
      shell,
      status: "active",
      createdAt: Date.now(),
      ...(opts?.ephemeral ? { ephemeral: true } : {}),
    };

    const buffer = new RingBuffer(bufferSize);
    const clients = new Set<WebSocket>();

    const entry: TerminalEntry = { session, pty: p, buffer, clients };
    entries.set(id, entry);

    p.onData((data: string) => {
      const buf = Buffer.from(data);
      buffer.write(buf);
      for (const ws of clients) {
        if (ws.readyState === ws.OPEN) {
          ws.send(buf);
        }
      }
    });

    p.onExit(() => {
      entry.session = { ...entry.session, status: "ended" };
      // Close all client WebSockets
      for (const ws of clients) {
        try { ws.close(); } catch {}
      }
      clients.clear();
      entries.delete(id);
      options?.onExit?.(id);
    });

    return session;
  }

  function attach(id: string, ws: WebSocket): void {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Terminal ${id} not found`);

    // Replay buffered output
    const replay = entry.buffer.contents();
    if (replay.length > 0) {
      ws.send(replay);
    }

    entry.clients.add(ws);

    ws.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        // Terminal input (binary frame)
        entry.pty.write(data.toString());
      } else {
        // Text frame: could be a control message or terminal input from AttachAddon
        const str = data.toString();
        try {
          const msg: TerminalControlMessage = JSON.parse(str);
          if (msg.type === "resize") {
            // Defense in depth: reject degenerate resize messages.
            // A PTY at <2 cols/rows is non-functional for every supported
            // shell binding; no legitimate user intent maps there. xterm's
            // FitAddon is supposed to guard against zero, but a transient
            // display:none container measured during a route transition
            // can leak a 1 through. See change:
            // fix-terminal-half-height-dual-mount.
            if (msg.cols < 2 || msg.rows < 2) {
              // ignore — keep previous PTY dimensions
            } else {
              entry.pty.resize(msg.cols, msg.rows);
            }
          } else if (msg.type === "title") {
            // title control message — handled elsewhere
          } else {
            // Unknown JSON, treat as terminal input
            entry.pty.write(str);
          }
        } catch {
          // Not JSON — treat as terminal input (AttachAddon sends text frames)
          entry.pty.write(str);
        }
      }
    });

    ws.on("close", () => {
      entry.clients.delete(ws);
    });
  }

  function detach(id: string, ws: WebSocket): void {
    const entry = entries.get(id);
    if (entry) {
      entry.clients.delete(ws);
    }
  }

  function kill(id: string): void {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Terminal ${id} not found`);

    // Windows: node-pty's kill(signal) uses TerminateProcess on the shell
    // handle, which (a) ignores the signal string, and (b) does not kill
    // child processes of the shell (python.exe, node.exe, etc.). Worse, its
    // onExit callback is not always fired after external kills, so the
    // terminal entry would stay in the map forever — which is exactly why
    // the X button "doesn't work" on Windows. Route through platform's
    // killProcess() so taskkill /F /T /PID does a genuine tree kill.
    //
    // POSIX: keep the SIGHUP → SIGKILL idiom — interactive shells honor
    // SIGHUP, giving them a chance to clean up tty state before we escalate.
    if (process.platform === "win32") {
      const pid = entry.pty.pid;
      if (typeof pid === "number") {
        void killProcess(pid, { timeoutMs: 2000 }).catch(() => { /* surfaced via onExit fallback below */ });
      } else {
        try { entry.pty.kill(); } catch { /* best-effort */ }
      }
    } else {
      entry.pty.kill("SIGHUP");
      const escalation = setTimeout(() => {
        if (entries.has(id)) {
          try { entry.pty.kill("SIGKILL"); } catch {}
        }
      }, 1000);
      const disposeEsc = entry.pty.onExit(() => {
        clearTimeout(escalation);
        disposeEsc.dispose();
      });
    }

    // Fallback cleanup: if node-pty's onExit doesn't fire within 3s (common
    // on Windows ConPTY after external termination), simulate it so the
    // terminal entry is removed, clients are disconnected, and the server
    // broadcasts terminal_removed. Without this, the X click never
    // completes from the user's perspective.
    const fallback = setTimeout(() => {
      const stale = entries.get(id);
      if (!stale) return; // onExit already ran
      stale.session = { ...stale.session, status: "ended" };
      for (const ws of stale.clients) {
        try { ws.close(); } catch { /* ignore */ }
      }
      stale.clients.clear();
      entries.delete(id);
      options?.onExit?.(id);
    }, 3000);
    const disposeFb = entry.pty.onExit(() => {
      clearTimeout(fallback);
      disposeFb.dispose();
    });
  }

  function get(id: string): TerminalSession | undefined {
    return entries.get(id)?.session;
  }

  function getTranscript(id: string): string {
    const entry = entries.get(id);
    if (!entry) return "";
    return entry.buffer.contents().toString("utf8");
  }

  function list(): TerminalSession[] {
    return Array.from(entries.values()).map((e) => e.session);
  }

  function updateTitle(id: string, title: string): void {
    const entry = entries.get(id);
    if (entry) {
      entry.session = { ...entry.session, title };
    }
  }

  return { spawn, attach, detach, kill, get, list, updateTitle, getTranscript };
}
