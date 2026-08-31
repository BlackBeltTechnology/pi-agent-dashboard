/**
 * Node runtime family settings section — pick ONE Node installation; the
 * `node`, `npm`, and `npx` overrides are written from that ONE selection
 * in a single atomic persist (spec: "One selection writes the whole
 * family atomically").
 *
 * The picker reports family coherence: when the three members resolve
 * into different installation roots the section says so, naming the
 * deviating member and its root. A hand-set member is reported BEFORE
 * the write (confirm dialog restates the deviation) and is preserved
 * unless the user explicitly discards it — per-tool overrides remain
 * supported (design D5/D6).
 *
 * Mounted adjacent to `<PiRuntimeSection />` (pi picker precedent):
 * one curated selection surface per family, Tools as the raw escape
 * hatch.
 *
 * See change: add-node-runtime-family-selection.
 */

import { mdiAlert, mdiCheck, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import {
	fetchNodeInstalls,
	type NodeInstallsResponse,
	selectNodeRuntime,
} from "../../lib/api/node-runtime-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="mb-6" data-testid="node-runtime-section">
			<div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] mb-2">{title}</div>
			<div className="border border-[var(--border-secondary)] rounded-lg divide-y divide-[var(--border-secondary)]">
				{children}
			</div>
		</div>
	);
}

export function NodeRuntimeSection() {
	const [data, setData] = useState<NodeInstallsResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	/** Pending selection: root + the user's per-member discard decisions. */
	const [pendingRoot, setPendingRoot] = useState<string | null>(null);
	const [discard, setDiscard] = useState<string[]>([]);

	const reload = useCallback(async () => {
		try {
			setLoading(true);
			setError(null);
			setData(await fetchNodeInstalls());
			setPendingRoot(null);
			setDiscard([]);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	const coherence = data?.coherence;
	const pendingCandidate = data?.candidates.find((c) => c.root === pendingRoot);
	// Pre-write report: the SERVER pre-computed this candidate's true plan
	// (review round-2 concern 1 — the current coherence report's deviations
	// describe the OLD selection, not the pending one).
	const pendingHandSet = pendingCandidate?.pendingHandSet ?? [];

	const apply = async () => {
		if (!pendingRoot) return;
		setBusy(true);
		try {
			await selectNodeRuntime({ root: pendingRoot, discardHandSet: discard });
			await reload();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	if (loading && !data) {
		return (
			<Section title={i18nT("nodeRuntime.title", undefined, "Node runtime")}>
				<div className="px-3 py-2 text-xs text-[var(--text-secondary)]">
					{i18nT("common.loading", undefined, "Loading…")}
				</div>
			</Section>
		);
	}

	return (
		<Section title={i18nT("nodeRuntime.title", undefined, "Node runtime")}>
			{/* Family coherence report (spec: "Family incoherence is reported"). */}
			{coherence && !coherence.coherent && coherence.mismatch && (
				<div
					className="flex items-start gap-1.5 px-3 py-2 text-xs text-amber-500"
					data-testid="node-runtime-mismatch"
				>
					<Icon path={mdiAlert} size={0.7} />
					<span>
						{i18nT("nodeRuntime.mismatch", undefined, "Node family is split across installations:")}
						{" "}
						{coherence.mismatch.deviatingMembers
							.map((d) => `${d.member} → ${d.root}`)
							.join("; ")}
					</span>
				</div>
			)}
			{coherence?.coherent && coherence.selectedCandidateKey && (
				<div className="flex items-center gap-1.5 px-3 py-2 text-xs text-green-500" data-testid="node-runtime-coherent">
					<Icon path={mdiCheck} size={0.7} />
					{i18nT("nodeRuntime.coherent", undefined, "node, npm and npx resolve to one installation.")}
				</div>
			)}
			{coherence && coherence.handSetDeviations.length > 0 && (
				<div className="px-3 py-2 text-xs text-[var(--text-secondary)]" data-testid="node-runtime-handset">
					{i18nT("nodeRuntime.handSet", undefined, "Hand-set overrides in effect:")}
					{" "}
					{coherence.handSetDeviations.map((d) => `${d.member} → ${d.currentPath}`).join("; ")}
				</div>
			)}
			{error && (
				<div className="px-3 py-2 text-xs text-red-500" data-testid="node-runtime-error">{error}</div>
			)}
			<div className="max-h-72 overflow-y-auto">
				{(data?.candidates ?? [])
					.filter((c) => c.nodeEntry !== null)
					.map((c) => {
							// Authoritative ONLY: selectedCandidateKey already
							// encodes the adoption rules (pinned or coherent trio;
							// round-2 re-review: a containment fallback re-marked
							// partial unpinned families "selected" that adoption
							// deliberately leaves unset).
							const selected = coherence?.selectedCandidateKey === c.key;
						const isPending = pendingRoot === c.root;
						return (
							<div
								key={c.root ?? c.key}
								className={`flex items-center gap-2 px-3 py-1.5 text-xs ${isPending ? "bg-[var(--bg-hover)]" : ""}`}
								data-testid={`node-runtime-row-${c.key}`}
							>
								<span className="font-medium flex-shrink-0 w-28 truncate">{c.label}</span>
								<span className="text-[var(--text-secondary)] flex-1 truncate" title={c.root ?? undefined}>
									{c.version ?? c.root}
								</span>
								{selected && <span className="text-green-500">{i18nT("nodeRuntime.selected", undefined, "selected")}</span>}
								<button
									className="px-2 py-0.5 border border-[var(--border-secondary)] rounded hover:bg-[var(--bg-hover)] flex-shrink-0"
									disabled={busy}
									onClick={() => {
										setPendingRoot(c.root);
										setDiscard([]);
									}}
								>
									{i18nT("nodeRuntime.use", undefined, "Use")}
								</button>
							</div>
						);
					})}
			</div>
			{/* Confirm-before-write: restates hand-set deviations (D5). */}
			{pendingCandidate && (
				<div className="px-3 py-2 text-xs border-t border-[var(--border-secondary)]" data-testid="node-runtime-confirm">
					<div className="mb-1">
						{i18nT("nodeRuntime.confirm", undefined, "Write node, npm and npx overrides for:")}{" "}
						<span className="font-mono">{pendingCandidate.root}</span>
					</div>
					{pendingHandSet.map((d) => (
						<label key={d.member} className="flex items-center gap-1.5 mb-1">
							<input
								type="checkbox"
								checked={discard.includes(d.member)}
								onChange={(e) =>
									setDiscard((x) =>
										e.target.checked ? [...x, d.member] : x.filter((m) => m !== d.member),
									)
								}
							/>
							{i18nT("nodeRuntime.discardHandSet", { member: d.member }, "Discard hand-set override for {member}:")}{" "}
							<span className="font-mono">{d.currentPath}</span>
						</label>
					))}
					<div className="flex gap-1.5 mt-1.5">
						<button
							className="px-2 py-0.5 rounded text-xs bg-[var(--accent-blue)] hover:opacity-90 text-white disabled:opacity-50"
							disabled={busy}
							onClick={() => void apply()}
						>
							{i18nT("nodeRuntime.apply", undefined, "Apply")}
						</button>
						<button
							className="px-2 py-0.5 border border-[var(--border-secondary)] rounded"
							disabled={busy}
							onClick={() => { setPendingRoot(null); setDiscard([]); }}
						>
							{i18nT("common.cancel", undefined, "Cancel")}
						</button>
					</div>
				</div>
			)}
			<div className="px-3 py-1.5">
				<button
					className="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
					disabled={loading || busy}
					onClick={() => void reload()}
				>
					<Icon path={mdiRefresh} size={0.6} />
					{i18nT("nodeRuntime.rescan", undefined, "Rescan")}
				</button>
			</div>
		</Section>
	);
}
