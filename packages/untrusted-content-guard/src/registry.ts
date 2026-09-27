/**
 * Extension declaration registry (design D6).
 *
 * A process-wide object at `globalThis[Symbol.for("pi.untrusted-content-guard")]`,
 * created by WHOEVER TOUCHES IT FIRST — a tool-owning extension or the guard.
 * The guard reads `declarations` LIVE at every check, so load order does not
 * matter and nothing needs draining. Only extension code can push; nothing in
 * a tool input or result is ever copied here.
 *
 * Tool-owning extensions can declare without depending on this package:
 *
 *   const sym = Symbol.for("pi.untrusted-content-guard");
 *   const reg = (globalThis[sym] ??= { declarations: [] });
 *   reg.declarations.push({ kind: "untrusted", names: ["gmail_get"] });
 *   reg.declarations.push({ kind: "selfConfirming", names: ["gmail_send"] });
 */

import { matchesAny } from "./glob.js";

export const REGISTRY_SYMBOL: unique symbol = Symbol.for("pi.untrusted-content-guard");

export type DeclarationKind = "untrusted" | "selfConfirming";

export interface Declaration {
  kind: DeclarationKind;
  /** Tool names (globs allowed). */
  names: string[];
}

export interface GuardRegistry {
  declarations: Declaration[];
}

type RegistryHost = { [REGISTRY_SYMBOL]?: GuardRegistry };

/** Create or adopt the shared registry. */
export function getRegistry(host: object = globalThis): GuardRegistry {
  const h = host as RegistryHost;
  h[REGISTRY_SYMBOL] ??= { declarations: [] };
  return h[REGISTRY_SYMBOL];
}

/** Convenience for extensions that do import this package. */
export function declareTools(kind: DeclarationKind, names: string[], host: object = globalThis): void {
  getRegistry(host).declarations.push({ kind, names: [...names] });
}

/** Live check: is `toolName` declared with `kind`? Malformed entries are ignored. */
export function isDeclared(registry: GuardRegistry, kind: DeclarationKind, toolName: string): boolean {
  const list = Array.isArray(registry.declarations) ? registry.declarations : [];
  return list.some(
    (d) =>
      d?.kind === kind &&
      Array.isArray(d.names) &&
      matchesAny(
        toolName,
        d.names.filter((n): n is string => typeof n === "string"),
      ),
  );
}
