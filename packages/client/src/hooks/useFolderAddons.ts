/**
 * State machine of the folder Add-ons page: loads the folder catalog and owns
 * the per-folder switch flow.
 *
 * A switch never flips locally before the server confirms: on success the
 * catalog is re-read (so the strip and rows come from one source of truth), on
 * any failure the row keeps its prior state and shows the server message inline.
 * A 403 `trustRequired` opens the existing trust dialog and, once the decision is
 * recorded, replays the same toggle. `keptOn` and `notOwned` replies are kept
 * per row (the switch stays; the row names the requiring feature, or offers the
 * confirmed "Remove this folder entry" retry with `removeUnowned`).
 *
 * See change: addons-hub-folder-view (design D1, D3, D4; spec: addons-folder-view).
 */
import type { AddonFeature, AddonFolderInfo, AddonFolderNotOwned } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ResourceTrustOption, submitResourceTrust } from "../lib/api/resources-api.js";
import { fetchFolderAddonCatalog, postFolderToggle } from "../lib/addons/addons-api.js";
import { logRejection } from "../lib/report-error.js";

export interface FolderTrustPrompt {
	message: string;
	options: ResourceTrustOption[];
	implicitlyTrusted: boolean;
	preselected?: "trust";
	dashboardSource?: string;
}

export interface FolderNotOwnedPrompt {
	featureId: string;
	items: AddonFolderNotOwned[];
}

interface PendingToggle {
	featureId: string;
	enabled: boolean;
}

export interface KeptOnNote {
	/** Feature ids of the features whose requirement keeps the package on. */
	by: string[];
}

const EMPTY_FOLDER = (cwd: string): AddonFolderInfo => ({
	cwd,
	looseCounts: { skills: 0, agents: 0, prompts: 0, extensions: 0, themes: 0 },
});

export function useFolderAddons(cwd: string) {
	const [features, setFeatures] = useState<AddonFeature[]>([]);
	const [folder, setFolder] = useState<AddonFolderInfo>(EMPTY_FOLDER(cwd));
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
	const [keptOn, setKeptOn] = useState<Record<string, KeptOnNote>>({});
	const [notOwned, setNotOwned] = useState<FolderNotOwnedPrompt | null>(null);
	const [trustPrompt, setTrustPrompt] = useState<FolderTrustPrompt | null>(null);
	const [reloadOffered, setReloadOffered] = useState(false);
	const deferred = useRef<PendingToggle | null>(null);
	const mounted = useRef(true);
	const latest = useRef(0);

	const refresh = useCallback(async () => {
		const request = ++latest.current;
		try {
			const next = await fetchFolderAddonCatalog(cwd);
			if (!mounted.current || request !== latest.current) return;
			setFeatures(next.features);
			setFolder(next.folder);
			setError(null);
		} catch (err) {
			if (mounted.current) setError((err as Error).message);
		} finally {
			if (mounted.current) setIsLoading(false);
		}
	}, [cwd]);

	useEffect(() => {
		mounted.current = true;
		void refresh().catch(logRejection("useFolderAddons.mount"));
		const onEvent = (e: Event) => {
			const msg = (e as CustomEvent).detail;
			if (msg?.type === "package_operation_complete" && msg.success) void refresh().catch(logRejection("useFolderAddons.event"));
		};
		window.addEventListener("pi-package-event", onEvent);
		return () => {
			mounted.current = false;
			window.removeEventListener("pi-package-event", onEvent);
		};
	}, [refresh]);

	const setRowError = (id: string, message: string | null) =>
		setRowErrors((m) => {
			const next = { ...m };
			if (message === null) delete next[id];
			else next[id] = message;
			return next;
		});

	const run = useCallback(
		async (featureId: string, enabled: boolean, opts: { removeUnowned?: boolean } = {}): Promise<void> => {
			setBusyId(featureId);
			setRowError(featureId, null);
			setKeptOn((m) => {
				const next = { ...m };
				delete next[featureId];
				return next;
			});
			try {
				const out = await postFolderToggle(featureId, cwd, enabled, opts);
				if (out.kind === "trust") {
					deferred.current = { featureId, enabled };
					setTrustPrompt({
						message: out.message,
						options: out.options,
						implicitlyTrusted: out.implicitlyTrusted,
						...(out.preselected ? { preselected: out.preselected } : {}),
						...(out.dashboardSource ? { dashboardSource: out.dashboardSource } : {}),
					});
					return;
				}
				if (out.kind === "error") {
					setRowError(featureId, out.error);
					return;
				}
				const r = out.report;
				if (r.keptOn.length > 0) setKeptOn((m) => ({ ...m, [featureId]: { by: [...new Set(r.keptOn.flatMap((k) => k.by))] } }));
				if (r.notOwned.length > 0) setNotOwned({ featureId, items: r.notOwned });
				else setNotOwned((cur) => (cur?.featureId === featureId ? null : cur));
				if (r.changed) setReloadOffered(true);
				await refresh();
			} catch (err) {
				// The request never reached the server: the row keeps its prior state.
				setRowError(featureId, (err as Error)?.message ?? "The request did not reach the server.");
			} finally {
				if (mounted.current) setBusyId((cur) => (cur === featureId ? null : cur));
			}
		},
		[cwd, refresh],
	);

	/**
	 * Flip a From Global row: on → off; off → on. A partly-off row whose off packages
	 * all have restore records (we turned them off; another feature keeps the rest on)
	 * goes back on, otherwise it is turned fully off.
	 */
	const toggle = useCallback(
		(f: AddonFeature) =>
			void run(f.id, f.folderState === "off-here" || (f.folderState === "partly-off-here" && f.restoreRecorded === true)),
		[run],
	);

	const turnOn = useCallback((featureId: string) => void run(featureId, true), [run]);

	const confirmRemoveUnowned = useCallback(() => {
		if (!notOwned) return;
		const id = notOwned.featureId;
		setNotOwned(null);
		void run(id, true, { removeUnowned: true });
	}, [notOwned, run]);

	const resolveTrust = useCallback(
		(optionId: ResourceTrustOption["id"]) => {
			const pending = deferred.current;
			deferred.current = null;
			setTrustPrompt(null);
			if (optionId === "decline" || !pending) return;
			void (async () => {
				try {
					const res = await submitResourceTrust(cwd, optionId);
					if (!res.ok) {
						setRowError(pending.featureId, res.error ?? `Could not record the trust decision (${res.status})`);
						return;
					}
					await run(pending.featureId, pending.enabled);
				} catch (err) {
					setRowError(pending.featureId, (err as Error)?.message ?? "The request did not reach the server.");
				}
			})();
		},
		[cwd, run],
	);

	const dismissTrust = useCallback(() => {
		deferred.current = null;
		setTrustPrompt(null);
	}, []);

	return {
		features,
		folder,
		isLoading,
		error,
		busyId,
		rowErrors,
		keptOn,
		notOwned,
		trustPrompt,
		reloadOffered,
		dismissReload: () => setReloadOffered(false),
		dismissNotOwned: () => setNotOwned(null),
		refresh,
		toggle,
		turnOn,
		confirmRemoveUnowned,
		resolveTrust,
		dismissTrust,
	};
}
