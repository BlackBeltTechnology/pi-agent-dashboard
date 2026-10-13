/**
 * REST seeding for the credential-vault e2e specs. Every call carries the
 * operator login-session cookie (`OperatorSession`): the vault management routes
 * need `operate` authority and the harness browser is never loopback.
 * Responses are checked; a failed seed fails the spec at the seed, not later.
 * See change: add-credential-vault.
 */

import type { APIRequestContext } from "@playwright/test";

/** The harness session cwd every faux git session starts in (a real repo, no remote). */
const SAMPLE_GIT_DIR = "/fixtures/sample-git";
export const SAMPLE_GIT_SUBJECT = `dir:hub:${SAMPLE_GIT_DIR}`;

export class VaultSeed {
  private readonly request: APIRequestContext;
  private readonly headers: () => Record<string, string>;

  constructor(request: APIRequestContext, headers: () => Record<string, string>) {
    this.request = request;
    this.headers = headers;
  }

  private async call<T = unknown>(method: "get" | "post" | "put" | "delete", url: string, data?: unknown): Promise<T> {
    const res = await this.request[method](url, { headers: this.headers(), ...(data === undefined ? {} : { data }) });
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string; message?: string };
    if (!res.ok() || body.success !== true) throw new Error(`${method.toUpperCase()} ${url} → ${res.status()} ${body.message ?? body.error ?? ""}`);
    return body.data as T;
  }

  async addAccount(provider: string, label: string, value: string): Promise<string> {
    return (await this.call<{ id: string }>("post", "/api/vault/accounts", { provider, label, value })).id;
  }
  async addBinding(name: string, defaultAccountId: string): Promise<void> {
    await this.call("post", "/api/vault/bindings", { name, defaultAccountId });
  }
  async grant(subject: string, bindingName: string): Promise<void> {
    await this.call("post", "/api/vault/grants", { subject, bindingName });
  }
  async ungrant(subject: string, bindingName: string): Promise<void> {
    await this.call("delete", "/api/vault/grants", { subject, bindingName });
  }

  /** Remove everything this spec could have created, tolerating what is already gone. */
  async reset(): Promise<void> {
    const res = await this.request.get("/api/vault", { headers: this.headers() });
    if (!res.ok()) return;
    const v = ((await res.json()) as { data?: { accounts: Array<{ id: string }>; bindings: Array<{ name: string }>; grants: Array<{ subject: string; bindingName: string }>; confirmations: Array<Record<string, string>>; pluginApprovals: Array<{ pluginId: string; bindingName: string }> } }).data;
    if (!v) return;
    for (const c of v.confirmations) await this.request.delete("/api/vault/confirmations", { headers: this.headers(), data: c });
    for (const a of v.pluginApprovals) await this.request.delete(`/api/vault/plugin-approvals/${a.pluginId}/${a.bindingName}`, { headers: this.headers() });
    for (const g of v.grants) await this.request.delete("/api/vault/grants", { headers: this.headers(), data: g });
    for (const b of v.bindings) await this.request.delete(`/api/vault/bindings/${b.name}`, { headers: this.headers() });
    for (const a of v.accounts) await this.request.delete(`/api/vault/accounts/${a.id}`, { headers: this.headers() });
  }
}
