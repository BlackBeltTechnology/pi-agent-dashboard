/**
 * On-disk layout of the service layer, all under `~/.pi/dashboard/`:
 *   services.json            user-owned definitions (0600)
 *   services-secrets.json    secret store (0600)
 *   services-run/<id>/       per-service run dir (0700): instance.json,
 *                            prefetched.json, pinned, tunnel.json, lifecycle.lock,
 *                            secrets/<name> (0600 mounted files)
 *   services-run/.docker-config/  empty DOCKER_CONFIG for every runtime call
 * The run dir lives under `~/`, never `/tmp`: a podman machine does not mount
 * `/tmp`. See change: add-service-registry-core (D4, D8).
 */
import fs from "node:fs";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

export interface ServicesPaths {
  root: string;
  definitions: string;
  secrets: string;
  runRoot: string;
  runDir(id: string): string;
  secretsDir(id: string): string;
  instanceFile(id: string): string;
  prefetchMarker(id: string): string;
  pinMarker(id: string): string;
  tunnelFile(id: string): string;
  lockTarget(id: string): string;
  emptyDockerConfig: string;
}

export function servicesPaths(root = getDashboardConfigDir()): ServicesPaths {
  const runRoot = path.join(root, "services-run");
  const runDir = (id: string) => path.join(runRoot, id);
  return {
    root,
    definitions: path.join(root, "services.json"),
    secrets: path.join(root, "services-secrets.json"),
    runRoot,
    runDir,
    secretsDir: (id) => path.join(runDir(id), "secrets"),
    instanceFile: (id) => path.join(runDir(id), "instance.json"),
    prefetchMarker: (id) => path.join(runDir(id), "prefetched.json"),
    pinMarker: (id) => path.join(runDir(id), "pinned"),
    tunnelFile: (id) => path.join(runDir(id), "tunnel.json"),
    lockTarget: (id) => path.join(runDir(id), "lifecycle"),
    emptyDockerConfig: path.join(runRoot, ".docker-config"),
  };
}

/** mkdir -p with mode 0700 on every created level, and re-assert 0700 on the leaf. */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

/** Atomic small-file write (tmp + rename) at mode 0600. */
export function writePrivateFile(file: string, content: string): void {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

export function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}
