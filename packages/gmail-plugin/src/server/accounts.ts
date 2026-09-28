/**
 * Account store over `ctx.credentials` namespace `gmail` (design D2).
 * Records: `client` → OAuth client; `acct:<sub>` → one account. Resolution uses
 * ONE `snapshot()` read; every write goes through `update()` (atomic RMW) so a
 * concurrent refresh / re-auth / level change never clobbers another.
 * See change: add-gmail-plugin.
 */
import type {
  PluginCredentialRecord,
  PluginCredentials,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { isTier, type Tier } from "../shared/scopes.js";

export const CLIENT_KEY = "client";
const ACCT_PREFIX = "acct:";

type AccountStatus = "ok" | "reauth_required";

export interface ClientRecord {
  clientId: string;
  clientSecret: string;
  projectId?: string;
}

export interface AccountRecord {
  sub: string;
  email: string;
  alias?: string;
  tier: Tier;
  scopes: string[];
  refresh: string;
  access: string;
  expires: number;
  status: AccountStatus;
  testingHint?: boolean;
  addedAt: number;
}

/** Public (secret-free) account view for the panel and `gmail_accounts`. */
export interface AccountSummary {
  sub: string;
  email: string;
  alias?: string;
  tier: Tier;
  status: AccountStatus;
  testingHint?: boolean;
  addedAt: number;
}

export class AccountError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "ambiguous"
      | "alias_taken"
      | "invalid_alias"
      | "missing_refresh"
      | "no_client",
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

export const acctKey = (sub: string): string => `${ACCT_PREFIX}${sub}`;

function asAccount(rec: PluginCredentialRecord | undefined): AccountRecord | undefined {
  if (!rec || typeof rec.sub !== "string" || typeof rec.email !== "string" || !isTier(rec.tier)) {
    return undefined;
  }
  return rec as unknown as AccountRecord;
}

export function summarize(a: AccountRecord): AccountSummary {
  const s: AccountSummary = { sub: a.sub, email: a.email, tier: a.tier, status: a.status, addedAt: a.addedAt };
  if (a.alias) s.alias = a.alias;
  if (a.testingHint) s.testingHint = true;
  return s;
}

const ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/i;

/** Human-readable label list used in not-found / ambiguity errors. */
function labels(accounts: AccountRecord[]): string {
  if (accounts.length === 0) return "none connected";
  return accounts.map((a) => (a.alias ? `${a.alias} (${a.email})` : a.email)).join(", ");
}

export class AccountStore {
  constructor(private readonly creds: PluginCredentials) {}

  async getClient(): Promise<ClientRecord | undefined> {
    const rec = await this.creds.get(CLIENT_KEY);
    if (!rec || typeof rec.clientId !== "string" || typeof rec.clientSecret !== "string") return undefined;
    return rec as unknown as ClientRecord;
  }

  async setClient(client: ClientRecord): Promise<void> {
    await this.creds.set(CLIENT_KEY, { ...client });
  }

  async list(): Promise<AccountRecord[]> {
    const snap = await this.creds.snapshot();
    return Object.entries(snap)
      .filter(([k]) => k.startsWith(ACCT_PREFIX))
      .map(([, v]) => asAccount(v))
      .filter((a): a is AccountRecord => a !== undefined)
      .sort((a, b) => a.addedAt - b.addedAt);
  }

  async get(sub: string): Promise<AccountRecord | undefined> {
    return asAccount(await this.creds.get(acctKey(sub)));
  }

  /**
   * Resolve `ref` from ONE snapshot: alias first (case-insensitive), then email
   * (case-insensitive). Same email on two subs → `ambiguous`. No implicit default.
   */
  async resolve(ref: string): Promise<AccountRecord> {
    const accounts = await this.list();
    const needle = ref.trim().toLowerCase();
    const byAlias = accounts.find((a) => a.alias?.toLowerCase() === needle);
    if (byAlias) return byAlias;
    const byEmail = accounts.filter((a) => a.email.toLowerCase() === needle);
    if (byEmail.length === 1) return byEmail[0] as AccountRecord;
    if (byEmail.length > 1) {
      throw new AccountError(
        "ambiguous",
        `Several connected accounts share ${ref}; set an alias on each in the Gmail panel and use the alias.`,
      );
    }
    throw new AccountError("not_found", `No connected Gmail account matches "${ref}". Known accounts: ${labels(accounts)}.`);
  }

  /** Set or clear an alias. Aliases are unique (case-insensitive) across accounts. */
  async setAlias(sub: string, alias: string | undefined): Promise<AccountRecord> {
    const next = alias?.trim() || undefined;
    if (next !== undefined && !ALIAS_RE.test(next)) {
      throw new AccountError("invalid_alias", "Alias must be 1–40 letters, digits, '.', '_' or '-'.");
    }
    if (next !== undefined) {
      const clash = (await this.list()).find((a) => a.sub !== sub && a.alias?.toLowerCase() === next.toLowerCase());
      if (clash) throw new AccountError("alias_taken", `Alias "${next}" is already used by ${clash.email}.`);
    }
    return this.patch(sub, (prev) => {
      const { alias: _drop, ...rest } = prev;
      return next === undefined ? rest : { ...rest, alias: next };
    });
  }

  /** Lower (or set) the tier without re-consent. */
  async setTier(sub: string, tier: Tier): Promise<AccountRecord> {
    return this.patch(sub, (prev) => ({ ...prev, tier }));
  }

  /** Mark `reauth_required` ONLY while the record still holds the grant that failed (a concurrent re-auth wins). */
  async markReauthIf(sub: string, failedRefresh: string): Promise<void> {
    await this.creds.update(acctKey(sub), (prev) =>
      prev && prev.refresh === failedRefresh ? { ...prev, status: "reauth_required" } : prev,
    );
  }

  /**
   * Store refreshed tokens IF the record still holds `usedRefresh` (merge —
   * never clobbers alias/tier; a concurrent re-auth's new grant wins).
   */
  async storeTokensIf(
    sub: string,
    usedRefresh: string,
    tokens: { access: string; expires: number; refresh?: string },
  ): Promise<void> {
    await this.creds.update(acctKey(sub), (prev) => {
      if (!prev || prev.refresh !== usedRefresh) return prev;
      const out: PluginCredentialRecord = { ...prev, access: tokens.access, expires: tokens.expires };
      if (tokens.refresh) out.refresh = tokens.refresh;
      return out;
    });
  }

  async remove(sub: string): Promise<void> {
    await this.creds.remove(acctKey(sub));
  }

  /**
   * Upsert after a sign-in (design D3 persist). Re-auth of a known `sub` merges:
   * keeps alias + addedAt, updates email, tokens, scopes, tier and resets status.
   * A NEW account without a refresh token is rejected (nothing written).
   */
  async upsertFromSignIn(input: {
    sub: string;
    email: string;
    tier: Tier;
    scopes: string[];
    access: string;
    refresh?: string;
    expires: number;
    testingHint?: boolean;
    now?: number;
  }): Promise<AccountRecord> {
    let missingRefresh = false;
    const out = await this.creds.update(acctKey(input.sub), (prev) => {
      const refresh = input.refresh || (typeof prev?.refresh === "string" ? prev.refresh : "");
      if (!refresh) {
        missingRefresh = true;
        return prev;
      }
      const rec: PluginCredentialRecord = {
        ...(prev ?? {}),
        sub: input.sub,
        email: input.email,
        tier: input.tier,
        scopes: [...input.scopes],
        access: input.access,
        refresh,
        expires: input.expires,
        status: "ok",
        addedAt: typeof prev?.addedAt === "number" ? prev.addedAt : (input.now ?? Date.now()),
      };
      if (input.testingHint) rec.testingHint = true;
      else delete rec.testingHint;
      return rec;
    });
    if (missingRefresh) {
      throw new AccountError(
        "missing_refresh",
        "Google returned no refresh token. Revoke this app's access at myaccount.google.com/permissions and retry.",
      );
    }
    return asAccount(out) as AccountRecord;
  }

  private async patch(
    sub: string,
    fn: (prev: PluginCredentialRecord) => PluginCredentialRecord,
  ): Promise<AccountRecord> {
    let found = true;
    const out = await this.creds.update(acctKey(sub), (prev) => {
      if (!prev) {
        found = false;
        return prev;
      }
      return fn(prev);
    });
    if (!found) throw new AccountError("not_found", "Unknown account.");
    return asAccount(out) as AccountRecord;
  }
}
