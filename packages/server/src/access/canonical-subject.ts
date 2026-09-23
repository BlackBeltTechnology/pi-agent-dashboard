/**
 * Volume-appropriate canonical form for access-subject comparison (task 2b.3a).
 *
 * `samePath` in `packages/shared/src/platform/paths.ts` is a codebase-wide
 * equality primitive that decides case sensitivity **from the platform**
 * (`linux` → sensitive, everything else → insensitive) and normalises nothing
 * beyond separators. That is wrong for the case this module exists to serve: a
 * case-*sensitive* volume mounted on a case-insensitive host — an APFS
 * case-sensitive volume, a Docker bind mount, a network share — where two
 * subjects differing only in case are genuinely different objects. Lowercasing
 * them together silently widens a grant.
 *
 * This module therefore probes sensitivity **from the volume** and keeps its
 * own canonical form. It deliberately does NOT modify `samePath`: that
 * primitive's semantics are depended on across the server, and changing them
 * here would alter shipped containment behaviour on every platform at once.
 * The two coexist; this one is authoritative for **access subjects**, and the
 * boundary is that a caller comparing an access subject uses THIS module.
 *
 * Rules, each a test:
 *   - Case-folded **only when the volume is case-insensitive**, probed per
 *     device and memoised.
 *   - Unicode **NFC-normalised** before folding, so HFS+ NFD names and Linux
 *     NFC names compare equal.
 *   - Containment is **component-wise** (`path.relative`), never a string
 *     prefix: `/repo-secrets` is not inside `/repo`.
 *   - An **unresolvable** path is refused (`null`) rather than compared
 *     unresolved — a path that cannot be canonicalised cannot be compared.
 *
 * See change: add-access-grant-dialog (task 2b.3a).
 */
import * as fs from "node:fs";
import path from "node:path";

/** A subject in the volume's own comparison form. */
export interface CanonicalSubject {
  /** Real path, NFC-normalised, case-folded iff the volume folds case. */
  canonical: string;
  /** Whether the volume holding this subject compares case-insensitively. */
  caseInsensitive: boolean;
}

/** Probe results, keyed by device id — one filesystem, one answer. */
const probeCache = new Map<string, boolean>();

/** Nearest existing directory at or above `p`. */
function nearestExistingDir(p: string): string | null {
  let cur = path.resolve(p);
  for (;;) {
    try {
      return fs.statSync(cur).isDirectory() ? cur : path.dirname(cur);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return null;
      cur = parent;
    }
  }
}

/** Flip ASCII case; returns `null` when the name carries no letters to flip. */
function flipCase(name: string): string | null {
  const flipped = /[a-z]/.test(name) ? name.toUpperCase() : name.toLowerCase();
  return flipped === name ? null : flipped;
}

/**
 * Whether the volume holding `existingPath` compares case-insensitively.
 *
 * Probed, never assumed from `process.platform`: take an existing directory
 * name, flip its case, and ask whether that flipped sibling also exists. If it
 * does, the volume folds case. Memoised per device so the probe runs once per
 * mount, not once per denial.
 *
 * A probe that cannot be performed (no flippable component anywhere up the
 * chain) answers **case-sensitive**: refusing a match is the fail-closed
 * direction for a module whose callers use this to *admit* access.
 */
export function volumeCaseInsensitive(existingPath: string): boolean {
  const dir = nearestExistingDir(existingPath);
  if (!dir) return false;

  let dev: string;
  try {
    dev = String(fs.statSync(dir).dev);
  } catch {
    return false;
  }
  const cached = probeCache.get(dev);
  if (cached !== undefined) return cached;

  let answer = false;
  let cur = dir;
  for (;;) {
    const flipped = flipCase(path.basename(cur));
    if (flipped) {
      answer = fs.existsSync(path.join(path.dirname(cur), flipped));
      break;
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  probeCache.set(dev, answer);
  return answer;
}

/**
 * Canonicalise an access subject. Returns `null` when the path cannot be
 * resolved — callers MUST treat that as "cannot be compared", never as "equal"
 * or "contained".
 *
 * `caseInsensitive` is injectable so tests can assert both volume behaviours
 * deterministically instead of depending on the machine running them.
 */
export function canonicalSubject(
  subject: string,
  opts?: { caseInsensitive?: boolean },
): CanonicalSubject | null {
  if (!subject) return null;
  let real: string;
  try {
    real = fs.realpathSync(path.resolve(subject));
  } catch {
    return null;
  }
  const caseInsensitive = opts?.caseInsensitive ?? volumeCaseInsensitive(real);
  const nfc = real.normalize("NFC");
  return {
    canonical: caseInsensitive ? nfc.toLowerCase() : nfc,
    caseInsensitive,
  };
}

/** Two subjects name the same object. Unresolvable subjects never match. */
export function isSameSubject(a: string, b: string, opts?: { caseInsensitive?: boolean }): boolean {
  const ca = canonicalSubject(a, opts);
  const cb = canonicalSubject(b, opts);
  if (!ca || !cb) return false;
  return ca.canonical === cb.canonical;
}

/**
 * Whether `candidate` lies inside `ancestor` (or IS it) — component-wise, so
 * `/repo-secrets` is not inside `/repo`.
 *
 * Both sides are canonicalised first, so the comparison is on the real object
 * in the volume's own form. An unresolvable side answers `false`: containment
 * is never inferred from an unresolved string.
 */
export function isSubjectWithin(
  candidate: string,
  ancestor: string,
  opts?: { caseInsensitive?: boolean },
): boolean {
  const cc = canonicalSubject(candidate, opts);
  const ca = canonicalSubject(ancestor, opts);
  if (!cc || !ca) return false;
  if (cc.canonical === ca.canonical) return true;
  const rel = path.relative(ca.canonical, cc.canonical);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
