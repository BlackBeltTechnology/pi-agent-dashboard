/**
 * Header badge showing a count of available pi core updates.
 * Hidden when there are no updates or when the status hasn't loaded yet.
 * Clicking navigates to Settings → Packages tab.
 */

import { mdiArrowUpBold } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { useLocation } from "wouter";
import { useLaunchSource } from "../../hooks/useLaunchSource.js";
import { usePiCoreVersions } from "../../hooks/usePiCoreVersions.js";

export function PiUpdateBadge() {
	const { status } = usePiCoreVersions();
	const [, navigate] = useLocation();
	// Electron bundles pi core; runtime updates live in Settings → Packages →
	// Dashboard runtime, never in this badge (E21). Unresolved (null) counts as
	// "maybe Electron" so the badge never flashes before the source is known.
	const launchSource = useLaunchSource();

	if (launchSource === null || launchSource === "electron") return null;
	if (!status || status.updatesAvailable === 0) return null;

	const count = status.updatesAvailable;
	const label = `${count} pi core update${count === 1 ? "" : "s"} available`;

	return (
		<button
			onClick={() => navigate("/settings/packages")}
			className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] hover:bg-[var(--accent-primary)]/30 border border-[var(--accent-primary)]/40 transition-colors"
			title={label}
			aria-label={label}
			data-testid="pi-update-badge"
		>
			<Icon path={mdiArrowUpBold} size={0.45} />
			<span>{count}</span>
		</button>
	);
}
