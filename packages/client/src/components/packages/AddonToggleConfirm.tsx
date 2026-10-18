/**
 * Combined feature toggle UX: dry run → confirmation dialog → toggle with the
 * report's `confirmToken` → session-reload offer.
 *
 * - Switching a feature OFF first asks the server for a dry run; when the report
 *   has anything to say (a pi part, a cascade, kept-on packages, requiring
 *   plugins, folders that keep loading) the dialog names it and nothing is
 *   written until the user confirms.
 * - A 409 `stale-confirmation` re-renders the dialog with the fresh report.
 * - A successful toggle with `restartRequired` offers the existing session
 *   reload once (`POST /api/resources/reload`).
 *
 * See change: addons-hub-feature-catalog (test-plan #F2, #F3, #F5).
 */
import type { AddonFeature, AddonToggleResponse } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useMemo, useState } from "react";
import { postAddonToggle } from "../../lib/addons/addons-api.js";
import { reloadResourceSessions } from "../../lib/api/resources-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

export interface PendingToggle {
	feature: AddonFeature;
	report: AddonToggleResponse;
	busy: boolean;
	error?: string;
}

export const rowAnchorId = (featureId: string) => `addon-row-${featureId.replace(/[^a-z0-9]/gi, "-")}`;

export function useAddonToggle(features: readonly AddonFeature[], refresh: () => Promise<unknown>) {
	const [pending, setPending] = useState<PendingToggle | null>(null);
	const [reloadOffered, setReloadOffered] = useState(false);
	const [rowError, setRowError] = useState<{ featureId: string; message: string } | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);

	const finish = useCallback(
		async (report: AddonToggleResponse) => {
			setPending(null);
			if (report.restartRequired) setReloadOffered(true);
			await refresh();
		},
		[refresh],
	);

	const send = useCallback(
		async (feature: AddonFeature, enabled: boolean, confirmToken?: string) => {
			setBusyId(feature.id);
			try {
				const out = await postAddonToggle(feature.id, { enabled, ...(confirmToken ? { confirmToken } : {}) });
				if (out.kind === "ok") {
					setRowError(null);
					await finish(out.report);
				} else if (out.kind === "stale") {
					setPending({ feature, report: out.report, busy: false });
				} else {
					const message =
						out.reason === "blockers" && out.blockers
							? i18nT("addons.toggle.blocked", { names: out.blockers.join(", ") }, `Needs ${out.blockers.join(", ")} first.`)
							: out.error;
					if (pending) setPending({ ...pending, busy: false, error: message });
					else setRowError({ featureId: feature.id, message });
				}
			} catch (err) {
				setRowError({ featureId: feature.id, message: (err as Error).message });
			} finally {
				setBusyId(null);
			}
		},
		[finish, pending],
	);

	/** The row's switch was activated. `partial` counts as "on" → off. */
	const request = useCallback(
		async (feature: AddonFeature) => {
			const turnOff = feature.state !== "off";
			if (!turnOff) {
				await send(feature, true);
				return;
			}
			setBusyId(feature.id);
			try {
				const out = await postAddonToggle(feature.id, { enabled: false, dryRun: true });
				if (out.kind === "error") {
					setRowError({ featureId: feature.id, message: out.error });
					return;
				}
				const r = out.report;
				const quiet =
					feature.packages.length === 0 &&
					r.cascaded.length === 0 &&
					r.keptOn.length === 0 &&
					r.requiredBy.length === 0 &&
					r.stillLoadedIn.length === 0;
				if (quiet) {
					await send(feature, false, r.confirmToken);
					return;
				}
				setPending({ feature, report: r, busy: false });
			} catch (err) {
				setRowError({ featureId: feature.id, message: (err as Error).message });
			} finally {
				setBusyId(null);
			}
		},
		[send],
	);

	const confirm = useCallback(async () => {
		if (!pending) return;
		setPending({ ...pending, busy: true, error: undefined });
		await send(pending.feature, false, pending.report.confirmToken);
	}, [pending, send]);

	const cancel = useCallback(() => setPending(null), []);
	const dismissReload = useCallback(() => setReloadOffered(false), []);
	const byId = useMemo(() => new Map(features.map((f) => [f.id, f] as const)), [features]);

	return { pending, request, confirm, cancel, reloadOffered, dismissReload, rowError, busyId, byId };
}

function nameOf(byId: ReadonlyMap<string, AddonFeature>, id: string): string {
	return byId.get(id)?.displayName ?? id;
}

function FeatureLink({ byId, id }: { byId: ReadonlyMap<string, AddonFeature>; id: string }) {
	return (
		<a href={`#${rowAnchorId(id)}`} className="text-[var(--accent-primary)] hover:underline">
			{nameOf(byId, id)}
		</a>
	);
}

interface AddonToggleConfirmProps {
	pending: PendingToggle;
	byId: ReadonlyMap<string, AddonFeature>;
	onConfirm: () => void;
	onCancel: () => void;
}

export function AddonToggleConfirm({ pending, byId, onConfirm, onCancel }: AddonToggleConfirmProps) {
	const { feature, report, busy, error } = pending;
	const stops: string[] = [];
	if (feature.plugin) stops.push(i18nT("addons.toggle.stopsDashboard", undefined, "the dashboard UI"));
	if (feature.packages.length > 0) stops.push(i18nT("addons.toggle.stopsAgent", undefined, "the AI-agent part (pi extension)"));
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="addon-toggle-title"
			className="mb-2 p-3 rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] text-xs space-y-2"
			data-testid="addon-toggle-confirm"
		>
			<h3 id="addon-toggle-title" className="font-semibold text-[var(--text-primary)]">
				{i18nT("addons.toggle.title", { name: feature.displayName }, `Turn off ${feature.displayName}?`)}
			</h3>
			{stops.length > 0 && (
				<p className="text-[var(--text-secondary)]" data-testid="addon-toggle-stops">
					{i18nT("addons.toggle.stops", { parts: stops.join(` ${i18nT("common.and", undefined, "and")} `) }, `This stops ${stops.join(" and ")}.`)}
				</p>
			)}
			{report.filtered.length > 0 && (
				<p className="text-[var(--text-muted)]">
					{i18nT("addons.toggle.filtered", { sources: report.filtered.join(", ") }, `Stops loading in pi: ${report.filtered.join(", ")}.`)}
				</p>
			)}
			{report.cascaded.length > 0 && (
				<p className="text-[var(--text-secondary)]" data-testid="addon-toggle-cascaded">
					{i18nT("addons.toggle.cascaded", undefined, "These features depend on it and turn off too:")}{" "}
					{report.cascaded.map((id, i) => (
						<span key={id}>
							{i > 0 && ", "}
							{nameOf(byId, id)}
						</span>
					))}
				</p>
			)}
			{report.keptOn.map((k) => (
				<p key={k.source} className="text-[var(--text-secondary)]" data-testid="addon-toggle-kept-on">
					{i18nT("addons.toggle.keptOn", { source: k.source }, `${k.source} stays on because it is required by`)}{" "}
					{k.by.map((id, i) => (
						<span key={id}>
							{i > 0 && ", "}
							<FeatureLink byId={byId} id={id} />
						</span>
					))}
					.
				</p>
			))}
			{report.requiredBy.length > 0 && (
				<p className="text-[var(--text-secondary)]" data-testid="addon-toggle-required-by">
					{i18nT("addons.toggle.requiredBy", undefined, "These features need it and may stop working:")}{" "}
					{report.requiredBy.map((id, i) => (
						<span key={id}>
							{i > 0 && ", "}
							<FeatureLink byId={byId} id={id} />
						</span>
					))}
				</p>
			)}
			{report.stillLoadedIn.map((s) => (
				<p key={s.source} className="text-[var(--text-muted)]" data-testid="addon-toggle-folders">
					{i18nT(
						"addons.toggle.stillLoaded",
						{ source: s.source },
						`${s.source} keeps loading in these folders the dashboard knows:`,
					)}{" "}
					<span className="font-mono">{s.folders.join(", ")}</span>
				</p>
			))}
			{error && (
				<p role="alert" className="text-red-400">
					{error}
				</p>
			)}
			<div className="flex justify-end gap-2">
				<button
					type="button"
					onClick={onCancel}
					className="px-2 py-1 rounded text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
					data-testid="addon-toggle-cancel"
				>
					{i18nT("common.cancel", undefined, "Cancel")}
				</button>
				<button
					type="button"
					onClick={onConfirm}
					disabled={busy}
					className="px-2 py-1 rounded bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 disabled:opacity-50"
					data-testid="addon-toggle-confirm-button"
				>
					{i18nT("addons.toggle.confirm", undefined, "Turn off")}
				</button>
			</div>
		</div>
	);
}

/** One-click "Reload sessions" offer shown after a toggle that needs it. */
export function AddonReloadBanner({ onDismiss }: { onDismiss: () => void }) {
	const [state, setState] = useState<"idle" | "busy" | "done">("idle");
	return (
		<div
			className="flex items-center gap-2 px-2 py-1.5 mb-2 rounded bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-xs"
			data-testid="addon-reload-banner"
		>
			<button
				type="button"
				disabled={state === "busy"}
				onClick={() => {
					setState("busy");
					void reloadResourceSessions("global")
						.then(() => setState("done"))
						.catch(() => setState("idle"));
				}}
				className="flex items-center gap-1 font-medium text-[var(--accent-primary)] hover:underline"
				data-testid="addon-reload-button"
			>
				<Icon path={mdiRefresh} size={0.5} />
				{state === "done"
					? i18nT("addons.reload.done", undefined, "Sessions reloaded")
					: i18nT("addons.reload.offer", undefined, "Reload sessions to apply")}
			</button>
			<button type="button" onClick={onDismiss} className="ml-auto text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
				{i18nT("common.dismiss", undefined, "Dismiss")}
			</button>
		</div>
	);
}
