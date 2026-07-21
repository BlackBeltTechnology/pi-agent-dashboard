/**
 * Non-blocking advisory for pi-version skew, rendered in Settings → General.
 *
 * Three states driven by `/api/health.compatibility`:
 *  - hidden: compatibility null, OR no error and no upgrade hint
 *  - soft (amber pill): running below `recommended` (but at/above `minimum`)
 *  - hard (red panel): running below `minimum` (`error` set), with a
 *    copy-paste upgrade command disclosure
 *
 * See change: restore-pi-version-skew-surface.
 */
import { usePiCompatibility } from "../../hooks/usePiCompatibility.js";
import { useI18n } from "../../lib/i18n/i18n.js";

const PKG = "@earendil-works/pi-coding-agent";

export function PiVersionAdvisory() {
	const { t } = useI18n();
	const compat = usePiCompatibility();
	if (!compat) return null;
	if (!compat.error && !compat.upgradeRecommended) return null;

	const upgradeCmd = `npm install -g ${PKG}@${compat.recommended}`;

	if (compat.error) {
		return (
			<div
				role="alert"
				className="mb-3 rounded border border-red-500/40 bg-red-500/15 text-red-200 px-3 py-2 text-sm"
			>
				<div className="font-medium">{compat.error}</div>
				<details className="mt-1">
					<summary className="cursor-pointer text-red-300/90 text-xs">{t("common.howToUpgrade", undefined, "How to upgrade")}</summary>
					<code className="mt-1 block rounded bg-black/30 px-2 py-1 text-xs text-red-100 select-all">
						{upgradeCmd}
					</code>
				</details>
			</div>
		);
	}

	return (
		<div
			role="status"
			className="mb-3 rounded border border-amber-500/40 bg-amber-500/15 text-amber-200 px-3 py-2 text-sm flex items-center gap-2"
		>
			<span>
				{t("status.piVersionRecommended", { current: compat.current ?? "", recommended: compat.recommended ?? "" }, "pi {current} installed; {recommended} recommended.")}
			</span>
			<code className="rounded bg-black/20 px-1.5 py-0.5 text-xs text-amber-100 select-all">{upgradeCmd}</code>
		</div>
	);
}
