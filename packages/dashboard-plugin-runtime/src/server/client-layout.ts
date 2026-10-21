/**
 * Discovery-time layout check of a manifest's prebuilt client (`clientBundle` / `clientStyles`).
 *
 * The directory containing `clientBundle` is the served asset root (`/plugin-assets`), so it must be a
 * dedicated client output dir: not the package root, not outside the package, no `server` / `bridge`
 * entry inside it (else a package shipping `dist/` for both halves would publish its server JS),
 * and `clientStyles` must lie inside it. A violation refuses the client (`no-bundle`) with a logged
 * layout error. Pure path arithmetic: no filesystem access.
 *
 * See change: decouple-plugins-from-core (task 6.1, design D10, R25).
 */
import path from "node:path";
import { isWithin } from "./confined-static.js";

export interface ClientLayout {
  /** Absolute path of the prebuilt entry module (when `clientBundle` is declared and the layout holds). */
  clientBundlePath?: string;
  /** Absolute served asset root: the directory containing the entry module. */
  clientBundleDir?: string;
  /** Absolute path of the prebuilt stylesheet (declared and inside the asset root). */
  clientStylesPath?: string;
  /** Human-readable layout violation; when set the client is refused `no-bundle`. */
  clientLayoutError?: string;
}

export interface ClientLayoutInput {
  packageDir: string;
  clientBundle?: string;
  clientStyles?: string;
  server?: string;
  bridge?: string;
}

/** Evaluate the client layout of one manifest. No `clientBundle` → `{}` (nothing to refuse). */
export function evaluateClientLayout(input: ClientLayoutInput): ClientLayout {
  const { packageDir, clientBundle } = input;
  if (clientBundle === undefined) return {};
  const root = path.resolve(packageDir);
  const clientBundlePath = path.resolve(root, clientBundle);
  const clientBundleDir = path.dirname(clientBundlePath);
  const refuse = (clientLayoutError: string): ClientLayout => ({ clientBundlePath, clientBundleDir, clientLayoutError });

  if (!isWithin(clientBundlePath, root) || clientBundlePath === root) {
    return refuse(`clientBundle "${clientBundle}" lies outside the package`);
  }
  if (clientBundleDir === root) {
    return refuse(`clientBundle "${clientBundle}" sits in the package root; the client asset root must be a dedicated directory (e.g. dist/client/)`);
  }
  for (const [field, entry] of [["server", input.server], ["bridge", input.bridge]] as const) {
    if (entry !== undefined && isWithin(path.resolve(root, entry), clientBundleDir)) {
      return refuse(`the ${field} entry "${entry}" is inside the client asset root "${path.relative(root, clientBundleDir)}"; use a dedicated client directory`);
    }
  }
  if (input.clientStyles === undefined) return { clientBundlePath, clientBundleDir };
  const clientStylesPath = path.resolve(root, input.clientStyles);
  if (!isWithin(clientStylesPath, clientBundleDir) || clientStylesPath === clientBundleDir) {
    return refuse(`clientStyles "${input.clientStyles}" lies outside the client asset root "${path.relative(root, clientBundleDir)}"`);
  }
  return { clientBundlePath, clientBundleDir, clientStylesPath };
}
