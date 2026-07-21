/**
 * Partial-success banner for composite package ops (move + reset).
 *
 * Shown when the install phase succeeded but the remove phase failed, leaving
 * the package registered in BOTH forms. Copy is kind-aware:
 *   - move  → "Installed at destination but failed to remove from <scope>".
 *   - reset → "Installed the published version but failed to remove the local link".
 *
 * See change: unify-package-management-ui (move), reset-override-to-npm (reset).
 */
import { mdiAlertCircle, mdiCloseCircle } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { MoveState } from "../../lib/nav/move-tracker.js";

export function PackagePartialSuccessBanner({
	state,
	onCleanup,
	onDismiss,
}: {
	state: MoveState;
	onCleanup: () => void;
	onDismiss: () => void;
}) {
	const isReset = state.kind === "reset";
	const title = isReset
		? i18nT("packages.resetPartiallySucceeded", undefined, "Reset partially succeeded")
		: i18nT("common.movePartiallySucceeded", undefined, "Move partially succeeded");
	const detail = isReset
		? `${i18nT("packages.installedPublishedButFailedToRemoveLink", undefined, "Installed the published version but failed to remove the local link")}: ${state.message}`
		: `${i18nT("packages.installedAtDestinationButFailedTo", undefined, "Installed at destination but failed to remove from")} ${state.fromScope}: ${state.message}`;
	const cleanupLabel = isReset
		? i18nT("packages.removeLocalLink", undefined, "Remove local link")
		: i18nT("common.cleanupOrigin", undefined, "Cleanup origin");

	return (
		<div
			className="mt-1 ml-2 px-2 py-1 rounded border border-amber-500/40 bg-amber-500/5 text-[10px] flex items-start gap-2"
			data-testid="installed-pkg-partial-success"
		>
			<Icon path={mdiAlertCircle} size={0.45} className="text-amber-400 flex-shrink-0 mt-0.5" />
			<div className="flex-1 min-w-0">
				<div className="text-amber-400 font-medium">{title}</div>
				<div className="text-[var(--text-muted)] truncate" title={state.message}>
					{detail}
				</div>
			</div>
			<button
				onClick={onCleanup}
				className="text-[var(--accent-primary)] hover:underline whitespace-nowrap"
			>
				{cleanupLabel}
			</button>
			<button
				onClick={onDismiss}
				className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
				aria-label={i18nT("common.dismiss", undefined, "Dismiss")}
			>
				<Icon path={mdiCloseCircle} size={0.45} />
			</button>
		</div>
	);
}
