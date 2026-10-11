/**
 * `pi.services` offers: parsing, discovery, template hashing and diffing.
 *
 * A package OFFERS a service template; nothing happens until the user ADDS it
 * (writing an entry to `services.json` whose `origin` records the package,
 * version and `templateHash`). Discovery is a pure read: it never starts,
 * pulls, fetches or executes anything.
 * See change: add-service-registry-core (D7).
 */
import { createHash } from "node:crypto";
import { scanPiManifests } from "../tool-registry/pi-tools.js";
import {
  canonicalJson,
  type ServiceDefinition,
  type ServiceTemplate,
  validateDefinition,
} from "./schema.js";

/** One validated offer, attributed to the package that ships it. */
export interface ServiceOffer {
  package: string;
  version: string;
  template: ServiceTemplate;
  templateHash: string;
}

export interface ParsedServiceOffers {
  offers: ServiceOffer[];
  /** One message per rejected entry, naming the package and the offending key. */
  errors: string[];
}

/** `sha256:<hex>` of the canonical template JSON. */
export function templateHash(template: ServiceTemplate | Record<string, unknown>): string {
  return `sha256:${createHash("sha256").update(canonicalJson(template)).digest("hex")}`;
}

/**
 * Validate the `pi` object of one package (`undefined`-safe). Each entry is
 * validated in isolation, so one bad entry never hides its siblings.
 */
export function parseServiceOffers(pi: unknown, pkg: { name: string; version: string }): ParsedServiceOffers {
  const services = (pi as { services?: unknown } | null | undefined)?.services;
  if (services === undefined) return { offers: [], errors: [] };
  if (!Array.isArray(services)) return { offers: [], errors: [`${pkg.name}: pi.services must be an array`] };
  const offers: ServiceOffer[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of services) {
    const label = (entry as { id?: unknown } | null)?.id;
    const result = validateDefinition(entry, { kind: "offer" });
    if (!result.ok) {
      for (const e of result.errors) errors.push(`${pkg.name} pi.services[${JSON.stringify(label ?? "?")}] ${e}`);
      continue;
    }
    const template = entry as ServiceTemplate;
    if (seen.has(template.id)) {
      errors.push(`${pkg.name} pi.services[${JSON.stringify(template.id)}] id: duplicate within the package`);
      continue;
    }
    seen.add(template.id);
    offers.push({ package: pkg.name, version: pkg.version, template, templateHash: templateHash(template) });
  }
  return { offers, errors };
}

/** Scan installed / monorepo packages for `pi.services` (same walk as `pi.tools`). */
export function discoverServiceOffers(root: string): ParsedServiceOffers {
  const offers: ServiceOffer[] = [];
  const errors: string[] = [];
  const manifests = scanPiManifests(root, (pi) => (pi as { services?: unknown }).services !== undefined);
  for (const m of manifests) {
    const parsed = parseServiceOffers(m.pi, { name: m.name ?? m.pkgDir, version: m.version ?? "0.0.0" });
    offers.push(...parsed.offers);
    errors.push(...parsed.errors);
  }
  return { offers, errors };
}

/** Build the `services.json` entry for an offer (what `add` writes). */
export function definitionFromOffer(offer: ServiceOffer): ServiceDefinition {
  const { schemaVersion: _schemaVersion, ...rest } = offer.template;
  return {
    ...rest,
    origin: { package: offer.package, version: offer.version, templateHash: offer.templateHash },
  } as ServiceDefinition;
}

/** The template an existing offer-origin entry was created from (for diffing). */
export function templateOfDefinition(def: ServiceDefinition): Record<string, unknown> {
  const { origin: _origin, ...rest } = def;
  return { schemaVersion: 1, ...rest };
}

export interface TemplateDiffEntry {
  path: string;
  from: unknown;
  to: unknown;
}

/**
 * Structural diff between two templates as `[{ path, from, to }]`, dotted
 * paths (`oci.image`), arrays compared whole. Keys are visited sorted so the
 * output is deterministic.
 */
export function diffTemplates(from: unknown, to: unknown, base = ""): TemplateDiffEntry[] {
  const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  if (isObj(from) && isObj(to)) {
    const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
    return keys.flatMap((k) => diffTemplates(from[k], to[k], base ? `${base}.${k}` : k));
  }
  if (canonicalJson(from) === canonicalJson(to)) return [];
  return [{ path: base, from, to }];
}
