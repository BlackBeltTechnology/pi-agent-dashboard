/**
 * SubagentsSettings — single-toggle settings panel for the subagents plugin.
 *
 * Claims slot `settings-section` (tab: "general"). Surfaces ONE producer
 * setting: `inheritContext`. The other producer settings
 * (`exposeInheritanceInTool`, `inheritance.*`) remain editable only via
 * the producer's `~/.pi/agent/extensions/pi-dashboard-subagents/config.json`
 * file for power users.
 *
 * Uses the canonical plugin-settings flow:
 *   - reads via `usePluginConfig<{ inheritContext?: boolean }>()`
 *   - writes via `POST /api/config/plugins/subagents`
 *   - plugin server's onResponse hook mirrors the write into the producer
 *     file (see ../server/index.ts)
 *
 * See change: add-subagent-inspector §16.
 */

import { usePluginConfig, useSettingsDraftSource, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import React, { useCallback, useEffect, useRef, useState } from "react";

interface SubagentsPluginConfig {
	inheritContext?: boolean;
}

export function SubagentsSettings() {
	// Buffered source: the toggle edits a local draft and persists via the
	// host Settings panel's unified Save. See change: unify-settings-save-contract.
	const t = useT();
	const config = usePluginConfig<SubagentsPluginConfig>();
	const baseline = config.inheritContext ?? true;
	const [draft, setDraft] = useState(baseline);
	const isDirty = draft !== baseline;
	const dirtyRef = useRef(isDirty); dirtyRef.current = isDirty;
	const draftRef = useRef(draft); draftRef.current = draft;
	// Adopt a new baseline (e.g. config broadcast) only while clean.
	useEffect(() => { if (!dirtyRef.current) setDraft(baseline); }, [baseline]);

	const commit = useCallback(async () => {
		const res = await fetch("/api/config/plugins/subagents", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ inheritContext: draftRef.current }),
			credentials: "include",
		});
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(
				t("saveError", { status: res.status, detail: body || res.statusText }, "HTTP {status}: {detail}"),
			);
		}
	}, [t]);
	const reset = useCallback(() => setDraft(baseline), [baseline]);
	useSettingsDraftSource({ id: "plugin:subagents", page: "general", isDirty, commit, reset });
	const checked = draft;

	return (
		<section className="space-y-3 p-4">
			<header>
				<h3 className="text-sm font-semibold text-[var(--text-primary)]">
					{t("subagentInspectorHeading", undefined, "Subagent Inspector")}
				</h3>
				<p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
					{t("producerSettingsPre", undefined, "Settings for the ")}
					<code className="font-mono">pi-dashboard-subagents</code>
					{t("producerSettingsPost", undefined, " producer.")}
				</p>
			</header>

			{/*
			  Soft (runtime) relationship with the Roles plugin — no manifest
			  `dependsOn`. The bundled Explore agent resolves `@fast` via the
			  standalone `role:resolve-model` event; an unconfigured role
			  degrades to a structured "not configured yet" error at spawn time
			  rather than blocking Subagents from loading. This disclaimer points
			  users to configure Roles so `@fast` resolves.
			  See change: roles-standalone-defaults-and-local-install-detection.
			*/}
			<div
				data-testid="subagents-settings-roles-dep"
				className="text-[11px] text-[var(--text-tertiary)] border border-[var(--border-secondary)] rounded px-2 py-1.5 bg-[var(--bg-tertiary)]"
			>
				{t("rolesDepConfigurePre", undefined, "Configure the ")}
				<code className="font-mono text-[var(--text-secondary)]">Roles</code>
				{t("rolesDepPluginResolve", undefined, " plugin so the bundled ")}
				<code className="font-mono">Explore</code>
				{t("rolesDepAgentResolve", undefined, " agent can resolve ")}
				<code className="font-mono">@fast</code>
				{t("rolesDepIfNoModel", undefined, ". If no model is assigned to ")}
				<code className="font-mono">@fast</code>
				{t("rolesDepAgentsUsing", undefined, ", agents using ")}
				<code className="font-mono">@role</code>
				{t("rolesDepAliasesReport", undefined, " aliases report “not configured yet” at spawn time — Subagents still loads.")}
			</div>

			<label className="flex items-start gap-2 cursor-pointer">
				<input
					type="checkbox"
					className="mt-0.5"
					checked={checked}
					onChange={(e) => setDraft(e.target.checked)}
				/>
				<span className="flex-1">
					<span className="block text-sm text-[var(--text-primary)]">
						{t("forkContextLabel", undefined, "Fork parent context into every subagent")}
					</span>
					<span className="block text-[11px] text-[var(--text-tertiary)] mt-0.5">
						{t(
							"forkContextDescription",
							undefined,
							"When on, the subagent inherits a compressed copy of the parent's recent turns. When off, every subagent starts with an empty conversation (isolated).",
						)}
					</span>
				</span>
			</label>
		</section>
	);
}
