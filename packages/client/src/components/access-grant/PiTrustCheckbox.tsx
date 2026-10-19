/**
 * "Also trust this folder in pi" — the per-entry consent checkbox shown in every
 * dialog that creates a mirrorable dashboard-trust entry (worktree-init "Always
 * trust", workflow trust, pin folder, Add Folder, access-grant prompt "always").
 *
 * Pre-set from the source default in `piTrustMirror.sources`; states the
 * consequence plainly: trusting lets EVERY project extension and MCP server in the
 * folder and below — including ones added later — start with pi, which is wider
 * than approving one hook script.
 *
 * See change: mirror-dashboard-trust-to-pi.
 */
import type { MirrorSourceKind } from "@blackbelt-technology/pi-dashboard-shared/pi-trust-mirror-types.js";
import { useEffect, useId, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  DEFAULT_PI_TRUST_MIRROR_SETTINGS,
  fetchPiTrustMirrorConfig,
} from "../../lib/pi-trust-mirror/pi-trust-mirror-api.js";

/**
 * Checkbox state seeded from the source default (defaults while the config loads;
 * a change the operator already made is never overwritten by the late fetch).
 */
export function usePiTrustChoice(source: MirrorSourceKind): [boolean, (v: boolean) => void] {
  const [checked, setChecked] = useState<boolean>(DEFAULT_PI_TRUST_MIRROR_SETTINGS.sources[source]);
  const touched = useRef(false);
  useEffect(() => {
    let live = true;
    void fetchPiTrustMirrorConfig().then((cfg) => {
      if (live && !touched.current) setChecked(cfg.sources[source]);
    });
    return () => {
      live = false;
    };
  }, [source]);
  return [
    checked,
    (v) => {
      touched.current = true;
      setChecked(v);
    },
  ];
}

interface Props {
  checked: boolean;
  onChange: (value: boolean) => void;
  testId?: string;
}

export function PiTrustCheckbox({ checked, onChange, testId = "pi-trust-checkbox" }: Props) {
  const id = useId();
  return (
    <div className="flex items-start gap-2 text-xs text-[var(--text-secondary)]" data-testid={`${testId}-wrap`}>
      <input
        id={id}
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="text-[var(--text-primary)]">
          {i18nT("piTrust.checkbox", undefined, "Also trust this folder in pi")}
        </span>
        <span className="text-[var(--text-tertiary)]" data-testid={`${testId}-consequence`}>
          {i18nT(
            "piTrust.consequence",
            undefined,
            "Lets every project extension and MCP server in this folder and below, including ones added later, start with pi. This is wider than approving one hook script.",
          )}
        </span>
      </label>
    </div>
  );
}
