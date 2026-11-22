/**
 * Creates the askpass install: a `mkdtemp` 0700 directory holding the helper, its
 * `/bin/sh` wrapper and the unix socket the helper talks to (D10). Unique per
 * process so concurrent sessions cannot collide; ownership/mode re-checked; the
 * socket path must fit `sun_path`; a pre-existing socket is never accepted. Any
 * failed check aborts the install and removes what was created.
 *
 * See change: add-sudo-credential-prompt (D10).
 */

import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { buildHelperSource, buildWrapperSource } from "./helper-script.js";

export interface InstallDeps {
  platform: NodeJS.Platform;
  tmpdir: string;
  execPath: string;
  /** Defaults to `fs.promises.mkdtemp`; a seam so the abort paths are testable. */
  mkdtemp?: (prefix: string) => Promise<string>;
  onConnection: (socket: net.Socket) => void;
}

export type InstallFailure = "mkdtemp" | "dir-not-private" | "sun-path" | "socket-exists" | "write" | "listen";

export interface InstalledAskpass {
  dir: string;
  wrapperPath: string;
  socketPath: string;
  /** Stop listening, drop connections and remove the directory. Tolerates a directory that is already gone. */
  close(): void;
}

export type InstallResult = { ok: true; value: InstalledAskpass } | { ok: false; reason: InstallFailure };

/** Longest `sun_path` including the NUL: 104 on macOS/BSD, 108 on Linux. */
export function sunPathLimit(platform: NodeJS.Platform): number {
  return platform === "darwin" ? 104 : 108;
}

const removeDir = (dir: string): void => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* already gone or not removable: nothing more to do */
  }
};

export async function installAskpass(deps: InstallDeps): Promise<InstallResult> {
  const mkdtemp = deps.mkdtemp ?? ((prefix: string) => fs.promises.mkdtemp(prefix));
  let dir: string;
  try {
    dir = await mkdtemp(path.join(deps.tmpdir, "pi-askpass-"));
  } catch {
    return { ok: false, reason: "mkdtemp" };
  }
  const fail = (reason: InstallFailure): InstallResult => {
    removeDir(dir);
    return { ok: false, reason };
  };

  const socketPath = path.join(dir, "s");
  // The path must fit with its terminating NUL: at or above the limit is refused.
  if (Buffer.byteLength(socketPath) >= sunPathLimit(deps.platform)) return fail("sun-path");

  try {
    const st = await fs.promises.lstat(dir);
    const uid = process.getuid?.();
    if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o777) !== 0o700 || (uid !== undefined && st.uid !== uid)) {
      return fail("dir-not-private");
    }
  } catch {
    return fail("dir-not-private");
  }

  try {
    await fs.promises.lstat(socketPath);
    return fail("socket-exists");
  } catch {
    /* ENOENT is what we want */
  }

  const helperPath = path.join(dir, "h.cjs");
  const wrapperPath = path.join(dir, "askpass");
  try {
    await fs.promises.writeFile(helperPath, buildHelperSource(socketPath), { mode: 0o700, flag: "wx" });
    await fs.promises.writeFile(wrapperPath, buildWrapperSource(deps.execPath, helperPath), { mode: 0o700, flag: "wx" });
  } catch {
    return fail("write");
  }

  const server = net.createServer(deps.onConnection);
  const sockets = new Set<net.Socket>();
  server.on("connection", (s) => {
    sockets.add(s);
    s.once("close", () => sockets.delete(s));
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch {
    try {
      server.close();
    } catch {
      /* never listened */
    }
    return fail("listen");
  }
  // After startup a socket error (e.g. the dir was removed under us) must never be uncaught.
  server.on("error", () => {});
  try {
    fs.chmodSync(socketPath, 0o600);
  } catch {
    /* the 0700 directory already confines it */
  }

  let closed = false;
  return {
    ok: true,
    value: {
      dir,
      wrapperPath,
      socketPath,
      close() {
        if (closed) return;
        closed = true;
        for (const s of sockets) s.destroy();
        try {
          server.close();
        } catch {
          /* not listening */
        }
        removeDir(dir);
      },
    },
  };
}
