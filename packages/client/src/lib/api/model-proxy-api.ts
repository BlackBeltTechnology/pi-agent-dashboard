/**
 * Client-side fetch helpers for model proxy API key management.
 *
 * See change: add-dashboard-model-proxy.
 */
import { getApiBase } from "./api-context.js";

export interface ProxyApiKeyEntry {
  id: string;
  label: string;
  createdBy?: string;
  scopes: string[];
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  revokedAt?: number;
  hash: string;
}

export interface ApiKeysListResult {
  keys: ProxyApiKeyEntry[];
  revoked: ProxyApiKeyEntry[];
}

export interface CreateApiKeyResult {
  id: string;
  label: string;
  createdBy?: string;
  scopes: string[];
  createdAt: number;
  expiresAt?: number;
  key: string; // cleartext, revealed ONCE
}

export async function listApiKeys(): Promise<ApiKeysListResult> {
  const res = await fetch(`${getApiBase()}/api/model-proxy/api-keys`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`listApiKeys failed: ${res.status}`);
  const json = await res.json();
  return json.data;
}

export async function createApiKey(opts: {
  label: string;
  scopes?: string[];
  expiresAt?: number;
}): Promise<CreateApiKeyResult> {
  const res = await fetch(`${getApiBase()}/api/model-proxy/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`createApiKey failed: ${res.status}`);
  const json = await res.json();
  return json.data;
}

export async function revokeApiKey(id: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/model-proxy/api-keys/${id}/revoke`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`revokeApiKey failed: ${res.status}`);
}

export async function deleteApiKey(id: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/model-proxy/api-keys/${id}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`deleteApiKey failed: ${res.status}`);
}

export async function refreshRegistry(): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/model-proxy/refresh`, {
    method: "POST",
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`refreshRegistry failed: ${res.status}`);
}
