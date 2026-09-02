/**
 * Folder-scope contribution axis.
 *
 * `folderScopeBases()` derives folder scopes only from live session cwds, so a
 * repo with an enabled `automation.yaml` but no live session is never scanned,
 * armed, reaped, or watched. This axis lets a plugin/host publish a folder
 * scope via `ctx.provide("automation.folderscope.<id>", { base })`; the bases
 * are unioned into `folderScopeBases()` so downstream scan/arm/reap/watch need
 * no change.
 *
 * Mirrors `collectActionRegistry` (`action-registry.ts`): collected on every
 * scope read via `ctx.consumeAll`, so collection is load-order independent. The
 * axis is an execution-arming surface, so a contribution value is validated at
 * the boundary (fail-open, warn-once-per-key) and a base equal to the global
 * home dir is dropped (the `global` scope owns it).
 *
 * See change: add-automation-folder-scope-contribution.
 */
import path from "node:path";

/** Prefix under which folder-scope contributions are published for collection. */
export const FOLDER_SCOPE_CONTRIBUTION_PREFIX = "automation.folderscope.";

/**
 * Collect published folder-scope contributions into resolved, deduped bases.
 *
 * A contribution value is accepted ONLY when it is a PLAIN object (prototype
 * `Object.prototype` or `null` — never a `Date`/`Map`/class instance/array/null)
 * with a `base` string that is non-empty after `trim()` and ABSOLUTE (the spec
 * requires an absolute repo root; a relative base would resolve against the
 * server's `process.cwd()` and arm an unintended directory); anything else is
 * ignored and warned once per key (`warnedKeys`
 * dedupes across the repeated per-read calls). The whole per-entry read is
 * wrapped so a hostile getter/proxy that throws on property access is isolated
 * (fail-open) and cannot abort collection of the remaining valid entries.
 * Returned bases are deduped by resolved path. A base whose resolved path equals
 * `homeDir` is dropped so it does not double-arm as both `folder` and `global`.
 */
export function collectFolderScopeBases(
  entries: Array<{ key: string; value: unknown }>,
  opts: { warn: (msg: string) => void; homeDir?: string; warnedKeys?: Set<string> },
): string[] {
  const { warn, homeDir, warnedKeys } = opts;
  const resolvedHome = typeof homeDir === "string" && homeDir.length > 0 ? path.resolve(homeDir) : undefined;
  const bases = new Set<string>();
  for (const { key, value } of entries) {
    const rejected = (reason: string): void => {
      if (warnedKeys?.has(key)) return;
      warnedKeys?.add(key);
      warn(`[folder-scope] ignored contribution "${key}": ${reason}`);
    };
    // Wrap the entire per-entry read: a proxy/getter can throw on prototype or
    // property access, and `path.resolve` can throw on some inputs. A throw for
    // one entry must not propagate out of a `listScopes()` read.
    try {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        rejected("value must be a non-null, non-array object with a { base } string");
        continue;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== null && proto !== Object.prototype) {
        rejected("value must be a plain object (no Date/Map/class instance)");
        continue;
      }
      const base = (value as { base?: unknown }).base;
      if (typeof base !== "string" || base.trim().length === 0) {
        rejected("`base` must be a non-empty string");
        continue;
      }
      const trimmed = base.trim();
      if (!path.isAbsolute(trimmed)) {
        rejected("`base` must be an absolute path (relative bases would resolve against the server cwd)");
        continue;
      }
      const resolved = path.resolve(trimmed);
      if (resolvedHome !== undefined && resolved === resolvedHome) continue;
      bases.add(resolved);
    } catch (e) {
      rejected(`rejected — read threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return [...bases];
}
