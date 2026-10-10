/**
 * Client fetch helpers for the passkey user directory (`/api/users*`).
 * See change: add-passkey-user-auth.
 */
import { getApiBase } from "../api/api-context.js";
import { fetchJson } from "../api/fetch-json.js";
import type { Tier } from "../pairing/paired-devices-api.js";

type UserStatus = "invited" | "active" | "revoked";
export type UnstableReason = "invalid_origin" | "not_https" | "ip_or_localhost" | "no_public_origin" | "ephemeral_tunnel";

interface UserCredentialView {
  rpId: string;
  createdAt?: number;
  lastUsedAt?: number;
  /** Bound to another RP ID than the current primary — not usable now. */
  orphaned: boolean;
}

interface UserInviteView {
  id: string;
  createdAt: number;
  expiresAt: number;
  uses: number;
  maxUses: number;
}

export interface DirectoryUserView {
  id: string;
  name: string;
  tier: Tier;
  status: UserStatus;
  createdAt: number;
  credentials: UserCredentialView[];
  invites: UserInviteView[];
}

export interface UsersState {
  enabled: boolean;
  rp: { rpId: string; rpOrigin: string; stable: boolean; reason?: UnstableReason };
  bootstrapRequired: boolean;
  users: DirectoryUserView[];
}

export interface MintedInvite {
  inviteId: string;
  url: string;
  qrDataUrl: string;
  expiresAt: number;
  maxUses: number;
}

export interface CredentialImpact {
  currentRpId: string;
  nextRpId: string;
  orphaned: number;
  users: number;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchJson(`${getApiBase()}${path}`, init);
  if (!res.success) throw new Error(res.error ?? "request failed");
  return res.data as T;
}

export const listUsers = () => call<UsersState>("/api/users");
export const createUser = (name: string, tier: Tier) => call<DirectoryUserView>("/api/users", json("POST", { name, tier }));
export const setUserTier = (id: string, tier: Tier) =>
  call<DirectoryUserView>(`/api/users/${encodeURIComponent(id)}`, json("PATCH", { tier }));
export const revokeUser = (id: string) => call<DirectoryUserView>(`/api/users/${encodeURIComponent(id)}/revoke`, json("POST", {}));
export const mintInvite = (id: string, opts: { ttlHours?: number; maxUses?: number } = {}) =>
  call<MintedInvite>(`/api/users/${encodeURIComponent(id)}/invites`, json("POST", opts));

/** Orphan impact of moving the primary to `url` (D3). */
export const credentialImpact = (url: string) =>
  call<CredentialImpact>(`/api/users/credentials/impact?url=${encodeURIComponent(url)}`);
