/**
 * Bridge-side lease client (design D5). ONE lease per tool call over the
 * private request lane — no bridge cache, so a lowered level refuses the very
 * next call. The returned `tier` is re-checked against the op (defence in
 * depth). Error codes from the server (`<code>: <detail>`) are parsed into
 * `GmailToolError`. When Google Connect owns the accounts the Gmail lanes answer
 * `{delegate:"google"}` and this client follows it to `google/lease` /
 * `google/accounts`, re-spelling refusals as the Gmail errors the tools already
 * know (add-google-connect D1/D7). See change: add-gmail-plugin.
 */
import {
  type PluginLaneReply,
  requestPluginServer,
} from "@blackbelt-technology/dashboard-plugin-runtime/bridge";
import {
  ACCOUNTS_TYPE,
  type AccountInfo,
  GOOGLE_ACCOUNTS_TYPE,
  GOOGLE_LEASE_TYPE,
  GOOGLE_PLUGIN_ID,
  isDelegateReply,
  LEASE_TYPE,
  type LeaseReply,
  PLUGIN_ID,
} from "../shared/protocol.js";
import { isFilterOp, isTier, type Op, tierAllows } from "../shared/scopes.js";

export type LaneRequest = (pluginId: string, type: string, payload?: unknown) => Promise<PluginLaneReply>;

export class GmailToolError extends Error {
  readonly code: string;

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "GmailToolError";
  }
}

function laneError(error: string): GmailToolError {
  const m = /^([a-z_]{1,64}): ([\s\S]*)$/.exec(error);
  if (m) return new GmailToolError(m[1] as string, `${m[1]}: ${m[2]}`);
  if (error === "unavailable") {
    return new GmailToolError("unavailable", "unavailable: the pi-dashboard is not connected; Gmail tools need it");
  }
  return new GmailToolError(error.slice(0, 64) || "lane_error", `Gmail lease failed: ${error.slice(0, 200)}`);
}

/** The `google/accounts` row, as far as Gmail reads it. */
interface GoogleAccount {
  sub: string;
  email: string;
  alias?: string;
  status: "ok" | "reauth_required";
  testingHint?: boolean;
  addedAt: number;
  products?: { gmail?: { level?: string; options?: { filters?: boolean } } };
}

const labelOf = (a: { email: string; alias?: string }): string => (a.alias ? `${a.alias} (${a.email})` : a.email);

/** The Google accounts that have Gmail on, as Gmail accounts (level → tier, filters option). */
function gmailAccounts(list: readonly GoogleAccount[]): AccountInfo[] {
  const out: AccountInfo[] = [];
  for (const a of list) {
    const sel = a.products?.gmail;
    if (!sel || !isTier(sel.level)) continue;
    const info: AccountInfo = { sub: a.sub, email: a.email, tier: sel.level, status: a.status, addedAt: a.addedAt };
    if (a.alias) info.alias = a.alias;
    if (a.testingHint) info.testingHint = true;
    if (sel.options?.filters) info.filters = true;
    out.push(info);
  }
  return out;
}

/** Refusal codes whose Gmail wording names the account's email (so `google/accounts` is consulted). */
const NEEDS_ACCOUNTS = new Set(["product_disabled", "level_insufficient", "reauth_required", "scope_missing", "not_found", "ambiguous"]);

export class LeaseClient {
  private readonly request: LaneRequest;

  constructor(request: LaneRequest = requestPluginServer) {
    this.request = request;
  }

  async lease(account: string, op: Op): Promise<LeaseReply> {
    const reply = await this.request(PLUGIN_ID, LEASE_TYPE, { account, op });
    if (!reply.ok) throw laneError(reply.error);
    if (isDelegateReply(reply.result)) return this.delegatedLease(account, op);
    return this.checked(reply.result, op);
  }

  async accounts(): Promise<AccountInfo[]> {
    const reply = await this.request(PLUGIN_ID, ACCOUNTS_TYPE, {});
    if (!reply.ok) throw laneError(reply.error);
    if (isDelegateReply(reply.result)) return gmailAccounts(await this.googleAccounts());
    return Array.isArray(reply.result) ? (reply.result as AccountInfo[]) : [];
  }

  /** Defence in depth: the tier the lane reports must allow the op, whichever lane answered. */
  private checked(result: unknown, op: Op): LeaseReply {
    const r = result as Partial<LeaseReply> | null;
    if (!r || typeof r.accessToken !== "string" || !isTier(r.tier) || typeof r.email !== "string") {
      throw new GmailToolError("bad_lease", "Gmail lease reply was malformed");
    }
    if (!tierAllows(r.tier, op)) {
      throw new GmailToolError("tier_denied", `tier_denied: ${r.email} is at level "${r.tier}", which does not allow "${op}"`);
    }
    return r as LeaseReply;
  }

  /**
   * Lease from `google/lease` with product `gmail`. No level is requested: the reply's level is checked here,
   * so a refusal reads exactly like the pre-migration `tier_denied`. Transport failures keep the existing
   * Gmail error; there is no fallback to legacy tokens (an imported, later disconnected account stays gone).
   */
  private async delegatedLease(account: string, op: Op): Promise<LeaseReply> {
    const reply = await this.request(GOOGLE_PLUGIN_ID, GOOGLE_LEASE_TYPE, { account, product: "gmail" });
    if (!reply.ok) throw await this.googleRefusal(reply.error, account, op);
    const r = reply.result as {
      accessToken?: unknown;
      expiresAt?: unknown;
      email?: unknown;
      level?: unknown;
      options?: { filters?: boolean };
    } | null;
    if (!r || typeof r.accessToken !== "string" || typeof r.email !== "string" || typeof r.expiresAt !== "number" || !isTier(r.level)) {
      throw new GmailToolError("bad_lease", "Gmail lease reply was malformed");
    }
    if (isFilterOp(op) && r.options?.filters !== true) {
      throw new GmailToolError(
        "filters_disabled",
        `filters_disabled: filters are not enabled for ${r.email}; turn them on for this account in Settings → Google accounts`,
      );
    }
    return this.checked({ accessToken: r.accessToken, expiresAt: r.expiresAt, email: r.email, tier: r.level }, op);
  }

  private async googleAccounts(): Promise<GoogleAccount[]> {
    const reply = await this.request(GOOGLE_PLUGIN_ID, GOOGLE_ACCOUNTS_TYPE, {});
    if (!reply.ok) throw laneError(reply.error);
    return Array.isArray(reply.result) ? (reply.result as GoogleAccount[]) : [];
  }

  /** Map a `google/lease` refusal onto the existing Gmail codes and messages (D7). Anything else passes through. */
  private async googleRefusal(error: string, account: string, op: Op): Promise<GmailToolError> {
    const code = /^([a-z_]{1,64}): /.exec(error)?.[1];
    if (!code || !NEEDS_ACCOUNTS.has(code)) {
      return code === "default_client_unavailable" || code === "no_client"
        ? new GmailToolError("no_client", "no_client: the Gmail OAuth client is not configured")
        : laneError(error);
    }
    const key = account.trim().toLowerCase();
    const all = await this.googleAccounts().catch(() => [] as GoogleAccount[]);
    const found = all.filter((a) => a.sub === account || a.email.toLowerCase() === key || a.alias?.toLowerCase() === key);
    const email = found.length === 1 ? (found[0] as GoogleAccount).email : account;
    switch (code) {
      case "level_insufficient": {
        const level = /"([a-z]+)"/.exec(error)?.[1];
        return isTier(level)
          ? new GmailToolError("tier_denied", `tier_denied: ${email} is at level "${level}", which does not allow "${op}"`)
          : laneError(error);
      }
      case "ambiguous":
        return new GmailToolError("ambiguous", `ambiguous: Several connected accounts share ${account}; set an alias on each in the Gmail panel and use the alias.`);
      case "product_disabled":
        return new GmailToolError("not_found", `not_found: Gmail is off for ${email} in Settings → Google accounts`);
      case "reauth_required":
        return new GmailToolError("reauth_required", `reauth_required: ${email} needs re-authentication in the Gmail panel`);
      case "scope_missing":
        return new GmailToolError("scope_missing", `scope_missing: Google did not grant the scope "${op}" needs for ${email}; re-authenticate`);
      case "not_found": {
        const known = gmailAccounts(all).map(labelOf).join(", ") || "none connected";
        return new GmailToolError("not_found", `not_found: No connected Gmail account matches "${account}". Known accounts: ${known}.`);
      }
      default:
        return laneError(error);
    }
  }
}
