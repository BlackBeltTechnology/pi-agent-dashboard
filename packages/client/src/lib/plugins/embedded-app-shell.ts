/**
 * Client-side shell services for embedded plugin apps (`<EmbeddedApp>`): the
 * dashboard's authenticated transport + folder codec, injected into the runtime
 * through `<EmbeddedAppShellProvider>` (the runtime cannot import client code).
 *
 * `fetch` / `wsUrl` accept ONLY root-relative, scheme-free paths, so the
 * dashboard bearer never leaves the origin — deliberately stricter than
 * app-kit's standalone transport. Ticketing mirrors `useWebSocket`: mint a
 * single-use ticket only when `getApiBearer() || isDevicePaired()`.
 *
 * See change: add-plugin-app-host (D4).
 */
import {
  createReturnTargetStore,
  type EmbeddedAppShell,
  isSafeDashboardPath,
} from "@blackbelt-technology/dashboard-plugin-runtime";

export interface EmbeddedAppShellDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  getApiBearer: () => string | null;
  isDevicePaired: () => boolean;
  mintWsTicket: (scope: "browser") => Promise<string | null>;
  appendWsTicket: (wsUrl: string, ticket: string) => string;
  /** HTTP API base (`""` = same origin as the page). */
  apiBase: () => string;
  /** WS origin, e.g. `ws://host:port`. */
  wsBase: () => string;
  encodeFolder: (cwd: string) => string;
  decodeFolder: (encoded: string) => string | null;
}

export function createEmbeddedAppShell(deps: EmbeddedAppShellDeps): EmbeddedAppShell {
  return {
    fetch(path, init) {
      if (!isSafeDashboardPath(path, { allowApps: true })) {
        return Promise.reject(new TypeError(`embedded app fetch refused: not a root-relative path`));
      }
      const token = deps.getApiBearer();
      const headers = new Headers(init?.headers);
      if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
      return deps.fetch(`${deps.apiBase()}${path}`, {
        ...init,
        headers,
        credentials: init?.credentials ?? "same-origin",
      });
    },
    async wsUrl(path) {
      if (!isSafeDashboardPath(path, { allowApps: true })) return null;
      const url = `${deps.wsBase()}${path}`;
      if (!(deps.getApiBearer() || deps.isDevicePaired())) return url;
      const ticket = await deps.mintWsTicket("browser");
      return ticket ? deps.appendWsTicket(url, ticket) : url;
    },
    encodeFolder: deps.encodeFolder,
    decodeFolder: deps.decodeFolder,
    returnTarget: createReturnTargetStore(),
  };
}
