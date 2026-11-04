/**
 * SubagentsSettings — settings panel for the subagents plugin.
 *
 * Claims slot `settings-section` (tab: "general"). Surfaces TWO producer
 * settings on ONE draft: `inheritContext` and `maxConcurrent` ("Max parallel
 * subagents", 0–64, 0 = unlimited, default 4, with the heap-limits per-child
 * warning). See change: subagent-queue-visibility (D5). The other producer settings
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

import {
	NumberField,
	SettingsNotice,
	ToggleField,
	usePluginConfig,
	useSettingsDraftSource,
	useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { subagentHeapBudget } from "@blackbelt-technology/pi-dashboard-shared/heap-limits.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

/** Settings page of the Roles plugin ("Model roles"), where `@fast` gets its model. */
const ROLES_SETTINGS_PATH = "/settings/plugins/roles";

const OPEN_ROLES_BTN =
	"focus-ring inline-flex min-h-[32px] items-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";
const CODE_CLS = "font-mono text-[12px] text-[var(--text-primary)]";
/** `{role}` placeholder value; the translated sentence is split on it and each hit becomes a `<code>@fast</code>`. */
const ROLE_MARK = "\u0001";

interface SubagentsPluginConfig {
	inheritContext?: boolean;
	maxConcurrent?: number;
}

/** Producer 0.6.0 default and range for `maxConcurrent`. */
const DEFAULT_MAX_CONCURRENT = 4;
const MAX_CONCURRENT_LIMIT = 64;

/** Integer 0–64 (0 = unlimited). */
export function isValidMaxConcurrent(v: number): boolean {
	return Number.isInteger(v) && v >= 0 && v <= MAX_CONCURRENT_LIMIT;
}

interface Draft {
	inheritContext: boolean;
	maxConcurrent: number;
}

/** Session heap ceiling (MB) for the per-child warning; `null` until known / unset. */
function useHeapCeilingMb(): number | null {
	const [mb, setMb] = useState<number | null>(null);
	useEffect(() => {
		let live = true;
		fetch("/api/plugins/subagents/limits", { credentials: "include" })
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { heapCeilingMb?: unknown } | null) => {
				if (live && typeof body?.heapCeilingMb === "number") setMb(body.heapCeilingMb);
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, []);
	return mb;
}

export function SubagentsSettings() {
	// Buffered source: the toggle edits a local draft and persists via the
	// host Settings panel's unified Save. See change: unify-settings-save-contract.
	const t = useT();
	const [, navigate] = useLocation();
	/** Raw failure text (HTTP status + body) — only ever copied via "Copy details", never rendered. */
	const [saveError, setSaveError] = useState<string | null>(null);
	const config = usePluginConfig<SubagentsPluginConfig>();
	const baseInherit = config.inheritContext ?? true;
	const baseMax = typeof config.maxConcurrent === "number" ? config.maxConcurrent : DEFAULT_MAX_CONCURRENT;
	const [draft, setDraft] = useState<Draft>({ inheritContext: baseInherit, maxConcurrent: baseMax });
	// Per-field baseline, OR'd dirty: either edit marks the page unsaved.
	const isDirty = draft.inheritContext !== baseInherit || draft.maxConcurrent !== baseMax;
	const maxValid = isValidMaxConcurrent(draft.maxConcurrent);
	const dirtyRef = useRef(isDirty); dirtyRef.current = isDirty;
	const baseMaxRef = useRef(baseMax); baseMaxRef.current = baseMax;
	const draftRef = useRef(draft); draftRef.current = draft;
	// Adopt a new baseline (e.g. config broadcast) only while clean.
	useEffect(() => {
		if (!dirtyRef.current) setDraft({ inheritContext: baseInherit, maxConcurrent: baseMax });
	}, [baseInherit, baseMax]);
	const heapCeilingMb = useHeapCeilingMb();

	const commit = useCallback(async () => {
		// The host Save bar shows the thrown message, so it must be a human sentence;
		// the raw status/body goes to the body notice's "Copy details" only.
		const fail = (raw: string): never => {
			setSaveError(raw);
			throw new Error(
				t("saveError", undefined, "Could not save the subagent settings. Check that the dashboard is running, then save again."),
			);
		};
		const current = draftRef.current;
		// No validate hook on the host draft API: an invalid limit fails THIS section's
		// commit (inline error stays), other dirty sections still commit.
		if (!isValidMaxConcurrent(current.maxConcurrent)) {
			throw new Error(t("maxConcurrentInvalid", undefined, "Enter a whole number from 0 to 64."));
		}
		let res: Response;
		try {
			res = await fetch("/api/config/plugins/subagents", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				// `maxConcurrent` only when edited: an unrelated save must never pin the shown
				// default over a hand-set producer value (design D5).
				body: JSON.stringify({
					inheritContext: current.inheritContext,
					...(current.maxConcurrent !== baseMaxRef.current ? { maxConcurrent: current.maxConcurrent } : {}),
				}),
				credentials: "include",
			});
		} catch (e) {
			return fail(String(e));
		}
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			fail(`HTTP ${res.status}: ${body || res.statusText}`);
		}
		setSaveError(null);
	}, [t]);
	const reset = useCallback(() => {
		setSaveError(null);
		setDraft({ inheritContext: baseInherit, maxConcurrent: baseMax });
	}, [baseInherit, baseMax]);
	useSettingsDraftSource({ id: "plugin:subagents", isDirty, commit, reset });

	const [roleBefore, roleMiddle = "", roleAfter = ""] = t(
		"rolesNotice",
		{ role: ROLE_MARK },
		"The bundled Explore agent uses {role}. Give {role} a model in Model roles, otherwise agents that use roles report “not configured yet”.",
	).split(ROLE_MARK);
	const role = <code className={CODE_CLS}>@fast</code>;

	return (
		<div className="space-y-3">
			{/* No self-header: the host owns identity + status chrome on
			    `/settings/plugins/<id>`, so a second heading double-headers
			    (design D1). See change: plugin-settings-pages. */}
			<p className="text-xs text-[var(--text-secondary)]">
				{t("settingsLead", undefined, "How sessions start subagents.")}
			</p>

			{/*
			  Soft (runtime) relationship with the Roles plugin — no manifest
			  `dependsOn`. The bundled Explore agent resolves `@fast` via the
			  standalone `role:resolve-model` event; an unconfigured role
			  degrades to a structured "not configured yet" error at spawn time
			  rather than blocking Subagents from loading. This notice points
			  users to Model roles so `@fast` resolves.
			  See change: roles-standalone-defaults-and-local-install-detection.
			*/}
			<SettingsNotice
				tone="info"
				testId="subagents-settings-roles-dep"
				actions={
					<button type="button" className={OPEN_ROLES_BTN} onClick={() => navigate(ROLES_SETTINGS_PATH)}>
						{t("openModelRoles", undefined, "Open Model roles")}
					</button>
				}
			>
				{roleBefore}
				{role}
				{roleMiddle}
				{role}
				{roleAfter}
			</SettingsNotice>

			{saveError !== null && (
				<SettingsNotice tone="error" testId="subagents-save-error" details={saveError}>
					{t("saveError", undefined, "Could not save the subagent settings. Check that the dashboard is running, then save again.")}
				</SettingsNotice>
			)}

			<ToggleField
				label={t("forkContextLabel", undefined, "Share the parent conversation")}
				hint={t(
					"forkContextDescription",
					undefined,
					"On: each subagent gets a compressed copy of the parent's recent turns. Off: each starts with an empty conversation.",
				)}
				value={draft.inheritContext}
				onChange={(v) => {
					setSaveError(null);
					setDraft((d) => ({ ...d, inheritContext: v }));
				}}
				testIds={{ control: "subagents-inherit-context" }}
			/>

			<NumberField
				label={t("maxConcurrentLabel", undefined, "Max parallel subagents")}
				hint={t(
					"maxConcurrentHint",
					undefined,
					"How many subagents run at once; the rest wait in a queue. 0 = unlimited. Applies immediately, including to waiting subagents.",
				)}
				value={draft.maxConcurrent}
				decimal
				allowEmpty
				step={1}
				error={maxValid ? undefined : t("maxConcurrentInvalid", undefined, "Enter a whole number from 0 to 64.")}
				onChange={(v) => {
					setSaveError(null);
					setDraft((d) => ({ ...d, maxConcurrent: v }));
				}}
				testIds={{ control: "subagents-max-concurrent", error: "subagents-max-concurrent-error" }}
			/>
			{maxValid && heapCeilingMb !== null && subagentHeapBudget(heapCeilingMb, draft.maxConcurrent).warn && (
				<SettingsNotice tone="warning" testId="subagents-max-concurrent-heap-warning">
					{draft.maxConcurrent === 0
						? t(
								"maxConcurrentHeapWarningUnlimited",
								{ ceiling: heapCeilingMb },
								"With a {ceiling} MB session heap ceiling, unlimited parallel subagents can exhaust memory. Set a limit.",
							)
						: t(
								"maxConcurrentHeapWarning",
								{
									ceiling: heapCeilingMb,
									count: draft.maxConcurrent,
									perChild: subagentHeapBudget(heapCeilingMb, draft.maxConcurrent).perChildMb,
								},
								"With a {ceiling} MB session heap ceiling, {count} parallel subagents leave each about {perChild} MB. Lower the limit or raise the session heap ceiling.",
							)}
				</SettingsNotice>
			)}
		</div>
	);
}
