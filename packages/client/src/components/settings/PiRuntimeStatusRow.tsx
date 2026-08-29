/**
 * Read-only pi runtime status row for Settings → General.
 *
 * The always-visible counterpart to the conditional PiVersionAdvisory: names
 * both consumers (Sessions spawn / Server imports) and the version each
 * resolves to, surfaces the server's `consumerMessage` verbatim when the
 * consumers diverge, and links to the picker on Settings → Developer via the
 * injected `onChangeRuntime` callback.
 *
 * Strictly read-only: it writes nothing — no `POST /api/pi/runtime`, no
 * `PUT`/`DELETE /api/tools/:name`, no `CONFIG_FIELD_PAGE` entry, no Save Bar
 * contribution — and it fetches nothing (renders purely from the `piRuntime`
 * prop; the host panel owns the single `/api/health` poll). It sources from
 * `/api/health`'s `piRuntime` shape, which carries versions + divergence only,
 * so it does NOT label a consumer automatic vs pinned — that distinction is
 * the picker's to render. `piRuntime` null/absent (older server, or discovery
 * failure) renders nothing.
 *
 * See change: surface-pi-runtime-on-general (design D1/D2).
 */
import { useI18n } from "../../lib/i18n/i18n.js";
import type { PiRuntimeHealth } from "../../hooks/usePiCompatibility.js";

export function PiRuntimeStatusRow({ piRuntime, onChangeRuntime }: {
	piRuntime: PiRuntimeHealth | null;
	onChangeRuntime: () => void;
}) {
	const { t } = useI18n();
	if (!piRuntime) return null;

	// Nullable server-side: unresolved consumers get the same fallback text the
	// picker renders — never a fabricated value.
	const version = (v: string | null) => v ?? t("piRuntime.unknownVersion", undefined, "version unknown");

	return (
		<div
			data-testid="pi-runtime-status-row"
			className="mb-3 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm"
		>
			<div className="font-medium text-[var(--text-primary)]">{t("piRuntime.title", undefined, "Pi runtime")}</div>
			<div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
				<span>{t("piRuntime.laneSpawn", undefined, "Sessions spawn")}</span>
				<span data-testid="pi-runtime-status-spawn">{version(piRuntime.spawnVersion)}</span>
				<span>{t("piRuntime.laneImport", undefined, "Server imports")}</span>
				<span data-testid="pi-runtime-status-import">{version(piRuntime.moduleVersion)}</span>
			</div>
			{piRuntime.consumerDiverged && piRuntime.consumerMessage != null && (
				<div
					role="status"
					data-testid="pi-runtime-status-warning"
					className="mt-1.5 rounded border border-amber-500/40 bg-amber-500/15 text-amber-200 px-2 py-1 text-xs"
				>
					{piRuntime.consumerMessage}
				</div>
			)}
			<button
				type="button"
				data-testid="pi-runtime-status-change"
				onClick={onChangeRuntime}
				className="mt-1.5 rounded border border-[var(--border-secondary)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
			>
				{t("piRuntime.changeRuntime", undefined, "Change…")}
			</button>
		</div>
	);
}
