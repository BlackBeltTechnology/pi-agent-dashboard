/**
 * Re-mirror an `@role` dashboard default into pi's settings.json when the
 * role default's RESOLUTION moves (preset load, role edit), never otherwise.
 *
 * Keeps the last role-default resolution in memory: every mirror write
 * (Settings save, drift repair, re-mirror) updates it via `noteMirrorWrite`,
 * server start seeds it WITHOUT writing. So an unrelated role edit, a no-op
 * preset load or a restart never rewrites pi's file — a model the user picked
 * interactively in pi survives until the role default itself moves.
 *
 * Exposed to plugins as `host.remirrorPiDefaults` / `host.defaultModelRef`.
 * See change: default-model-follows-role (design D4, D5).
 */
import type { FsDeps } from "@blackbelt-technology/pi-dashboard-shared/pi-agent-settings-lock.js";
import { readRoleConfigFromDisk } from "@blackbelt-technology/pi-dashboard-shared/role-config-disk.js";
import { type DashboardDefaults, mirrorDefaultsToPi, type RoleReader, resolveRoleDefault } from "./pi-agent-settings.js";

export interface PiDefaultRemirrorDeps {
  readDashboardConfig: () => DashboardDefaults;
  readRoles?: RoleReader;
  fsDeps?: FsDeps;
  log?: (msg: string) => void;
}

export interface PiDefaultRemirror {
  /** Record the current resolution without writing (server start). */
  seed(): void;
  /** Record the current resolution after any mirror write (save, drift repair). */
  noteMirrorWrite(): void;
  /** Re-resolve; mirror only when the resolution differs from the recorded one. */
  remirror(): Promise<void>;
  /** The persisted `defaultModel` when it is a role ref, else `undefined`. */
  defaultModelRef(): string | undefined;
}

export function createPiDefaultRemirror(deps: PiDefaultRemirrorDeps): PiDefaultRemirror {
  const readRoles = deps.readRoles ?? (() => readRoleConfigFromDisk(deps.fsDeps?.home));
  const log = deps.log ?? ((msg: string) => console.log(msg));
  let last: string | undefined;

  /** Resolution key of the current role default; `undefined` for a concrete default. */
  const currentKey = (): string | undefined => {
    const r = resolveRoleDefault(deps.readDashboardConfig(), readRoles);
    if (!r) return undefined;
    if ("unresolved" in r) return `unresolved:@${r.role}`;
    return `${r.provider}/${r.id}:${r.level ?? ""}`;
  };

  return {
    seed() {
      last = currentKey();
    },
    noteMirrorWrite() {
      last = currentKey();
    },
    async remirror() {
      const now = currentKey();
      if (now === undefined || now === last) {
        last = now;
        return;
      }
      const ref = deps.readDashboardConfig().defaultModel;
      const r = await mirrorDefaultsToPi(deps.readDashboardConfig, ["defaultModel", "defaultThinkingLevel"], deps.fsDeps, readRoles);
      if (r.ok) {
        last = now;
        log(`[pi-settings] role default ${ref} re-mirrored → ${r.skipped ? `skipped: ${r.skipped}` : now}`);
      } else {
        log(`[pi-settings] role default ${ref} re-mirror failed: ${r.error}`);
      }
    },
    defaultModelRef() {
      const v = (deps.readDashboardConfig().defaultModel ?? "").trim();
      return v.startsWith("@") ? v : undefined;
    },
  };
}

// ── Process-wide instance (set by server.ts; routes note their mirror writes) ──

let active: PiDefaultRemirror | null = null;

export function setActivePiDefaultRemirror(r: PiDefaultRemirror | null): void {
  active = r;
}

/** Call after any successful dashboard→pi mirror. No-op before server start. */
export function notePiMirrorWrite(): void {
  active?.noteMirrorWrite();
}
