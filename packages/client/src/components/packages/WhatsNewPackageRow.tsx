/**
 * PackageRow wrapper that wires the What's-New changelog affordance for
 * ANY installed package, not just pi core.
 *
 * Owns its own `usePiChangelog` hook + `WhatsNewDialog` state so it can
 * be rendered inside a `.map()` (hooks cannot run in a loop in the
 * parent). When the package has no locatable CHANGELOG the query returns
 * an empty release list, `whatsNewKind` stays `undefined`, and no icon
 * renders — silent skip, no warning.
 *
 * See change: extend-whats-new-to-all-packages.
 */
import React, { useMemo, useState } from "react";
import { PackageRow, type PackageRowProps } from "./PackageRow.js";
import { WhatsNewDialog } from "./WhatsNewDialog.js";
import { usePiChangelog } from "../../hooks/usePiChangelog.js";

/** Sentinel upper bound: "every release newer than the installed one". */
const OPEN_UPPER_BOUND = "9999.0.0";

export interface WhatsNewPackageRowProps {
	/** Full pass-through props for the underlying PackageRow. */
	rowProps: PackageRowProps;
	/** npm package name used for the changelog query (e.g. `pi-web-access`). */
	changelogPkg: string | null;
	/** Installed (current) version — lower bound of the `(from, to]` range. */
	currentVersion: string | undefined;
	/** Upper bound. Defaults to a sentinel that includes all newer releases. */
	latestVersion?: string;
	/** Only query when true (typically `updateAvailable`). */
	enabled: boolean;
	/** Display name shown in the dialog header. */
	dialogDisplayName: string;
	/** CTA handler invoked by the dialog's Update button. Required: the
	 * `WhatsNewDialog` calls it unconditionally. */
	onUpdate: () => void;
}

export function WhatsNewPackageRow({
	rowProps,
	changelogPkg,
	currentVersion,
	latestVersion,
	enabled,
	dialogDisplayName,
	onUpdate,
}: WhatsNewPackageRowProps) {
	const to = latestVersion ?? OPEN_UPPER_BOUND;
	const queryEnabled = enabled && !!changelogPkg && !!currentVersion;
	const changelog = usePiChangelog(
		changelogPkg ?? "",
		currentVersion,
		to,
		{ enabled: queryEnabled },
	);

	const whatsNewKind = useMemo<"breaking" | "info" | undefined>(() => {
		if (!changelog.data) return undefined;
		if (changelog.data.hasBreaking) return "breaking";
		if (changelog.data.releases.length > 0) return "info";
		return undefined;
	}, [changelog.data]);

	const breakingChangeCount = useMemo(() => {
		if (!changelog.data || !changelog.data.hasBreaking) return 0;
		return changelog.data.releases.reduce((s, r) => s + r.breaking.length, 0);
	}, [changelog.data]);

	const [open, setOpen] = useState(false);

	return (
		<>
			<PackageRow
				{...rowProps}
				breakingChangeCount={whatsNewKind ? breakingChangeCount : undefined}
				whatsNewKind={whatsNewKind}
				onShowWhatsNew={whatsNewKind ? () => setOpen(true) : undefined}
			/>
			{open && changelog.data && (
				<WhatsNewDialog
					open={open}
					response={changelog.data}
					displayName={dialogDisplayName}
					latestVersion={changelog.data.releases[0]?.version ?? changelog.data.to}
					onClose={() => setOpen(false)}
					onUpdate={onUpdate}
				/>
			)}
		</>
	);
}
