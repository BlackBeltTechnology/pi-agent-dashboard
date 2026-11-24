/**
 * Wire types the Google accounts client reads from `GET /api/plugins/google/state` and the account/client
 * routes (mirrors `server/store.ts` summaries and `server/routes.ts`; no server import). See change: add-google-connect.
 */
import type { AutoSetupState } from "../shared/auto-setup.js";
import type { ClientType } from "../shared/client-json.js";
import type { Product, ProductSelection } from "../shared/products.js";

export type ClientRef = "builtin" | "builtin-remote" | `own:${string}`;

export interface AccountSummary {
  sub: string;
  email: string;
  alias?: string;
  client: ClientRef;
  status: "ok" | "reauth_required";
  testingHint?: boolean;
  products: Partial<Record<Product, ProductSelection>>;
  /** Products the last consent asked for but Google did not grant (`scope_missing`). */
  missing?: Product[];
  addedAt: number;
}

export interface ClientSummary {
  id: string;
  ref: ClientRef;
  label: string;
  type: ClientType;
  clientId: string;
  projectId?: string;
  ownerAccount?: string;
  domains: string[];
  accounts: number;
}

export interface GoogleState {
  browser: "local" | "remote";
  /** `clientId` is the built-in app's public Google client id (shown for a Workspace block). */
  builtin: { available: true; ref: "builtin" | "builtin-remote"; clientId?: string } | { available: false };
  clients: ClientSummary[];
  accounts: AccountSummary[];
  autoSetup?: AutoSetupState;
  disclosure: { version: number; accepted: boolean };
  webRedirectUri?: string;
}

/** A refused REST call: `code` = body `error`, `detail` = body `message`, plus the raw body for extras. */
export interface ApiError extends Error {
  code?: string;
  status?: number;
  detail?: string;
  body?: Record<string, unknown>;
}
