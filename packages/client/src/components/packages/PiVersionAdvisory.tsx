/**
 * Non-blocking advisory for pi-version skew, rendered in Settings → General.
 *
 * Three states driven by the `compatibility` prop (fed by the host panel's
 * single `usePiCompatibility` poll — the advisory no longer polls itself):
 *  - hidden: compatibility null, OR no error and no upgrade hint
 *  - soft (amber pill): running below `recommended` (but at/above `minimum`)
 *  - hard (red panel): running below `minimum` (`error` set), with a
 *    copy-paste upgrade command disclosure
 *
 * When `onChangeRuntime` is provided, both alert states also render the same
 * `Change…` affordance as the permanent runtime status row, pointing at the
 * picker on Settings → Developer. Without the prop the advisory renders
 * exactly as before. The triggering conditions and copy remain governed by
 * `pi-core-version-check`; this component owns the affordance only.
 *
 * See change: restore-pi-version-skew-surface, surface-pi-runtime-on-general.
 */
import { useI18n } from "../../lib/i18n/i18n.js";
import type { PiCompatibility } from "../../hooks/usePiCompatibility.js";

const PKG = "@earendil-works/pi-coding-agent";

export function PiVersionAdvisory({ compatibility, onChangeRuntime }: {
	compatibility: PiCompatibility | null;
	onChangeRuntime?: () => void;
}) {
	const { t } = useI18n();
	const compat = compatibility;
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
				{onChangeRuntime && (
					<button
						type="button"
						data-testid="pi-advisory-change"
						onClick={onChangeRuntime}
						className="mt-2 rounded border border-red-400/50 px-2 py-1 text-xs text-red-100 hover:bg-red-500/25"
					>
						{t("piRuntime.changeRuntime", undefined, "Change…")}
					</button>
				)}
			</div>
		);
	}

	return (
		<div
			role="status"
			className="mb-3 rounded border border-amber-500/40 bg-amber-500/15 text-amber-200 px-3 py-2 text-sm flex items-center gap-2 flex-wrap"
		>
			<span>
				{t("status.piVersionRecommended", { current: compat.current ?? "", recommended: compat.recommended ?? "" }, "pi {current} installed; {recommended} recommended.")}
			</span>
			<code className="rounded bg-black/20 px-1.5 py-0.5 text-xs text-amber-100 select-all">{upgradeCmd}</code>
			{onChangeRuntime && (
				<button
					type="button"
					data-testid="pi-advisory-change"
					onClick={onChangeRuntime}
					className="rounded border border-amber-400/50 px-2 py-1 text-xs text-amber-100 hover:bg-amber-500/25"
				>
					{t("piRuntime.changeRuntime", undefined, "Change…")}
				</button>
			)}
		</div>
	);
}
