/**
 * Output capture for dashboard-started native / attached children: stdout and
 * stderr go straight to `services-run/<id>/output.log` through an inherited
 * `O_APPEND` descriptor, so the server never relays output through its event
 * loop.
 *
 * - `open(id)` truncates the file IN PLACE (same inode) and returns a fresh
 *   `O_APPEND` 0600 descriptor; the server keeps it for the cap.
 * - `enforceCap(id)`: over `OUTPUT_CAP_BYTES` → `ftruncate(fd, 0)`; by path
 *   when no descriptor is held (after a server restart) or descriptor
 *   truncation fails, and by path ONLY while the path still has the
 *   `(dev, ino)` of the start record. Never rename, copy or reopen the live
 *   file. Checks of one service never run concurrently.
 * - `tail(id, lines)` reads the last lines (the file is size-bounded).
 * See change: add-services-settings-ui (D4).
 */
import fs from "node:fs";
import { ensurePrivateDir, type ServicesPaths } from "./paths.js";

export const OUTPUT_CAP_BYTES = 1024 * 1024;
/** Most bytes `tail` reads — the file is cap-bounded, this is a defensive ceiling. */
const TAIL_READ_MAX = 8 * 1024 * 1024;

export interface FileIdentity {
  dev: number;
  ino: number;
}

type FsLike = Pick<
  typeof fs,
  "openSync" | "closeSync" | "fstatSync" | "statSync" | "ftruncateSync" | "truncateSync" | "chmodSync" | "existsSync" | "readSync" | "constants"
>;

export type CapOutcome = "none" | "within-cap" | "truncated-fd" | "truncated-path" | "untouched";

export class OutputCapture {
  private readonly fds = new Map<string, number>();
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly paths: ServicesPaths;
  private readonly io: FsLike;
  private readonly capBytes: number;

  constructor(paths: ServicesPaths, io: FsLike = fs, capBytes = OUTPUT_CAP_BYTES) {
    this.paths = paths;
    this.io = io;
    this.capBytes = capBytes;
  }

  /** Truncate in place, open `O_APPEND` 0600, hold the descriptor, return it. */
  open(id: string): number {
    this.close(id);
    ensurePrivateDir(this.paths.runDir(id));
    const file = this.paths.outputLog(id);
    // In place: the inode survives, so a stale holder of the old file never
    // diverges from `start.json`'s recorded identity.
    if (this.io.existsSync(file)) this.io.truncateSync(file, 0);
    const c = this.io.constants;
    const fd = this.io.openSync(file, c.O_WRONLY | c.O_CREAT | c.O_APPEND, 0o600);
    this.io.chmodSync(file, 0o600);
    this.fds.set(id, fd);
    return fd;
  }

  /** Stop holding the descriptor (the child keeps its own copy). */
  close(id: string): void {
    const fd = this.fds.get(id);
    if (fd === undefined) return;
    this.fds.delete(id);
    try {
      this.io.closeSync(fd);
    } catch {
      /* already closed */
    }
  }

  closeAll(): void {
    for (const id of [...this.fds.keys()]) this.close(id);
  }

  /** `(dev, ino)` of the file at its path, or null when absent. */
  identity(id: string): FileIdentity | null {
    try {
      const st = this.io.statSync(this.paths.outputLog(id));
      return { dev: st.dev, ino: st.ino };
    } catch {
      return null;
    }
  }

  /** Serialised per service; resolves with the cap outcome. */
  enforceCap(id: string, recorded?: FileIdentity | null): Promise<CapOutcome> {
    const prev = this.chains.get(id) ?? Promise.resolve();
    const next = prev.then(
      () => this.enforceNow(id, recorded ?? null),
      () => this.enforceNow(id, recorded ?? null),
    );
    // The settled tail stays in the map: one resolved promise per service id, bounded by the ids.
    this.chains.set(
      id,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private enforceNow(id: string, recorded: FileIdentity | null): CapOutcome {
    const file = this.paths.outputLog(id);
    let st: fs.Stats;
    try {
      st = this.io.statSync(file);
    } catch {
      return "none";
    }
    if (st.size <= this.capBytes) return "within-cap";
    const fd = this.fds.get(id);
    if (fd !== undefined) {
      try {
        this.io.ftruncateSync(fd, 0);
        return "truncated-fd";
      } catch {
        /* Windows may refuse on an O_APPEND handle — fall back to the path */
      }
    }
    let expected = recorded;
    if (!expected && fd !== undefined) {
      try {
        const f = this.io.fstatSync(fd);
        expected = { dev: f.dev, ino: f.ino };
      } catch {
        /* no identity */
      }
    }
    if (!expected || expected.dev !== st.dev || expected.ino !== st.ino) return "untouched";
    try {
      this.io.truncateSync(file, 0);
      return "truncated-path";
    } catch {
      return "untouched";
    }
  }

  /** The last `lines` lines of the output file, or null when it does not exist. */
  tail(id: string, lines: number): string | null {
    const file = this.paths.outputLog(id);
    let fd: number;
    try {
      fd = this.io.openSync(file, this.io.constants.O_RDONLY);
    } catch {
      return null;
    }
    try {
      const size = this.io.fstatSync(fd).size;
      const len = Math.min(size, TAIL_READ_MAX);
      const buf = Buffer.alloc(len);
      let off = 0;
      while (off < len) {
        const n = this.io.readSync(fd, buf, off, len - off, size - len + off);
        if (n <= 0) break;
        off += n;
      }
      const text = buf.subarray(0, off).toString("utf8");
      const all = text.split("\n");
      if (all.length > 0 && all[all.length - 1] === "") all.pop();
      // A window that starts mid-file may begin with a partial line.
      if (size > len && all.length > 0) all.shift();
      return all.slice(-Math.max(1, lines)).join("\n");
    } finally {
      try {
        this.io.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** The `logs` of a file-backed driver (native / attached). */
export function fileLogs(output: OutputCapture | undefined, id: string, lines: number): { ok: true; text: string } | { ok: false; reason: "no-output" } {
  const text = output?.tail(id, lines);
  return text === null || text === undefined ? { ok: false, reason: "no-output" } : { ok: true, text };
}
