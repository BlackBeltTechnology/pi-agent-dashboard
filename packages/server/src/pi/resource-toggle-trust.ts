/**
 * Project-trust gate for the resource-activation write.
 *
 * A project-scope toggle writes `<cwd>/.pi/settings.json`. pi ignores that file
 * entirely for a folder it does not trust, so writing it without a trust
 * decision reports success for a setting no real session will honour — the
 * exact failure this change exists to remove.
 *
 * The gate guarantees an **explicit recorded decision exists after the write**
 * (design D7). It deliberately does NOT mirror pi's read-side shortcut of
 * "a folder with no trust-requiring resources is trusted": writing
 * `settings.json` is itself what makes a folder trust-requiring, so that
 * shortcut would let the write succeed and the next session then find a
 * trust-requiring folder with no recorded decision.
 *
 * Order: a recorded decision decides; otherwise `defaultProjectTrust` decides,
 * where `always` proceeds **without recording** (a user who chose `always`
 * chose it to avoid prompts, not to enrol every folder they toggled into a
 * durable trust record), `never` refuses without prompting, and `ask` prompts.
 *
 * The offered options are dashboard-authored: pi's `getProjectTrustOptions`
 * and `getProjectTrustParentPath` are not reachable through the package's
 * `exports` map (only `ProjectTrustStore` and `hasTrustRequiringProjectResources`
 * are). The choices mirror pi's, and the decision is persisted through pi's own
 * store, so the recorded result is indistinguishable from one pi wrote.
 * Session-only options are not offered: the artefact being written is
 * persistent and would outlive its own permission.
 *
 * See change: project-scope-disable-global-resources.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getPiCore, type PiSettingsManager } from "./pi-resource-activation.js";

/** pi records trust under the canonicalized folder path; match that spelling. */
function canonical(p: string): string {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

/** One update to pi's trust store, mirroring pi's `ProjectTrustUpdate`. */
export interface TrustUpdate {
  path: string;
  decision: boolean | null;
}

/** A choice the trust dialog offers. Mirrors pi's `ProjectTrustOption`. */
export interface TrustOption {
  id: "trust" | "trust-parent" | "decline";
  label: string;
  trusted: boolean;
  updates: TrustUpdate[];
}

export type TrustGateResult =
  | { outcome: "proceed" }
  | { outcome: "refused"; error: string }
  | { outcome: "prompt"; options: TrustOption[]; implicitlyTrusted: boolean; message: string };

/** Dashboard-authored equivalents of pi's own trust options, minus session-only. */
export function trustOptionsFor(cwd: string): TrustOption[] {
  // Canonical spelling, matching how pi's store normalises its keys — a
  // symlinked project would otherwise write one record and read another, and
  // prompt again immediately after approval.
  const target = canonical(cwd);
  const parent = path.dirname(target);
  const options: TrustOption[] = [
    { id: "trust", label: "Trust", trusted: true, updates: [{ path: target, decision: true }] },
  ];
  if (parent !== target) {
    options.push({
      id: "trust-parent",
      label: `Trust parent folder (${parent})`,
      trusted: true,
      updates: [
        { path: parent, decision: true },
        { path: target, decision: null },
      ],
    });
  }
  // Declining records nothing: the toggle is simply abandoned, leaving the
  // folder exactly as it was rather than enrolling a standing refusal the user
  // did not ask for.
  options.push({ id: "decline", label: "Do not trust", trusted: false, updates: [] });
  return options;
}

const IMPLICIT_NOTE =
  "This folder is trusted implicitly today because it has no pi project configuration. " +
  "Saving this setting creates .pi/settings.json, so pi will require an explicit trust " +
  "decision for this folder from now on.";

const EXPLICIT_NOTE =
  "pi only applies a folder's .pi/settings.json when the folder is trusted. " +
  "Choose how to trust this folder before the setting is written.";

const INHERITED_REFUSAL_NOTE =
  "A parent folder is recorded as not trusted, so pi treats this folder as untrusted too " +
  "and would ignore the setting. Trust this folder explicitly to override that.";

/**
 * Resolve trust for a project-scope toggle. Never writes settings; on `prompt`
 * the caller must return the options to the client and retry after the decision
 * has been persisted via `persistTrustDecision`.
 */
export async function resolveToggleTrust(
  cwd: string,
  agentDir: string,
  settingsManager: PiSettingsManager,
): Promise<TrustGateResult> {
  const { ProjectTrustStore, hasTrustRequiringProjectResources } = await getPiCore();
  const entry = new ProjectTrustStore(agentDir).getEntry(cwd);
  // pi resolves the *nearest ancestor* decision, so a refusal may have been
  // recorded for a parent folder. Only a refusal recorded for this folder
  // itself is final — an inherited one is overridable by trusting this folder,
  // exactly as pi's own prompt allows.
  const recordedHere = entry && canonical(entry.path) === canonical(cwd) ? entry.decision : null;
  if (entry?.decision === true) return { outcome: "proceed" };
  if (recordedHere === false) {
    return {
      outcome: "refused",
      error:
        "This folder is recorded as not trusted, so pi would ignore the setting. " +
        "Trust the folder in pi before changing its resource activation.",
    };
  }

  // An INHERITED refusal means pi currently resolves this folder as untrusted,
  // so no default may silently proceed over it — `always` would write a file pi
  // then ignores, which is the false success this gate exists to remove. The
  // user is prompted instead, and can override by trusting this folder itself
  // (exactly what pi's own prompt allows).
  const inheritedRefusal = entry?.decision === false;
  const dflt = settingsManager.getDefaultProjectTrust();
  if (dflt === "always" && !inheritedRefusal) return { outcome: "proceed" };
  if (dflt === "never") {
    return {
      outcome: "refused",
      error:
        "defaultProjectTrust is 'never', so pi would ignore this folder's settings. " +
        "Trust the folder explicitly before changing its resource activation.",
    };
  }

  const implicitlyTrusted = !inheritedRefusal && !hasTrustRequiringProjectResources(cwd);
  return {
    outcome: "prompt",
    options: trustOptionsFor(cwd),
    implicitlyTrusted,
    message: inheritedRefusal ? INHERITED_REFUSAL_NOTE : implicitlyTrusted ? IMPLICIT_NOTE : EXPLICIT_NOTE,
  };
}

/** Persist a chosen option's updates through pi's own trust store. */
export async function persistTrustDecision(agentDir: string, updates: TrustUpdate[]): Promise<void> {
  const { ProjectTrustStore } = await getPiCore();
  new ProjectTrustStore(agentDir).setMany(updates);
}
