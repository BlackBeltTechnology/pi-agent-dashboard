/**
 * Store over `ctx.credentials` namespace `google` (design D2/D3). Records:
 *   `client:<id>`   own OAuth client (Desktop or Web, linked email domains)
 *   `acct:<sub>`    one account, ONE grant, bound to ONE client, product map
 *   `disclosure`    `{version, acceptedAt}` (design D8)
 *   `imported:gmail` `{subs, clients}` — legacy gmail import ledger (design D10)
 * Resolution uses ONE `snapshot()`; every write goes through `update()` (atomic RMW) so a
 * concurrent refresh / re-auth / product change never clobbers another. A full namespace
 * (≤256 keys, ≤2 MiB) surfaces as `too_many_keys`. See change: add-google-connect.
 */
import type {
  PluginCredentialRecord,
  PluginCredentials,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";
import { type ClientType, normalizeDomain, slugify } from "../shared/client-json.js";
import type { Product, ProductSelection } from "../shared/products.js";
import type { AccountStatus } from "../shared/protocol.js";

const CLIENT_PREFIX = "client:";
const ACCT_PREFIX = "acct:";
const DISCLOSURE_KEY = "disclosure";
export const IMPORTED_GMAIL_KEY = "imported:gmail";
/** Host namespace limit (`plugin-credential-store.ts`). */
export const MAX_KEYS = 256;

export type ClientRef = "builtin" | "builtin-remote" | `own:${string}`;

export interface OwnClient {
  id: string;
  label: string;
  type: ClientType;
  clientId: string;
  clientSecret: string;
  projectId?: string;
  ownerAccount?: string;
  domains: string[];
  addedAt: number;
}

interface Grant {
  /** The exact Google client id that minted the refresh token — refresh always uses it. */
  clientId: string;
  refresh: string;
  access: string;
  expires: number;
  scopes: string[];
  status: AccountStatus;
  testingHint?: boolean;
  grantedAt: number;
}

export interface Account {
  sub: string;
  email: string;
  alias?: string;
  addedAt: number;
  client: ClientRef;
  grant: Grant;
  products: Partial<Record<Product, ProductSelection>>;
  /** Products the last consent asked for but Google did not grant (`scope_missing`); absent = none. */
  missing?: Product[];
}

export type StoreErrorCode =
  | "not_found"
  | "ambiguous"
  | "alias_taken"
  | "invalid_alias"
  | "missing_refresh"
  | "client_not_found"
  | "client_in_use"
  | "invalid_domain"
  | "domain_taken"
  | "too_many_keys";

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  /** Extra non-secret detail (e.g. the label of the client that owns a domain). */
  readonly detail?: string;
  constructor(code: StoreErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.detail = detail;
  }
}

export const clientKey = (id: string): string => `${CLIENT_PREFIX}${id}`;
export const acctKey = (sub: string): string => `${ACCT_PREFIX}${sub}`;

const FULL_MESSAGE = "Google accounts storage is full — remove unused accounts or clients.";

/** Map the host's namespace-limit errors to `too_many_keys`; rethrow everything else untouched. */
function fullAware(err: unknown): never {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "too_many_keys" || code === "namespace_too_large") throw new StoreError("too_many_keys", FULL_MESSAGE);
  throw err;
}

function asClient(rec: PluginCredentialRecord | undefined): OwnClient | undefined {
  if (
    !rec ||
    typeof rec.id !== "string" ||
    typeof rec.clientId !== "string" ||
    typeof rec.clientSecret !== "string" ||
    (rec.type !== "installed" && rec.type !== "web")
  ) {
    return undefined;
  }
  return { ...rec, domains: Array.isArray(rec.domains) ? (rec.domains as string[]) : [] } as unknown as OwnClient;
}

function asAccount(rec: PluginCredentialRecord | undefined): Account | undefined {
  if (!rec || typeof rec.sub !== "string" || typeof rec.email !== "string") return undefined;
  const grant = rec.grant as Grant | undefined;
  if (!grant || typeof grant.refresh !== "string" || typeof grant.clientId !== "string") return undefined;
  return { ...rec, products: (rec.products ?? {}) as Account["products"] } as unknown as Account;
}

const ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/i;

function labels(accounts: Account[]): string {
  if (accounts.length === 0) return "none connected";
  return accounts.map((a) => (a.alias ? `${a.alias} (${a.email})` : a.email)).join(", ");
}

/** Secret-free account view for the panel, the lane and `google_accounts`. */
export interface AccountSummary {
  sub: string;
  email: string;
  alias?: string;
  client: ClientRef;
  status: AccountStatus;
  testingHint?: boolean;
  products: Account["products"];
  missing?: Product[];
  addedAt: number;
}

export function summarize(a: Account): AccountSummary {
  const s: AccountSummary = {
    sub: a.sub,
    email: a.email,
    client: a.client,
    status: a.grant.status,
    products: a.products,
    addedAt: a.addedAt,
  };
  if (a.alias) s.alias = a.alias;
  if (a.grant.testingHint) s.testingHint = true;
  if (a.missing?.length) s.missing = a.missing;
  return s;
}

/** Secret-free own-client view (`clientSecret` never leaves the store). */
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

export interface ImportLedger {
  /** Legacy gmail subs already imported (never imported again, even after a disconnect). */
  subs: string[];
  /** The legacy client was imported as own client `gmail-legacy`. */
  client: boolean;
}

interface ParsedUpload {
  type: ClientType;
  clientId: string;
  clientSecret: string;
  projectId?: string;
}
interface UploadMeta {
  label?: string;
  domains?: readonly string[];
  ownerAccount?: string;
}

export class GoogleStore {
  private readonly creds: PluginCredentials;
  /** Serializes cross-key uniqueness checks (alias, domain): `update()` is per key. */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(creds: PluginCredentials) {
    this.creds = creds;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  // ── own clients ───────────────────────────────────────────────────────────

  async listClients(): Promise<OwnClient[]> {
    const snap = await this.creds.snapshot();
    return Object.entries(snap)
      .filter(([k]) => k.startsWith(CLIENT_PREFIX))
      .map(([, v]) => asClient(v))
      .filter((c): c is OwnClient => c !== undefined)
      .sort((a, b) => a.addedAt - b.addedAt);
  }

  async getClient(id: string): Promise<OwnClient | undefined> {
    return asClient(await this.creds.get(clientKey(id)));
  }

  async summarizeClients(): Promise<ClientSummary[]> {
    const snap = await this.creds.snapshot();
    const accounts = Object.entries(snap)
      .filter(([k]) => k.startsWith(ACCT_PREFIX))
      .map(([, v]) => asAccount(v))
      .filter((a): a is Account => a !== undefined);
    return (await this.listClients()).map((c) => {
      const s: ClientSummary = {
        id: c.id,
        ref: `own:${c.id}`,
        label: c.label,
        type: c.type,
        clientId: c.clientId,
        domains: c.domains,
        accounts: accounts.filter((a) => a.client === `own:${c.id}`).length,
      };
      if (c.projectId) s.projectId = c.projectId;
      if (c.ownerAccount) s.ownerAccount = c.ownerAccount;
      return s;
    });
  }

  private async accountsOf(ref: ClientRef): Promise<Account[]> {
    return (await this.list()).filter((a) => a.client === ref);
  }

  /** Normalise + de-duplicate a domain list; an invalid entry → `invalid_domain` (nothing stored). */
  private cleanDomains(raw: readonly string[]): string[] {
    const out: string[] = [];
    for (const r of raw) {
      const d = typeof r === "string" ? normalizeDomain(r) : null;
      if (!d) throw new StoreError("invalid_domain", "Enter a domain such as example.com.");
      if (!out.includes(d)) out.push(d);
    }
    return out;
  }

  private async assertDomainsFree(domains: readonly string[], selfId: string | undefined): Promise<void> {
    for (const other of await this.listClients()) {
      if (other.id === selfId) continue;
      const clash = domains.find((d) => other.domains.includes(d));
      if (clash) {
        throw new StoreError("domain_taken", `${clash} is already linked to "${other.label}".`, other.label);
      }
    }
  }

  /** Update an existing client's secret (and project) — label and domains are kept (scenario-gate A3). */
  private async refreshClient(existing: OwnClient, parsed: ParsedUpload): Promise<OwnClient> {
    const next: OwnClient = { ...existing, clientSecret: parsed.clientSecret, type: parsed.type };
    if (parsed.projectId) next.projectId = parsed.projectId;
    await this.creds.set(clientKey(existing.id), next as unknown as PluginCredentialRecord);
    return next;
  }

  private async createClient(parsed: ParsedUpload, meta: UploadMeta, existing: readonly OwnClient[]): Promise<OwnClient> {
    const domains = this.cleanDomains(meta.domains ?? []);
    await this.assertDomainsFree(domains, undefined);
    const base = slugify(meta.label ?? parsed.projectId ?? "client");
    let id = base;
    for (let n = 2; existing.some((c) => c.id === id); n++) id = `${base}-${n}`;
    const client: OwnClient = {
      id,
      label: meta.label?.trim() || parsed.projectId || "Organisation",
      type: parsed.type,
      clientId: parsed.clientId,
      clientSecret: parsed.clientSecret,
      domains,
      addedAt: Date.now(),
    };
    if (parsed.projectId) client.projectId = parsed.projectId;
    if (meta.ownerAccount) client.ownerAccount = meta.ownerAccount;
    await this.creds.set(clientKey(id), client as unknown as PluginCredentialRecord);
    return client;
  }

  /**
   * Add an own client, or — when `clientId` matches an existing one — update its secret and
   * project (label and domains kept; scenario-gate A3). Any other upload adds a client.
   */
  upsertClient(parsed: ParsedUpload, meta: UploadMeta = {}): Promise<{ client: OwnClient; created: boolean }> {
    return this.serial(async () => {
      const clients = await this.listClients();
      const existing = clients.find((c) => c.clientId === parsed.clientId);
      try {
        if (existing) return { client: await this.refreshClient(existing, parsed), created: false };
        return { client: await this.createClient(parsed, meta, clients), created: true };
      } catch (err) {
        if (err instanceof StoreError) throw err;
        return fullAware(err);
      }
    });
  }

  /** Edit label / domains / setup fields. `clientId` is never changed here (see {@link replaceClientId}). */
  patchClient(
    id: string,
    patch: { label?: string; domains?: readonly string[]; projectId?: string | null; ownerAccount?: string | null },
  ): Promise<OwnClient> {
    return this.serial(async () => {
      const prev = await this.getClient(id);
      if (!prev) throw new StoreError("client_not_found", "Unknown organisation sign-in.");
      const next: OwnClient = { ...prev };
      if (patch.label !== undefined) next.label = patch.label.trim() || prev.label;
      if (patch.domains !== undefined) {
        next.domains = this.cleanDomains(patch.domains);
        await this.assertDomainsFree(next.domains, id);
      }
      for (const k of ["projectId", "ownerAccount"] as const) {
        const v = patch[k];
        if (v === null) delete next[k];
        else if (v !== undefined) next[k] = v;
      }
      await this.creds.set(clientKey(id), next as unknown as PluginCredentialRecord);
      return next;
    });
  }

  /** Swap the Google client id of own client `id` — refused while an account references it. */
  replaceClientId(id: string, clientId: string, clientSecret: string): Promise<OwnClient> {
    return this.serial(async () => {
      const prev = await this.getClient(id);
      if (!prev) throw new StoreError("client_not_found", "Unknown organisation sign-in.");
      if (prev.clientId !== clientId && (await this.accountsOf(`own:${id}`)).length > 0) {
        throw new StoreError("client_in_use", "Disconnect the accounts that use this sign-in first.");
      }
      const next = { ...prev, clientId, clientSecret };
      await this.creds.set(clientKey(id), next as unknown as PluginCredentialRecord);
      return next;
    });
  }

  /** Remove an own client — refused while ANY account references it, whatever its grant status. */
  removeClient(id: string): Promise<void> {
    return this.serial(async () => {
      if (!(await this.getClient(id))) throw new StoreError("client_not_found", "Unknown organisation sign-in.");
      if ((await this.accountsOf(`own:${id}`)).length > 0) {
        throw new StoreError("client_in_use", "Disconnect the accounts that use this sign-in first.");
      }
      await this.creds.remove(clientKey(id));
    });
  }

  /** Own client whose `domains` contains `domain` (exact, lower-cased; no suffix matching). */
  async clientForDomain(domain: string): Promise<OwnClient | undefined> {
    const d = domain.trim().toLowerCase();
    return (await this.listClients()).find((c) => c.domains.includes(d));
  }

  // ── accounts ──────────────────────────────────────────────────────────────

  async list(): Promise<Account[]> {
    const snap = await this.creds.snapshot();
    return Object.entries(snap)
      .filter(([k]) => k.startsWith(ACCT_PREFIX))
      .map(([, v]) => asAccount(v))
      .filter((a): a is Account => a !== undefined)
      .sort((a, b) => a.addedAt - b.addedAt);
  }

  async get(sub: string): Promise<Account | undefined> {
    return asAccount(await this.creds.get(acctKey(sub)));
  }

  /** Alias first (case-insensitive), then email (case-insensitive); the `sub` itself also resolves. */
  async resolve(ref: string): Promise<Account> {
    const accounts = await this.list();
    const needle = ref.trim().toLowerCase();
    const bySub = accounts.find((a) => a.sub === ref.trim());
    if (bySub) return bySub;
    const byAlias = accounts.find((a) => a.alias?.toLowerCase() === needle);
    if (byAlias) return byAlias;
    const byEmail = accounts.filter((a) => a.email.toLowerCase() === needle);
    if (byEmail.length === 1) return byEmail[0] as Account;
    if (byEmail.length > 1) {
      throw new StoreError(
        "ambiguous",
        `Several connected accounts share ${ref}; set an alias on each in Settings → Google accounts and use the alias.`,
      );
    }
    throw new StoreError("not_found", `No connected Google account matches "${ref}". Known accounts: ${labels(accounts)}.`);
  }

  /** True when a NEW account can still be stored (B17: checked before Google opens). */
  async hasRoomForAccount(sub?: string): Promise<boolean> {
    const keys = await this.creds.list();
    if (sub && keys.includes(acctKey(sub))) return true;
    return keys.length < MAX_KEYS;
  }

  setAlias(sub: string, alias: string | undefined): Promise<Account> {
    return this.serial(async () => {
      const next = alias?.trim() || undefined;
      if (next !== undefined && !ALIAS_RE.test(next)) {
        throw new StoreError("invalid_alias", "Alias must be 1–40 letters, digits, '.', '_' or '-'.");
      }
      if (next !== undefined) {
        const clash = (await this.list()).find((a) => a.sub !== sub && a.alias?.toLowerCase() === next.toLowerCase());
        if (clash) throw new StoreError("alias_taken", `Alias "${next}" is already used by ${clash.email}.`);
      }
      return this.patch(sub, (prev) => {
        const { alias: _drop, ...rest } = prev;
        return next === undefined ? rest : { ...rest, alias: next };
      });
    });
  }

  /** Replace the product map entry for `product` (`undefined` turns it off). No re-consent here. */
  setProduct(sub: string, product: Product, sel: ProductSelection | undefined): Promise<Account> {
    return this.patch(sub, (prev) => {
      const products = { ...((prev.products ?? {}) as Record<string, unknown>) };
      if (sel) products[product] = sel;
      else delete products[product];
      return { ...prev, products };
    });
  }

  /** Mark `reauth_required` ONLY while the record still holds the grant that failed (a concurrent re-auth wins). */
  async markReauthIf(sub: string, failedRefresh: string): Promise<boolean> {
    let marked = false;
    await this.creds.update(acctKey(sub), (prev) => {
      const grant = prev?.grant as Grant | undefined;
      if (!prev || !grant || grant.refresh !== failedRefresh) return prev;
      marked = true;
      return { ...prev, grant: { ...grant, status: "reauth_required" } };
    });
    return marked;
  }

  /** Store refreshed tokens IF the record still holds `usedRefresh` (merge; a concurrent re-auth's grant wins). */
  async storeTokensIf(
    sub: string,
    usedRefresh: string,
    tokens: { access: string; expires: number; refresh?: string },
  ): Promise<void> {
    await this.creds.update(acctKey(sub), (prev) => {
      const grant = prev?.grant as Grant | undefined;
      if (!prev || !grant || grant.refresh !== usedRefresh) return prev;
      const next: Grant = { ...grant, access: tokens.access, expires: tokens.expires };
      if (tokens.refresh) next.refresh = tokens.refresh;
      return { ...prev, grant: next };
    });
  }

  async remove(sub: string): Promise<void> {
    await this.creds.remove(acctKey(sub));
  }

  /**
   * Upsert after a sign-in. A known `sub` merges (keeps alias, addedAt, products' options the caller
   * passes through `products`); a new account without a refresh token is rejected (nothing written).
   */
  async upsertFromSignIn(input: {
    sub: string;
    email: string;
    client: ClientRef;
    clientId: string;
    scopes: string[];
    access: string;
    refresh?: string;
    expires: number;
    testingHint?: boolean;
    /** The full product map to store (the caller merges previous + newly granted). */
    products: Account["products"];
    missing?: Product[];
    now?: number;
  }): Promise<Account> {
    let missingRefresh = false;
    let out: PluginCredentialRecord | undefined;
    try {
      out = await this.creds.update(acctKey(input.sub), (prev) => {
        const prevGrant = prev?.grant as Grant | undefined;
        const refresh = input.refresh || prevGrant?.refresh || "";
        if (!refresh) {
          missingRefresh = true;
          return prev;
        }
        const now = input.now ?? Date.now();
        const grant: Grant = {
          clientId: input.clientId,
          refresh,
          access: input.access,
          expires: input.expires,
          scopes: [...input.scopes],
          status: "ok",
          grantedAt: now,
        };
        if (input.testingHint) grant.testingHint = true;
        const rec: PluginCredentialRecord = {
          ...(prev ?? {}),
          sub: input.sub,
          email: input.email,
          client: input.client,
          grant: grant as unknown as PluginCredentialRecord,
          products: input.products as unknown as PluginCredentialRecord,
          addedAt: typeof prev?.addedAt === "number" ? prev.addedAt : now,
        };
        if (input.missing?.length) rec.missing = [...input.missing];
        else delete rec.missing;
        return rec;
      });
    } catch (err) {
      return fullAware(err);
    }
    if (missingRefresh) {
      throw new StoreError(
        "missing_refresh",
        "Google returned no refresh token. Revoke this app's access at myaccount.google.com/permissions and retry.",
      );
    }
    return asAccount(out) as Account;
  }

  private async patch(sub: string, fn: (prev: PluginCredentialRecord) => PluginCredentialRecord): Promise<Account> {
    let found = true;
    const out = await this.creds.update(acctKey(sub), (prev) => {
      if (!prev) {
        found = false;
        return prev;
      }
      return fn(prev);
    });
    if (!found) throw new StoreError("not_found", "Unknown account.");
    return asAccount(out) as Account;
  }

  // ── disclosure + import ledger ────────────────────────────────────────────

  async getDisclosure(): Promise<{ version: number; acceptedAt: number } | undefined> {
    const rec = await this.creds.get(DISCLOSURE_KEY);
    if (!rec || typeof rec.version !== "number") return undefined;
    return { version: rec.version, acceptedAt: typeof rec.acceptedAt === "number" ? rec.acceptedAt : 0 };
  }

  async acceptDisclosure(version: number, now = Date.now()): Promise<void> {
    try {
      await this.creds.set(DISCLOSURE_KEY, { version, acceptedAt: now });
    } catch (err) {
      fullAware(err);
    }
  }

  async getImportLedger(): Promise<ImportLedger> {
    const rec = await this.creds.get(IMPORTED_GMAIL_KEY);
    const subs = Array.isArray(rec?.subs) ? (rec.subs as unknown[]).filter((s): s is string => typeof s === "string") : [];
    return { subs, client: rec?.client === true };
  }

  async setImportLedger(ledger: ImportLedger): Promise<void> {
    await this.creds.set(IMPORTED_GMAIL_KEY, { subs: [...ledger.subs], client: ledger.client });
  }

  /** Key count of the namespace (tests + the import's atomic capacity check). */
  async keyCount(): Promise<number> {
    return (await this.creds.list()).length;
  }

  /** Read-only access for the import's all-or-nothing batch write. */
  rawCredentials(): PluginCredentials {
    return this.creds;
  }
}
