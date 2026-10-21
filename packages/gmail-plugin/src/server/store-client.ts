/**
 * The ONE write path for the OAuth client, shared by `PUT /client` and the
 * automatic setup's capture: same validation (`validateClientJson`) and the same
 * `client_in_use` rule. Never returns or logs the secret.
 * See change: add-gmail-auto-setup.
 */
import { validateClientJson } from "../shared/client-json.js";
import type { AccountStore, ClientRecord } from "./accounts.js";

export type StoreClientResult =
  | { ok: true; client: ClientRecord }
  | { ok: false; status: 400 | 409; error: string; step?: number };

export async function storeClient(
  store: AccountStore,
  input: unknown,
  logger: { info(m: string): void },
): Promise<StoreClientResult> {
  const result = validateClientJson(input as Parameters<typeof validateClientJson>[0]);
  if (!result.ok) return { ok: false, status: 400, error: result.error.code, step: result.error.step };
  // Refresh tokens are bound to the client that minted them: swapping the
  // client under connected accounts would break every refresh silently.
  const current = await store.getClient();
  const changed =
    current && (current.clientId !== result.client.clientId || current.clientSecret !== result.client.clientSecret);
  if (changed && (await store.list()).length > 0) return { ok: false, status: 409, error: "client_in_use", step: 5 };
  await store.setClient(result.client);
  logger.info("[gmail] oauth client configured");
  return { ok: true, client: result.client };
}
