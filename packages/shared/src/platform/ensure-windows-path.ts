/**
 * ensureWindowsSystemPath — restore canonical Windows system directories
 * on `env.PATH` when they're absent.
 *
 * Electron / GUI-launched processes can inherit a stripped PATH that
 * lacks `C:\Windows\System32`. Without System32 on PATH, every spawn
 * of `where.exe`, `powershell.exe`, `tasklist.exe`, `taskkill.exe`,
 * `wmic.exe` fails with ENOENT and cascades into Tools-panel red rows,
 * empty process-scanner output, and broken bridge spawns.
 *
 * This helper is idempotent: calling it twice on the same env returns
 * an env identical to a single call. On non-Windows hosts it is a
 * no-op.
 *
 * See change: fix-windows-path-system32-missing.
 */
import { existsSync } from "node:fs";
import path from "node:path";

export interface EnsureWindowsSystemPathOpts {
  /** Override `process.platform` for tests. */
  platform?: NodeJS.Platform;
  /** Override `fs.existsSync` for tests. */
  exists?: (p: string) => boolean;
}

/**
 * Prepend canonical Windows system directories to `env.PATH` when:
 *   - the host is Windows (or `opts.platform === "win32"`),
 *   - the directory physically exists on disk (via `opts.exists`),
 *   - the directory is not already substring-present in PATH
 *     (case-insensitive — Windows PATH semantics).
 *
 * Returns the input env unchanged on non-Windows hosts (no-op).
 *
 * Idempotence invariant:
 *   ensureWindowsSystemPath(ensureWindowsSystemPath(env)) deep-equals
 *   ensureWindowsSystemPath(env).
 */
export function ensureWindowsSystemPath(
  env: NodeJS.ProcessEnv,
  opts: EnsureWindowsSystemPathOpts = {},
): NodeJS.ProcessEnv {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") return env;

  const exists = opts.exists ?? existsSync;

  const systemRoot = env.SYSTEMROOT || env.SystemRoot || env.systemroot || "C:\\Windows";
  const localAppData = env.LOCALAPPDATA || env.LocalAppData || env.localappdata || "";

  // Use win32 path semantics regardless of host OS — these paths only
  // matter on Windows, and tests on POSIX hosts must still produce
  // backslash-separated candidates.
  const join = path.win32.join;

  const candidates: string[] = [
    join(systemRoot, "System32"),
    systemRoot,
    join(systemRoot, "System32", "Wbem"),
    join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
    join(systemRoot, "System32", "OpenSSH"),
  ];
  if (localAppData) {
    candidates.push(join(localAppData, "Microsoft", "WindowsApps"));
  }

  const currentPath = env.PATH ?? "";
  const currentLower = currentPath.toLowerCase();

  // Track lower-cased additions so duplicates within the candidate
  // list itself don't slip through (defensive — current list has none).
  const addedLower = new Set<string>();
  const toAdd: string[] = [];
  for (const dir of candidates) {
    if (!exists(dir)) continue;
    const dirLower = dir.toLowerCase();
    if (currentLower.includes(dirLower)) continue;
    if (addedLower.has(dirLower)) continue;
    addedLower.add(dirLower);
    toAdd.push(dir);
  }

  if (toAdd.length === 0) return env;

  // Windows PATH delimiter is `;`. Hard-code it: host may be POSIX
  // during tests (`path.delimiter === ":"`) but we're building a
  // Windows-targeted PATH.
  const DELIM = ";";
  const newPath = currentPath
    ? `${toAdd.join(DELIM)}${DELIM}${currentPath}`
    : toAdd.join(DELIM);

  return { ...env, PATH: newPath };
}
