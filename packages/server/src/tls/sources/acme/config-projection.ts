/**
 * `GET /api/config` projection: `solver.configured` on each acme source, derived
 * from the vault listing (names only — no value is ever read).
 *
 * See change: add-acme-dns01-certs (design D5).
 */
import { getAcmeRuntime } from "./runtime.js";

type Json = Record<string, unknown>;

/** Returns `data` with `tls.sources[].solver.configured` filled in (a copy; the input is untouched). */
export async function projectAcmeConfigured<T extends { tls?: unknown }>(data: T): Promise<T> {
  const tls = data.tls as { sources?: unknown } | undefined;
  if (!tls || !Array.isArray(tls.sources)) return data;
  if (!tls.sources.some((e) => !!e && typeof e === "object" && (e as Json).type === "acme")) return data;
  const credentials = getAcmeRuntime().credentials;
  const sources = await Promise.all(
    tls.sources.map(async (e: unknown) => {
      if (!e || typeof e !== "object" || (e as Json).type !== "acme") return e;
      const entry = e as Json;
      const solver = entry.solver && typeof entry.solver === "object" ? (entry.solver as Json) : null;
      if (!solver || typeof entry.id !== "string" || (solver.type !== "cloudflare" && solver.type !== "acme-dns")) return e;
      let configured = false;
      try {
        configured = credentials.vaultState() === "ok" && (await credentials.isConfigured(entry.id, solver.type));
      } catch {
        configured = false;
      }
      return { ...entry, solver: { ...solver, configured } };
    }),
  );
  return { ...data, tls: { ...tls, sources } };
}

