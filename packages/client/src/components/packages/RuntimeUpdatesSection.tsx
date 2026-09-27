/**
 * Settings → Packages → "Dashboard runtime" (Electron only).
 *
 * Source (bundled / npm / GitHub — choosing one also turns a local link off;
 * a local folder itself is set from the app menu only, D7), channel, exact
 * pin, status + pi version, Check now / Update / Activate / Roll back / Use
 * bundled, last failure. A non-updatable runtime (dev checkout) is read-only.
 *
 * See change: electron-runtime-overlay-updates.
 */
import { useState } from "react";
import { type RuntimeInfo, type RuntimeStatus, useRuntimeStatus } from "../../hooks/useRuntimeStatus.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { t } from "../../lib/i18n/i18n.js";

interface AppBridge {
	checkAppUpdate?: () => unknown;
}

const REQUIRES_APP = /requires_app\s*>=\s*(\S+)/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const btn =
	"px-2.5 py-1 rounded text-xs border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed";
const field = "text-xs rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-1.5 py-0.5";

async function post(path: string, body?: unknown): Promise<string | null> {
	const res = await fetch(`${getApiBase()}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
	if (res.ok) return null;
	const data = (await res.json().catch(() => ({}))) as { message?: string };
	return data.message ?? `${path} failed (${res.status})`;
}

const isRemote = (s: RuntimeStatus) => s.source === "npm" || s.source === "github";

/** Activate only the staged update target of a remote source (never a stale pending). */
function canActivate(status: RuntimeStatus, staging: boolean): boolean {
	const { check, pending } = status;
	return !staging && isRemote(status) && check.state === "available" && pending === check.target && pending !== status.runtime.id;
}

type Act = (path: string, body?: unknown) => void;

function PinControl({ status, disabled, act }: { status: RuntimeStatus; disabled: boolean; act: Act }) {
	const [draft, setDraft] = useState(status.pin ?? "");
	const valid = EXACT_VERSION.test(draft);
	return (
		<span className="inline-flex items-center gap-1">
			<input
				type="text"
				aria-label={t("runtime.pin", undefined, "Pin version")}
				placeholder={t("runtime.pinPlaceholder", undefined, "e.g. 0.9.1")}
				value={draft}
				disabled={disabled}
				onChange={(e) => setDraft(e.target.value.trim())}
				className={`${field} w-24`}
			/>
			<button type="button" className={btn} disabled={disabled || !valid || draft === status.pin} onClick={() => act("/api/runtime/source", { source: status.source, pin: draft })}>
				{t("runtime.pinSet", undefined, "Pin")}
			</button>
			{status.pin && (
				<button
					type="button"
					className={btn}
					disabled={disabled}
					onClick={() => {
						setDraft("");
						act("/api/runtime/source", { source: status.source, pin: null });
					}}
				>
					{t("runtime.pinClear", undefined, "Unpin")}
				</button>
			)}
		</span>
	);
}

function SourceControls({ status, disabled, act }: { status: RuntimeStatus; disabled: boolean; act: Act }) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<span className="text-[var(--text-secondary)]">{t("runtime.source", undefined, "Source")}</span>
			<select
				aria-label={t("runtime.source", undefined, "Source")}
				value={status.source}
				disabled={disabled}
				onChange={(e) => act("/api/runtime/source", { source: e.target.value })}
				className={field}
			>
				{status.source === "local" && (
					<option value="local" disabled>
						{t("runtime.sourceLocal", undefined, "Local folder")}
					</option>
				)}
				<option value="bundled">{t("runtime.sourceBundled", undefined, "Bundled")}</option>
				<option value="npm">{t("runtime.sourceNpm", undefined, "npm")}</option>
				<option value="github">{t("runtime.sourceGithub", undefined, "GitHub")}</option>
			</select>
			{isRemote(status) && (
				<>
					<select
						aria-label={t("runtime.channel", undefined, "Channel")}
						value={status.channel}
						disabled={disabled}
						onChange={(e) => act("/api/runtime/source", { source: status.source, channel: e.target.value })}
						className={field}
					>
						<option value="stable">{t("runtime.channelStable", undefined, "Stable")}</option>
						<option value="beta">{t("runtime.channelBeta", undefined, "Beta")}</option>
					</select>
					<PinControl key={status.pin ?? ""} status={status} disabled={disabled} act={act} />
				</>
			)}
		</div>
	);
}

function LocalCheckout({ runtime }: { runtime: RuntimeInfo }) {
	return (
		<div className="rounded border border-[var(--border-primary)] p-2 space-y-1">
			<div className="font-mono text-xs text-[var(--text-primary)]">{runtime.id.startsWith("local:") ? runtime.id.slice(6) : runtime.id}</div>
			<div className="text-xs text-[var(--text-secondary)]">
				{runtime.gitSha ?? t("runtime.noGit", undefined, "not a git checkout")}
				{runtime.dirty ? ` · ${t("runtime.dirty", undefined, "dirty")}` : ""}
			</div>
			<div className="text-xs text-[var(--text-secondary)]">
				{t("runtime.localHint", undefined, "Set from the app menu (Runtime → Use Local Folder…).")}
			</div>
		</div>
	);
}

function StatusLine({ status }: { status: RuntimeStatus }) {
	const { runtime, check } = status;
	return (
		<div className="text-xs text-[var(--text-secondary)]">
			{t("runtime.active", { v: runtime.version, o: runtime.origin }, "Active: {v} ({o})")}
			{status.piVersion && ` · ${t("runtime.piVersion", { v: status.piVersion }, "pi {v}")}`}
			{check.state === "available" && ` · ${t("runtime.available", { v: check.target }, "{v} available")}`}
			{check.state === "up_to_date" && ` · ${t("runtime.upToDate", undefined, "up to date")}`}
			{check.state === "check_failed" && ` · ${t("runtime.checkFailed", { r: check.reason }, "check failed: {r}")}`}
			{status.pending && ` · ${t("runtime.pending", { v: status.pending }, "{v} staged")}`}
		</div>
	);
}

/** Last failure; a `requires_app >=X` refusal links to the whole-app update check. */
function FailureLine({ failure, actionable }: { failure: { id: string; reason: string }; actionable: boolean }) {
	const requiresApp = REQUIRES_APP.exec(failure.reason)?.[1];
	const bridge = (window as unknown as { piDashboard?: AppBridge }).piDashboard;
	return (
		<div className="text-xs text-[var(--severity-error-fg)]" role="alert">
			{requiresApp ? (
				<>
					{t("runtime.requiresApp", { v: requiresApp }, "Requires app update ≥{v}")}{" "}
					{actionable && (
					<button type="button" className="underline" onClick={() => bridge?.checkAppUpdate?.()}>
						{t("runtime.checkAppUpdate", undefined, "Check for app update")}
					</button>
					)}
				</>
			) : (
				t("runtime.lastFailure", { v: failure.id, r: failure.reason }, "Last failure: {v} — {r}")
			)}
		</div>
	);
}

function ActionBar({ status, staging, onCheck, act }: { status: RuntimeStatus; staging: boolean; onCheck: () => void; act: Act }) {
	const { runtime, check } = status;
	const target = isRemote(status) && check.state === "available" ? check.target : null;
	return (
		<div className="flex flex-wrap gap-2">
			<button type="button" className={btn} disabled={staging} onClick={onCheck}>
				{t("runtime.checkNow", undefined, "Check now")}
			</button>
			{target && (
				<button type="button" className={btn} disabled={staging || status.pending === target} onClick={() => act("/api/runtime/update")}>
					{t("runtime.updateTo", { v: target }, "Update to {v}")}
				</button>
			)}
			<button type="button" className={btn} disabled={!canActivate(status, staging)} onClick={() => act("/api/runtime/activate")}>
				{t("runtime.activate", undefined, "Activate")}
			</button>
			<button type="button" className={btn} disabled={staging || !status.previous} onClick={() => act("/api/runtime/rollback", { to: "previous" })}>
				{t("runtime.rollback", undefined, "Roll back")}
			</button>
			<button type="button" className={btn} disabled={staging || runtime.origin === "bundled"} onClick={() => act("/api/runtime/rollback", { to: "bundled" })}>
				{t("runtime.useBundled", undefined, "Use bundled")}
			</button>
		</div>
	);
}

export function RuntimeUpdatesSection() {
	const { status, progress, error, setError, load } = useRuntimeStatus();

	const act: Act = (path, body) => {
		setError(null);
		post(path, body)
			.then((err) => {
				if (err) setError(err);
				return load();
			})
			.catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
	};

	const errorLine = error ?? status?.lastStageError?.message;
	const errorNode = errorLine ? (
		<div className="text-xs text-[var(--severity-error-fg)]" role="alert">
			{errorLine}
		</div>
	) : null;

	if (!status) return errorNode;
	const { runtime } = status;
	const staging = status.staging !== null || progress !== null;

	return (
		<section className="space-y-3 text-sm" data-testid="runtime-updates-section">
			<h3 className="font-medium text-[var(--text-primary)]">{t("runtime.title", undefined, "Dashboard runtime")}</h3>
			{runtime.updatable ? (
				<SourceControls status={status} disabled={staging} act={act} />
			) : (
				<div className="text-xs text-[var(--text-secondary)]">
					{t("runtime.notUpdatable", undefined, "This runtime is not updatable from here (development checkout).")}
				</div>
			)}
			{status.source === "local" && <LocalCheckout runtime={runtime} />}
			<StatusLine status={status} />
			{staging && (
				<div className="text-xs text-[var(--accent-primary)]" role="status">
					{t("runtime.staging", { p: progress ?? status.staging?.last?.phase ?? "…" }, "Staging: {p}")}
				</div>
			)}
			{runtime.lastFailure && <FailureLine failure={runtime.lastFailure} actionable={runtime.updatable} />}
			{errorNode}
			{runtime.updatable && (
				<ActionBar
					status={status}
					staging={staging}
					onCheck={() => {
						load(true).catch((err: unknown) => setError(String(err)));
					}}
					act={act}
				/>
			)}
		</section>
	);
}
