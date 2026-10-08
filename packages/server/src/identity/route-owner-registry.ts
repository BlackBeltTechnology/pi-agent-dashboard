/**
 * Route → owning plugin attribution (openspec add-multi-user-identity-plane,
 * D24; task 18.28). Lets the identity road gate namespace a plugin-registered
 * `/api/*` route as `plugin:<id>:<verb>` without core naming any plugin.
 *
 * The loader activates plugin server entries SEQUENTIALLY and awaits each one
 * (`loadServerEntries`), so the host brackets each activation with
 * `begin(id)` / `end()` and a Fastify `onRoute` hook `record`s every route
 * registered in between. A route registered outside any bracket stays
 * unattributed (core, or a late registration ⇒ classified by path, else
 * unclassified ⇒ fail-closed under a policy).
 */

export interface RouteOwnerRegistry {
  /** Start attributing newly registered routes to `pluginId`. */
  begin(pluginId: string): void;
  /** Stop attributing (between / after plugin activations). */
  end(): void;
  /** `onRoute` sink: attribute `url` to the active plugin, if any. */
  record(url: string): void;
  /** Owning plugin of a route pattern, or undefined (core / unattributed). */
  ownerOf(url: string): string | undefined;
}

export function createRouteOwnerRegistry(): RouteOwnerRegistry {
  const owners = new Map<string, string>();
  let active: string | undefined;
  return {
    begin(pluginId) {
      active = pluginId;
    },
    end() {
      active = undefined;
    },
    record(url) {
      if (active !== undefined) owners.set(url, active);
    },
    ownerOf(url) {
      return owners.get(url);
    },
  };
}

let singleton: RouteOwnerRegistry | undefined;
/** Process-wide registry (one Fastify instance per server process). */
export function getRouteOwnerRegistry(): RouteOwnerRegistry {
  singleton ??= createRouteOwnerRegistry();
  return singleton;
}
