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
import { measureBytes, DEFAULT_MAX_EVENT_DATA_SIZE } from "../persistence/memory-event-store.js";

/**
 * Default byte budget for a captured inline-terminal transcript: 75 % of the
 * event-store's default data ceiling, leaving ample envelope headroom so the
 * close event can never trip the store's size clamp (which would destroy the
 * `terminalId` the client reducer keys on). Overridable per manager.
 * See change: preserve-inline-terminal-transcript.
 */
export const DEFAULT_TRANSCRIPT_CAP_BYTES = Math.floor(DEFAULT_MAX_EVENT_DATA_SIZE * 0.75);

/**
 * Derive the transcript byte budget from the event-store ceiling (75 %) and
 * assert both truncation knobs are safe. Throws (fail-loud at boot) when the
 * derived cap is not strictly below the ceiling, or when a nonzero per-field
 * cap could, at worst-case 6× serialized expansion (`ESC` → `\u001b`), push a
 * capped transcript back over the ceiling. `maxEventDataSize = 0` (size pass
 * disabled) falls back to the default ceiling, never a 0 budget.
 * See change: preserve-inline-terminal-transcript (D2a/D2b).
 */
export function deriveTranscriptCapBytes(maxEventDataSize: number, maxStringFieldSize: number): number {
  const ceiling = maxEventDataSize || DEFAULT_MAX_EVENT_DATA_SIZE;
  const cap = Math.floor(ceiling * 0.75);
  if (cap >= ceiling) {
    throw new Error(`[config] derived transcript cap (${cap} B) must be below the event-data ceiling (${ceiling} B)`);
  }
  if (maxStringFieldSize !== 0 && maxStringFieldSize * 6 >= ceiling) {
    throw new Error(
      `[config] maxStringFieldSize (${maxStringFieldSize}) × 6 worst-case serialized bytes must be below the event-data ceiling (${ceiling} B); inline terminal close events would lose their terminalId`,
    );
  }
  return cap;
}

/** Bounded count of dead ephemeral transcript tombstones retained at once. */
const TOMBSTONE_CAP = 64;
/** How long a close-release suppression flag lives (ms), swept lazily. */
const RELEASED_TTL_MS = 60_000;

/**
 * Cap a transcript to `capBytes` measured in serialized JSON bytes (the SAME
 * unit the event store enforces), keeping the tail. A code-unit cap would
 * diverge badly on CJK/emoji/ANSI content and still trip the store's byte
 * ceiling. When over budget, binary-search the largest tail slice such that
 * `MARKER + tail` still serializes within budget — the marker is counted
 * INSIDE the budget. See change: preserve-inline-terminal-transcript (D2).
 */
export function capTranscript(s: string, capBytes: number): string {
  if (measureBytes(s, capBytes) <= capBytes) return s;
  let lo = 0;
  let hi = s.length;
  let best = "";
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tail = s.slice(s.length - mid);
    const hidden = s.length - mid;
    const candidate = `…[${hidden} chars hidden]…\n${tail}`;
    if (measureBytes(candidate, capBytes) <= capBytes) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

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
  /** True once the user has sent any input keystroke to this PTY. */
  sawInput: boolean;
}

/** Retained transcript of a dead ephemeral terminal. */
export interface TranscriptTombstone {
  transcript: string;
  sawInput: boolean;
}

export interface TerminalManagerOptions {
  onExit?: (terminalId: string) => void;
  bufferSize?: number;
  /** Byte budget for captured transcripts. See change: preserve-inline-terminal-transcript. */
  transcriptCapBytes?: number;
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
  /**
   * Capped transcript + input flag for an inline terminal, from the live entry
   * if still alive, else from a retained tombstone, else `undefined` when the
   * manager has no knowledge of the id. See change: preserve-inline-terminal-transcript.
   */
  getTerminalRecord(id: string): TranscriptTombstone | undefined;
  /**
   * Mark a terminal's transcript released (card closed). Sticky suppression:
   * a later PTY exit path must never re-create a tombstone for a closed card.
   * See change: preserve-inline-terminal-transcript (D1b).
   */
  releaseTranscript(id: string): void;
  /** True while a release suppression flag is still in force for `id`. */
  isReleased(id: string): boolean;
}

function generateId(): string {
  return "term-" + randomBytes(8).toString("hex");
}

export function createTerminalManager(options?: TerminalManagerOptions): TerminalManager {
  // Fix node-pty spawn-helper permissions at runtime (defense in depth)
  fixPtyPermissions();

  const entries = new Map<string, TerminalEntry>();
  const bufferSize = options?.bufferSize ?? DEFAULT_BUFFER_SIZE;
  const transcriptCapBytes = options?.transcriptCapBytes ?? DEFAULT_TRANSCRIPT_CAP_BYTES;
  // Retained transcripts of dead ephemeral terminals (insertion-ordered).
  const transcripts = new Map<string, TranscriptTombstone>();
  // Sticky close-release suppression flags: id -> timestamp (ms). Bounded by
  // time (TTL), never by count, so eviction can never defeat stickiness.
  const released = new Map<string, number>();

  function sweepReleased(): void {
    if (released.size === 0) return;
    const cutoff = Date.now() - RELEASED_TTL_MS;
    for (const [id, ts] of released) {
      if (ts <= cutoff) released.delete(id);
    }
  }

  // Write a tombstone for a dead ephemeral terminal, unless its card was
  // already released. Never clears `released` — both exit paths may run.
  function writeTombstone(id: string, entry: TerminalEntry): void {
    sweepReleased();
    if (!entry.session.ephemeral || released.has(id)) return;
    transcripts.set(id, {
      transcript: capTranscript(entry.buffer.contents().toString("utf8"), transcriptCapBytes),
      sawInput: entry.sawInput,
    });
    while (transcripts.size > TOMBSTONE_CAP) {
      const oldest = transcripts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      transcripts.delete(oldest);
    }
  }

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

    const entry: TerminalEntry = { session, pty: p, buffer, clients, sawInput: false };
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
      writeTombstone(id, entry);
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
        entry.sawInput = true;
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
            entry.sawInput = true;
            entry.pty.write(str);
          }
        } catch {
          // Not JSON — treat as terminal input (AttachAddon sends text frames)
          entry.sawInput = true;
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
      writeTombstone(id, stale);
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
    if (entry) return entry.buffer.contents().toString("utf8");
    return transcripts.get(id)?.transcript ?? "";
  }

  function getTerminalRecord(id: string): TranscriptTombstone | undefined {
    const entry = entries.get(id);
    if (entry) {
      return {
        transcript: capTranscript(entry.buffer.contents().toString("utf8"), transcriptCapBytes),
        sawInput: entry.sawInput,
      };
    }
    return transcripts.get(id);
  }

  function releaseTranscript(id: string): void {
    sweepReleased();
    released.set(id, Date.now());
    transcripts.delete(id);
  }

  function isReleased(id: string): boolean {
    sweepReleased();
    return released.has(id);
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

  return { spawn, attach, detach, kill, get, list, updateTitle, getTranscript, getTerminalRecord, releaseTranscript, isReleased };
}
