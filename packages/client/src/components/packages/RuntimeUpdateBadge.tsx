/**
 * Header badge for the Electron dashboard runtime: shown only when the runtime
 * is updatable (`runtime.updatable`) AND a newer release is available or one
 * is staged awaiting activation. Click → Settings → Packages.
 * Replaces PiUpdateBadge under Electron (E21).
 * See change: electron-runtime-overlay-updates.
 */
import { mdiArrowUpBold } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useLocation } from "wouter";
import { useRuntimeStatus } from "../../hooks/useRuntimeStatus.js";
import { t } from "../../lib/i18n/i18n.js";

export function RuntimeUpdateBadge() {
	const { status } = useRuntimeStatus();
	const [, navigate] = useLocation();
	if (!status?.runtime.updatable) return null;
	const { check, pending, runtime } = status;
	const available = check.state === "available" ? check.target : null;
	const staged = pending && pending !== runtime.id ? pending : null;
	const version = staged ?? available;
	if (!version) return null;
	const label = staged
		? t("runtime.badgeStaged", { v: version }, "Dashboard {v} ready to activate")
		: t("runtime.badgeAvailable", { v: version }, "Dashboard {v} available");
	return (
		<button
			type="button"
			onClick={() => navigate("/settings/packages")}
			className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 border border-[var(--accent-primary)]/40 transition-colors"
			title={label}
			aria-label={label}
			data-testid="runtime-update-badge"
		>
			<Icon path={mdiArrowUpBold} size={0.45} />
			<span>{version}</span>
		</button>
	);
}
