/**
 * Persistence for held certificates: `<root>/<sourceId>/<name>/{cert.pem,key.pem,meta.json}`.
 *
 * Only the `CertManager` writes here, and only for the attempt that currently
 * owns the single-flight slot (each attempt has an id; tmp files carry it so a
 * late abandoned attempt can never clobber the current one). Write order per
 * name: tmp files → `chmod 0600` key → rename key → rename cert → `meta.json`
 * last. Load verifies the pair (`checkPrivateKey`); a parse error or mismatch
 * (crash between renames) is treated as missing so the manager re-obtains.
 * Private key bytes never leave this module except through `load()`.
 *
 * See change: add-tailscale-cert-tls (design D3).
 */
import { createPrivateKey, X509Certificate } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SourceDetails } from "./types.js";

export interface CertMeta {
  source: string;
  fingerprint: string;
  advertise: boolean;
  kind: "magicdns" | "domain";
  details?: SourceDetails;
  /** ms epoch; absent when no PEM has been stored yet. */
  notAfter?: number;
  notBefore?: number;
  /** "idle" or a source-defined running stage. */
  stage: string;
  lastError?: string;
  failures: number;
  nextAttemptAt?: number;
}

export interface LoadedCert {
  certPem: string;
  keyPem: string;
  meta: CertMeta;
  notBefore: number;
  notAfter: number;
}

/** A name safe to use as a directory component: hostnames and single-label wildcards only. */
const NAME_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export function isSafeCertName(name: string): boolean {
  return name.length <= 253 && NAME_RE.test(name);
}

/** `*.example.com` → `_wildcard_.example.com` (a `*` is not portable in file names). */
function encodeName(name: string): string {
  return name.startsWith("*.") ? `_wildcard_${name.slice(1)}` : name;
}
function decodeName(dir: string): string {
  return dir.startsWith("_wildcard_.") ? `*${dir.slice("_wildcard_".length)}` : dir;
}

/** Validity window of a PEM certificate (ms epoch). Throws on a parse error. */
export function certValidity(certPem: string): { notBefore: number; notAfter: number } {
  const x = new X509Certificate(certPem);
  return { notBefore: Date.parse(x.validFrom), notAfter: Date.parse(x.validTo) };
}

/** True when `keyPem` is the private key of `certPem`. Never throws. */
export function pairMatches(certPem: string, keyPem: string): boolean {
  try {
    return new X509Certificate(certPem).checkPrivateKey(createPrivateKey(keyPem));
  } catch {
    return false;
  }
}

const SOURCE_DIR_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * `base` joined with `parts`, proven to stay inside `base`: resolved, then checked
 * by prefix (a `..`, an absolute segment or a separator in an id/name can never
 * escape the TLS data dir). Every path this module hands to `fs` comes from here.
 */
function within(base: string, ...parts: string[]): string {
  const root = path.resolve(base);
  const target = path.resolve(root, ...parts);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("path escapes the TLS data directory");
  return target;
}

let tmpSeq = 0;

async function atomicWrite(file: string, data: string, mode: number): Promise<void> {
  // Unique per write: two overlapping writers must never share (and clobber) one tmp file.
  const tmp = `${file}.${process.pid}.${++tmpSeq}.tmp`;
  await fs.writeFile(tmp, data, { mode });
  await fs.chmod(tmp, mode);
  await fs.rename(tmp, file);
}

export class CertFiles {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  sourceDir(sourceId: string): string {
    if (!SOURCE_DIR_RE.test(sourceId)) throw new Error(`invalid source id ${JSON.stringify(sourceId)}`);
    return within(this.root, sourceId);
  }

  nameDir(sourceId: string, name: string): string {
    if (!isSafeCertName(name)) throw new Error(`invalid certificate name ${JSON.stringify(name)}`);
    return within(this.sourceDir(sourceId), encodeName(name));
  }

  /** Source ids that have a directory under the TLS root. */
  async listSourceDirs(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.root, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
    } catch {
      return [];
    }
  }

  /** Names that have a directory (PEM and/or meta) for `sourceId`. */
  async listNames(sourceId: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.sourceDir(sourceId), { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => decodeName(e.name))
        .filter(isSafeCertName);
    } catch {
      return [];
    }
  }

  async readMeta(sourceId: string, name: string): Promise<CertMeta | null> {
    try {
      const raw = JSON.parse(await fs.readFile(within(this.nameDir(sourceId, name), "meta.json"), "utf8"));
      if (!raw || typeof raw !== "object") return null;
      return { stage: "idle", failures: 0, advertise: false, kind: "magicdns", fingerprint: "", source: sourceId, ...raw };
    } catch {
      return null;
    }
  }

  async writeMeta(sourceId: string, name: string, meta: CertMeta): Promise<void> {
    const dir = this.nameDir(sourceId, name);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await atomicWrite(within(dir, "meta.json"), JSON.stringify(meta, null, 2), 0o600);
  }

  /**
   * Write a freshly obtained pair. `attemptId` keeps tmp names distinct per
   * attempt. `meta.json` goes last so a crash mid-write never advertises a
   * half-written pair as current.
   */
  async writePair(
    sourceId: string,
    name: string,
    attemptId: number,
    certPem: string,
    keyPem: string,
    meta: CertMeta,
  ): Promise<void> {
    const dir = this.nameDir(sourceId, name);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const certTmp = within(dir, `cert.pem.a${Math.trunc(attemptId)}.tmp`);
    const keyTmp = within(dir, `key.pem.a${Math.trunc(attemptId)}.tmp`);
    try {
      await fs.writeFile(certTmp, certPem, { mode: 0o644 });
      await fs.writeFile(keyTmp, keyPem, { mode: 0o600 });
      // The creation mode is masked by umask and some CLIs set none: be explicit.
      await fs.chmod(keyTmp, 0o600);
      await fs.rename(keyTmp, within(dir, "key.pem"));
      await fs.rename(certTmp, within(dir, "cert.pem"));
    } catch (err) {
      await fs.rm(certTmp, { force: true }).catch(() => undefined);
      await fs.rm(keyTmp, { force: true }).catch(() => undefined);
      throw err;
    }
    await atomicWrite(within(dir, "meta.json"), JSON.stringify(meta, null, 2), 0o600);
  }

  /** Load a stored pair. `null` = missing, unparseable or mismatched (logged by the caller). */
  async load(sourceId: string, name: string): Promise<{ loaded: LoadedCert | null; reason?: string }> {
    const dir = this.nameDir(sourceId, name);
    let certPem: string;
    let keyPem: string;
    try {
      certPem = await fs.readFile(within(dir, "cert.pem"), "utf8");
      keyPem = await fs.readFile(within(dir, "key.pem"), "utf8");
    } catch {
      return { loaded: null };
    }
    let validity: { notBefore: number; notAfter: number };
    try {
      validity = certValidity(certPem);
    } catch {
      return { loaded: null, reason: "stored certificate does not parse" };
    }
    if (!pairMatches(certPem, keyPem)) return { loaded: null, reason: "stored certificate and key do not match" };
    const meta = (await this.readMeta(sourceId, name)) ?? {
      source: sourceId,
      fingerprint: "",
      advertise: false,
      kind: "magicdns" as const,
      stage: "idle",
      failures: 0,
    };
    return { loaded: { certPem, keyPem, meta, ...validity } };
  }

  async removeName(sourceId: string, name: string): Promise<void> {
    await fs.rm(this.nameDir(sourceId, name), { recursive: true, force: true });
  }

  async removeSource(sourceId: string): Promise<void> {
    await fs.rm(this.sourceDir(sourceId), { recursive: true, force: true });
  }

  /** Drop the PEM pair but keep `meta.json` (a mismatched pair must be re-obtained). */
  async removePair(sourceId: string, name: string): Promise<void> {
    const dir = this.nameDir(sourceId, name);
    await fs.rm(within(dir, "cert.pem"), { force: true });
    await fs.rm(within(dir, "key.pem"), { force: true });
  }
}
