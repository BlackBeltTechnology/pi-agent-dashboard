/**
 * The ONE write path of the automatic setup's capture: the captured Desktop client goes through the same
 * validation as an uploaded organisation client (`validateClientJson`), and is added as a new organisation
 * client labelled with the project id — or, when a client with the same Google client id exists, that
 * client's secret/project is updated (label and domains kept) and its owner account refreshed.
 * Never returns or logs the secret. See change: add-google-connect (moved from add-gmail-auto-setup).
 */
import { validateClientJson } from "../../shared/client-json.js";
import { type GoogleStore, type OwnClient, StoreError } from "../store.js";

export type StoreCapturedResult = { ok: true; client: OwnClient; created: boolean } | { ok: false; error: string };

export async function storeCapturedClient(
  store: GoogleStore,
  json: unknown,
  meta: { projectId: string; ownerAccount: string },
  logger: { info(m: string): void },
): Promise<StoreCapturedResult> {
  const parsed = validateClientJson(json as Parameters<typeof validateClientJson>[0]);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  try {
    const { client, created } = await store.upsertClient(parsed.client, { label: meta.projectId, ownerAccount: meta.ownerAccount });
    const stored = !created && client.ownerAccount !== meta.ownerAccount ? await store.patchClient(client.id, { ownerAccount: meta.ownerAccount }) : client;
    logger.info(`[google] client ${created ? "added" : "updated"} type=${stored.type}`);
    return { ok: true, client: stored, created };
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    return { ok: false, error: err instanceof StoreError || (typeof code === "string" && /^[a-z_]{1,64}$/.test(code)) ? (code as string) : "store_failed" };
  }
}
