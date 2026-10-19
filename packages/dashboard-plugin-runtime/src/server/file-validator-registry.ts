/**
 * Registry of plugin file validators (`ctx.registerFileValidator`). Process
 * singleton like `ws-route-registry`; keyed by `(pluginId, claimId)`. The
 * `write-binary` route reads it at request time; the loader clears a plugin's
 * entries when it is disabled or its activation fails.
 *
 * See change: add-editor-pane-file-handlers (D4).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Options a plugin server entry passes to `ctx.registerFileValidator`. */
export interface RegisterFileValidatorOptions {
  /** One of the registering plugin's OWN `editor-pane-file-handler` edit claim ids. */
  claimId: string;
  /**
   * Package-relative path (no `..`, realpath-confined to the plugin package) of a
   * plain-JS ESM module (`.mjs`/`.js`; it runs in a worker thread, no TS loader)
   * exporting `validate(bytes: Uint8Array, ext: string) => {ok:true} | {ok:false, reason?:string}`
   * (may be async). A validator can only reject.
   */
  module: string;
  /**
   * Optional main-thread predicate evaluated before anything else for the claim;
   * `false` (or a throw) refuses saves with 403, so a plugin can switch a
   * sub-feature off without a restart.
   */
  enabled?: () => boolean;
}

export type RegisterFileValidatorFn = (opts: RegisterFileValidatorOptions) => void;

export interface FileValidatorRegistration {
  pluginId: string;
  claimId: string;
  /** `file://` URL of the realpath-confined validator module. */
  moduleUrl: string;
  enabled?: () => boolean;
}

export class FileValidatorRegistry {
  private readonly byKey = new Map<string, FileValidatorRegistration>();

  private static key(pluginId: string, claimId: string): string {
    return `${pluginId}\0${claimId}`;
  }

  set(reg: FileValidatorRegistration): void {
    this.byKey.set(FileValidatorRegistry.key(reg.pluginId, reg.claimId), reg);
  }

  get(pluginId: string, claimId: string): FileValidatorRegistration | undefined {
    return this.byKey.get(FileValidatorRegistry.key(pluginId, claimId));
  }

  unregisterPlugin(pluginId: string): void {
    for (const [k, v] of this.byKey) if (v.pluginId === pluginId) this.byKey.delete(k);
  }

  clear(): void {
    this.byKey.clear();
  }
}

let singleton: FileValidatorRegistry | null = null;
export function getFileValidatorRegistry(): FileValidatorRegistry {
  if (!singleton) singleton = new FileValidatorRegistry();
  return singleton;
}

/** Plugin identity the context was created for (from its manifest + discovery). */
export interface FileHandlerPluginInfo {
  packageDir: string;
  /** Ids of the plugin's own `editor-pane-file-handler` claims with `mode: "edit"`. */
  editClaimIds: readonly string[];
}

function isWithin(child: string, root: string): boolean {
  const rel = path.relative(root, child);
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

/**
 * Validate `opts` against the calling plugin and register. Throws when the claim
 * is not one of the plugin's own edit claims, or the module path is absolute,
 * contains `..`, is missing, or resolves (via symlink) outside the package.
 */
export function registerFileValidatorFor(
  pluginId: string,
  info: FileHandlerPluginInfo | undefined,
  opts: RegisterFileValidatorOptions,
  registry: FileValidatorRegistry = getFileValidatorRegistry(),
): void {
  const fail: (msg: string) => never = (msg) => {
    throw new Error(`[plugin:${pluginId}] registerFileValidator refused: ${msg}`);
  };
  if (!opts || typeof opts.claimId !== "string" || typeof opts.module !== "string") fail("claimId and module are required");
  if (opts.enabled !== undefined && typeof opts.enabled !== "function") fail("enabled must be a function");
  if (!info || !info.editClaimIds.includes(opts.claimId)) {
    fail(`"${opts.claimId}" is not one of this plugin's own editor-pane-file-handler edit claims`);
  }
  if (!opts.module.trim() || path.isAbsolute(opts.module) || opts.module.split(/[\\/]/).includes("..")) {
    fail(`module "${opts.module}" must be a package-relative path without ".."`);
  }
  let realRoot: string;
  let realModule: string;
  try {
    realRoot = fs.realpathSync(info.packageDir);
    realModule = fs.realpathSync(path.resolve(realRoot, opts.module));
  } catch {
    return fail(`module "${opts.module}" does not exist in the plugin package`);
  }
  if (!isWithin(realModule, realRoot)) fail(`module "${opts.module}" resolves outside the plugin package`);
  registry.set({ pluginId, claimId: opts.claimId, moduleUrl: pathToFileURL(realModule).href, enabled: opts.enabled });
}
