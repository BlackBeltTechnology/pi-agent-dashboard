/**
 * Argument validators for tool `parse()` functions. Each throws `invalid_params` naming the argument; nothing
 * here touches a lane, Google or the UI. See change: add-google-connect.
 */
import { invalidParams } from "./tool-error.js";

export type Params = Record<string, unknown>;

/** A non-empty string (≤ `max` chars). */
export function reqStr(p: Params, name: string, max = 10_000): string {
  const v = p[name];
  if (typeof v !== "string" || !v.trim()) throw invalidParams(`\`${name}\` is required (non-empty string)`);
  if (v.length > max) throw invalidParams(`\`${name}\` is longer than ${max} characters`);
  return v;
}

/** A string or undefined (`""`/null count as absent). */
export function optStr(p: Params, name: string, max = 10_000): string | undefined {
  const v = p[name];
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string") throw invalidParams(`\`${name}\` must be a string`);
  if (v.length > max) throw invalidParams(`\`${name}\` is longer than ${max} characters`);
  return v;
}

export function optBool(p: Params, name: string): boolean | undefined {
  const v = p[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "boolean") throw invalidParams(`\`${name}\` must be true or false`);
  return v;
}

export function optInt(p: Params, name: string, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number | undefined {
  const v = p[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw invalidParams(`\`${name}\` must be an integer ${min}\u2013${max}`);
  return v;
}

/** A list of non-empty strings; absent → `[]`. */
export function strList(p: Params, name: string, { min = 0, max = 100 } = {}): string[] {
  const v = p[name];
  if (v === undefined || v === null) {
    if (min > 0) throw invalidParams(`\`${name}\` is required`);
    return [];
  }
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim()) || v.length < min || v.length > max) {
    throw invalidParams(`\`${name}\` must be a list of ${min}\u2013${max} strings`);
  }
  return v as string[];
}

/** One of `allowed`; the error lists the valid values. */
export function oneOf<T extends string>(p: Params, name: string, allowed: readonly T[]): T {
  const v = p[name];
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw invalidParams(`\`${name}\` must be one of: ${allowed.join(", ")}`);
  }
  return v as T;
}
