/**
 * Pi runtime settings section — pick which discovered pi install each of the
 * TWO consumers uses:
 *   · Sessions spawn  → the `pi` executor  (blue)
 *   · Server imports  → the `pi-coding-agent` module (purple)
 *
 * One candidate list, two selection columns, plus a "Keep both in sync"
 * checkbox that is DERIVED from realpath'd package-directory equality and
 * persisted nowhere (design D7a). A stored flag could disagree with reality —
 * a pre-existing single-consumer override would open "checked" and one click
 * would silently clobber the user's pin. Deriving it makes that unrepresentable.
 *
 * Applying issues ONE `POST /api/pi/runtime` carrying both selections, so a
 * crash cannot leave the runtime split in half (design D7).
 *
 * Rendered immediately above `<ToolsSection />`: the picker is the curated
 * front door, Tools is the raw escape hatch (design D12).
 *
 * See change: select-pi-runtime-install.
 */

import { mdiAlert, mdiChevronDown, mdiChevronRight, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLaunchSource } from "../../hooks/useLaunchSource.js";
import { getApiBase } from "../../lib/api/api-context.js";
import {
	fetchPiInstalls,
	type PiInstallEntry,
	type PiInstallsResponse,
	setPiRuntime,
} from "../../lib/api/pi-runtime-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/** `null` = the Automatic row (no override for that consumer). */
type Selection = string | null;

const AUTO_KEY = "__automatic__";

function versionLabel(v: string | null): string {
	return v ?? i18nT("piRuntime.unknownVersion", undefined, "version unknown");
}

export function PiRuntimeSection() {
	const [data, setData] = useState<PiInstallsResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [advancedOpen, setAdvancedOpen] = useState(false);

	// Pending selections. `undefined` = untouched (use the server's state).
	const [pendingSpawn, setPendingSpawn] = useState<Selection | undefined>();
	const [pendingModule, setPendingModule] = useState<Selection | undefined>();
	// Linked state starts DERIVED from the server, then follows the user.
	const [linkedOverride, setLinkedOverride] = useState<boolean | undefined>();

	const [spawnCustom, setSpawnCustom] = useState("");
	const [moduleCustom, setModuleCustom] = useState("");
	const [restartOffer, setRestartOffer] = useState(false);
	const [sessionNote, setSessionNote] = useState<string | null>(null);
	const launchSource = useLaunchSource();

	const reload = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			const next = await fetchPiInstalls();
			setData(next);
			setPendingSpawn(undefined);
			setPendingModule(undefined);
			setLinkedOverride(undefined);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	// Sync is DERIVED: checked exactly when both consumers resolve to the same
	// package directory. A diverged pair therefore always opens unchecked.
	const linked = linkedOverride ?? (data?.inSync ?? true);

	const currentSpawn: Selection = useMemo(
		() =>
			pendingSpawn !== undefined
				? pendingSpawn
				: data?.spawn.pinned
					? (data.spawn.path ?? null)
					: null,
		[pendingSpawn, data],
	);
	const currentModule: Selection = useMemo(
		() =>
			pendingModule !== undefined
				? pendingModule
				: data?.module.pinned
					? (data.module.path ?? null)
					: null,
		[pendingModule, data],
	);

	const rowFor = useCallback(
		(sel: Selection): string => {
			if (sel === null) return AUTO_KEY;
			const hit = data?.installs.find(
				(i) => i.spawnEntry === sel || i.moduleEntry === sel,
			);
			return hit?.key ?? AUTO_KEY;
		},
		[data],
	);

	const spawnRow = rowFor(currentSpawn);
	const moduleRow = rowFor(currentModule);

	// The pending pair diverges when the two columns sit on different rows.
	const pendingDiverges = spawnRow !== moduleRow;

	const select = useCallback(
		(entry: PiInstallEntry | null, column: "spawn" | "module") => {
			const spawnValue = entry ? entry.spawnEntry : null;
			const moduleValue = entry ? entry.moduleEntry : null;
			if (linked) {
				// While linked, ONE click sets both — no reachable action can
				// produce differing lanes.
				setPendingSpawn(spawnValue);
				setPendingModule(moduleValue);
				return;
			}
			if (column === "spawn") setPendingSpawn(spawnValue);
			else setPendingModule(moduleValue);
		},
		[linked],
	);

	const apply = useCallback(
		async (spawn: Selection, module: Selection, importChanged: boolean) => {
			setBusy(true);
			setError(null);
			try {
				const next = await setPiRuntime({ spawn, module });
				setData(next);
				setPendingSpawn(undefined);
				setPendingModule(undefined);
				setLinkedOverride(undefined);
				setRestartOffer(importChanged);
				setSessionNote(await describeRunningSessions(data?.spawn.version ?? null));
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				setBusy(false);
			}
		},
		[data],
	);

	const onApply = useCallback(() => {
		if (!data) return;
		const importChanged = currentModule !== (data.module.pinned ? data.module.path : null);
		// Restate the resulting mismatch BEFORE the write. When both lanes
		// agree the confirmation must not claim one.
		const message = pendingDiverges
			? i18nT(
					"piRuntime.confirmMismatch",
					undefined,
					"This will leave sessions and the server on DIFFERENT pi installs. Apply anyway?",
				)
			: i18nT(
					"piRuntime.confirmApply",
					undefined,
					"Apply this pi runtime selection?",
				);
		if (!window.confirm(message)) return;
		void apply(currentSpawn, currentModule, importChanged);
	}, [apply, currentModule, currentSpawn, data, pendingDiverges]);

	const dirty =
		data !== null && (pendingSpawn !== undefined || pendingModule !== undefined);

	return (
		<div data-testid="pi-runtime-section">
			<h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 pb-1 border-b border-[var(--border-secondary)]">
				{i18nT("piRuntime.title", undefined, "Pi runtime")}
			</h2>

			{loading && (
				<div className="text-xs text-[var(--text-secondary)]">
					{i18nT("piRuntime.loading", undefined, "Loading pi installs…")}
				</div>
			)}

			{error && (
				// X13: the section degrades to an error state; the rest of
				// Settings keeps rendering because this is a leaf component.
				<div
					data-testid="pi-runtime-error"
					className="text-xs text-[var(--status-error)] flex items-center gap-1 py-2"
				>
					<Icon path={mdiAlert} size={0.6} />
					{i18nT(
						"piRuntime.loadFailed",
						undefined,
						"Could not load pi installs.",
					)}{" "}
					{error}
					<button
						type="button"
						onClick={() => void reload()}
						className="ml-2 px-2 py-0.5 border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)]"
					>
						<Icon path={mdiRefresh} size={0.6} />
					</button>
				</div>
			)}

			{data && !loading && (
				<div className="space-y-3">
					{/* Two consumer lanes. Blue = spawn, purple = import — the same
					    encoding the matrix columns use. */}
					<div className="flex flex-col sm:flex-row gap-2">
						<ConsumerLane
							testId="pi-lane-spawn"
							accent="var(--accent-blue, #3b82f6)"
							title={i18nT("piRuntime.laneSpawn", undefined, "Sessions spawn")}
							version={data.spawn.version}
							path={data.spawn.path}
							pinned={data.spawn.pinned}
						/>
						<ConsumerLane
							testId="pi-lane-import"
							accent="var(--accent-purple, #a855f7)"
							title={i18nT("piRuntime.laneImport", undefined, "Server imports")}
							version={data.module.version}
							path={data.module.path}
							pinned={data.module.pinned}
						/>
					</div>

					{launchSource === "electron" &&
						spawnRow !== "bare-import" &&
						spawnRow !== AUTO_KEY && (
							// Pointing outside the immutable Electron bundle is PERMITTED
							// but warned: the bundle remains the default and `Automatic`
							// still resolves to it.
							<div
								data-testid="pi-electron-bundle-warning"
								className="text-xs text-[var(--status-warning)] flex items-start gap-1 border border-[var(--border-secondary)] rounded p-2"
							>
								<Icon path={mdiAlert} size={0.6} />
								<span>
									{i18nT(
										"piRuntime.outsideBundle",
										undefined,
										"This install is outside the app bundle. The bundled pi is the tested one; selecting another is permitted but unsupported.",
									)}
								</span>
							</div>
						)}

					{data.consumerDiverged && (
						<div
							data-testid="pi-divergence-banner"
							className="text-xs text-[var(--status-warning)] flex items-start gap-1 border border-[var(--border-secondary)] rounded p-2"
						>
							<Icon path={mdiAlert} size={0.6} />
							<span>{data.divergenceMessage}</span>
						</div>
					)}

					<label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
						<input
							type="checkbox"
							data-testid="pi-keep-in-sync"
							checked={linked}
							onChange={(e) => setLinkedOverride(e.target.checked)}
						/>
						{i18nT("piRuntime.keepInSync", undefined, "Keep both in sync")}
					</label>

					{/* Candidate matrix. Below 680px each row collapses to
					    full-width metadata above two labelled cells. */}
					<div className="space-y-1" data-testid="pi-candidate-matrix">
						<CandidateRow
							entry={null}
							testId="pi-row-automatic"
							label={i18nT("piRuntime.automatic", undefined, "Automatic")}
							detail={`${versionLabel(data.spawn.version)} · ${
								data.spawn.path ??
								i18nT("piRuntime.unresolved", undefined, "unresolved")
							}`}
							spawnSelected={spawnRow === AUTO_KEY}
							moduleSelected={moduleRow === AUTO_KEY}
							disabledReason={null}
							onSelect={select}
						/>
						{data.installs
							.filter((i) => i.pkgDir !== null || i.spawnEntry !== null)
							.map((entry) => (
								<CandidateRow
									key={entry.key}
									entry={entry}
									testId={`pi-row-${entry.key}`}
									label={entry.label}
									detail={`${versionLabel(entry.version)} · ${
										entry.pkgDir ?? entry.spawnEntry ?? ""
									}`}
									spawnSelected={spawnRow === entry.key}
									moduleSelected={moduleRow === entry.key}
									disabledReason={
										entry.readOnly
											? i18nT(
													"piRuntime.readOnlyRow",
													undefined,
													"Read-only: shows what the chain currently resolves to.",
												)
											: entry.meetsFloor
												? null
												: i18nT(
														"piRuntime.belowFloor",
														{ minimum: data.floor },
														`Below the minimum supported pi version ${data.floor}.`,
													)
									}
									floorUnknown={entry.floorUnknown && entry.version === null}
									onSelect={select}
								/>
							))}
					</div>

					{/* Apply semantics are ASYMMETRIC and the UI says so (D8). */}
					<p className="text-[11px] text-[var(--text-tertiary)]">
						{i18nT(
							"piRuntime.applyNote",
							undefined,
							"A spawn change affects newly started sessions only. An import change needs a server restart.",
						)}
					</p>
					<p className="text-[11px] text-[var(--text-tertiary)]">
						{i18nT(
							"piRuntime.wslNote",
							undefined,
							"WSL sessions resolve pi inside WSL and are not covered by this selection.",
						)}
					</p>

					{sessionNote && (
						<p
							data-testid="pi-running-sessions"
							className="text-[11px] text-[var(--text-secondary)]"
						>
							{sessionNote}
						</p>
					)}

					{restartOffer && (
						<button
							type="button"
							data-testid="pi-restart-offer"
							onClick={() => {
								void fetch(`${getApiBase()}/api/restart`, { method: "POST" });
								setRestartOffer(false);
							}}
							className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)]"
						>
							{i18nT(
								"piRuntime.restartServer",
								undefined,
								"Restart the server to load the new pi",
							)}
						</button>
					)}

					<div className="flex items-center gap-2">
						<button
							type="button"
							data-testid="pi-apply"
							disabled={!dirty || busy}
							onClick={onApply}
							className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50"
						>
							{i18nT("common.apply", undefined, "Apply")}
						</button>
						<button
							type="button"
							onClick={() => void reload()}
							disabled={busy}
							className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] disabled:opacity-50 flex items-center gap-1"
						>
							<Icon path={mdiRefresh} size={0.6} />
							{i18nT("common.rescan", undefined, "Rescan")}
						</button>
					</div>

					{/* Advanced: raw paths, routed through the SAME validated write. */}
					<div>
						<button
							type="button"
							data-testid="pi-advanced-toggle"
							onClick={() => setAdvancedOpen((v) => !v)}
							className="text-xs text-[var(--text-secondary)] flex items-center gap-1"
						>
							<Icon
								path={advancedOpen ? mdiChevronDown : mdiChevronRight}
								size={0.6}
							/>
							{i18nT("common.advanced", undefined, "Advanced")}
						</button>
						{advancedOpen && (
							<div className="mt-2 space-y-2">
								<p className="text-[11px] text-[var(--text-tertiary)]">
									{i18nT(
										"piRuntime.advancedNote",
										undefined,
										"Custom paths are written to ~/.pi/dashboard/tool-overrides.json — the same file the Tools section edits.",
									)}
								</p>
								<CustomPathInput
									testId="pi-custom-spawn"
									label={i18nT(
										"piRuntime.customSpawn",
										undefined,
										"Custom spawn entry (pi)",
									)}
									value={spawnCustom}
									onChange={setSpawnCustom}
									onSubmit={() =>
										void apply(spawnCustom.trim() || null, currentModule, false)
									}
								/>
								<CustomPathInput
									testId="pi-custom-module"
									label={i18nT(
										"piRuntime.customImport",
										undefined,
										"Custom import entry (pi-coding-agent)",
									)}
									value={moduleCustom}
									onChange={setModuleCustom}
									onSubmit={() =>
										void apply(currentSpawn, moduleCustom.trim() || null, true)
									}
								/>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function ConsumerLane(props: {
	testId: string;
	accent: string;
	title: string;
	version: string | null;
	path: string | null;
	pinned: boolean;
}) {
	return (
		<div
			data-testid={props.testId}
			className="flex-1 border rounded p-2 min-w-0"
			style={{ borderColor: props.accent }}
		>
			<div className="text-xs font-medium text-[var(--text-primary)]">
				{props.title}
			</div>
			<div className="text-xs text-[var(--text-secondary)]">
				pi {versionLabel(props.version)}
				{props.pinned
					? ` · ${i18nT("piRuntime.pinned", undefined, "pinned")}`
					: ` · ${i18nT("piRuntime.automatic", undefined, "Automatic")}`}
			</div>
			<div className="text-[11px] font-mono text-[var(--text-tertiary)] truncate">
				{props.path ?? i18nT("piRuntime.unresolved", undefined, "unresolved")}
			</div>
		</div>
	);
}

function CandidateRow(props: {
	entry: PiInstallEntry | null;
	testId: string;
	label: string;
	detail: string;
	spawnSelected: boolean;
	moduleSelected: boolean;
	disabledReason: string | null;
	floorUnknown?: boolean;
	onSelect(entry: PiInstallEntry | null, column: "spawn" | "module"): void;
}) {
	const disabled = props.disabledReason !== null;
	return (
		<div
			data-testid={props.testId}
			// Below 680px: metadata full-width above two labelled cells.
			className="flex flex-col min-[680px]:flex-row min-[680px]:items-center gap-2 border border-[var(--border-secondary)] rounded p-2"
			title={props.disabledReason ?? undefined}
		>
			<div className="flex-1 min-w-0">
				<div className="text-xs text-[var(--text-primary)]">{props.label}</div>
				<div className="text-[11px] font-mono text-[var(--text-tertiary)] truncate">
					{props.detail}
				</div>
				{props.floorUnknown && (
					<div
						data-testid={`${props.testId}-unknown-version`}
						className="text-[11px] text-[var(--status-warning)]"
					>
						{i18nT(
							"piRuntime.unknownVersionWarning",
							undefined,
							"version unknown — not floor-checked",
						)}
					</div>
				)}
				{disabled && (
					<div
						data-testid={`${props.testId}-disabled-reason`}
						className="text-[11px] text-[var(--status-warning)]"
					>
						{props.disabledReason}
					</div>
				)}
			</div>
			<div className="flex gap-2">
				<SelectCell
					testId={`${props.testId}-spawn`}
					label={i18nT("piRuntime.colSpawn", undefined, "Spawn")}
					accent="var(--accent-blue, #3b82f6)"
					checked={props.spawnSelected}
					disabled={disabled}
					onSelect={() => props.onSelect(props.entry, "spawn")}
				/>
				<SelectCell
					testId={`${props.testId}-import`}
					label={i18nT("piRuntime.colImport", undefined, "Import")}
					accent="var(--accent-purple, #a855f7)"
					checked={props.moduleSelected}
					disabled={disabled}
					onSelect={() => props.onSelect(props.entry, "module")}
				/>
			</div>
		</div>
	);
}

function SelectCell(props: {
	testId: string;
	label: string;
	accent: string;
	checked: boolean;
	disabled: boolean;
	onSelect(): void;
}) {
	return (
		// min-h/min-w 44px: touch hit area at the 375px breakpoint.
		<button
			type="button"
			data-testid={props.testId}
			aria-pressed={props.checked}
			disabled={props.disabled}
			onClick={props.onSelect}
			className="flex items-center justify-center gap-1 text-[11px] rounded border px-2 disabled:opacity-40 disabled:cursor-not-allowed"
			style={{
				minHeight: 44,
				minWidth: 44,
				borderColor: props.checked ? props.accent : "var(--border-secondary)",
				color: props.checked ? props.accent : "var(--text-secondary)",
			}}
		>
			{props.checked ? "●" : "○"} {props.label}
		</button>
	);
}

function CustomPathInput(props: {
	testId: string;
	label: string;
	value: string;
	onChange(v: string): void;
	onSubmit(): void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-[11px] text-[var(--text-secondary)]">
				{props.label}
			</span>
			<div className="flex gap-1">
				<input
					data-testid={props.testId}
					value={props.value}
					onChange={(e) => props.onChange(e.target.value)}
					className="flex-1 px-2 py-1 text-xs bg-[var(--bg-input)] border border-[var(--border-secondary)] rounded font-mono"
				/>
				<button
					type="button"
					data-testid={`${props.testId}-save`}
					onClick={props.onSubmit}
					className="px-2 py-1 text-xs border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)]"
				>
					{i18nT("common.save", undefined, "Save")}
				</button>
			</div>
		</div>
	);
}

/**
 * Count running sessions still on the PREVIOUS pi version. Sessions whose
 * `piVersion` was never recorded are reported separately rather than folded
 * into the count — an unknown runtime is not evidence of the old one.
 */
async function describeRunningSessions(
	previousVersion: string | null,
): Promise<string | null> {
	try {
		const res = await fetch(`${getApiBase()}/api/sessions`);
		if (!res.ok) return null;
		const json = (await res.json()) as {
			data?: { sessions?: Array<{ piVersion?: string; status?: string }> };
		};
		const sessions = json.data?.sessions ?? [];
		const onPrevious = previousVersion
			? sessions.filter((s) => s.piVersion === previousVersion).length
			: 0;
		const unknown = sessions.filter((s) => !s.piVersion).length;
		if (onPrevious === 0 && unknown === 0) return null;
		const parts: string[] = [];
		if (onPrevious > 0) {
			parts.push(
				i18nT(
					"piRuntime.sessionsOnPrevious",
					{ count: String(onPrevious), version: previousVersion ?? "" },
					`${onPrevious} running session(s) still on pi ${previousVersion}.`,
				),
			);
		}
		if (unknown > 0) {
			parts.push(
				i18nT(
					"piRuntime.sessionsUnknownRuntime",
					{ count: String(unknown) },
					`${unknown} running session(s) with an unknown pi runtime.`,
				),
			);
		}
		return parts.join(" ");
	} catch {
		return null;
	}
}
