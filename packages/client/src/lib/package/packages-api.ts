/**
 * Client-side fetch helpers for package management endpoints.
 *
 * Most package operations (install/remove/update) flow through the
 * `package-queue` singleton; this module hosts helpers that don't
 * fit that model: notably `movePackage`, which is its own logical
 * operation (composite install + remove with shared moveId).
 *
 * See change: unify-package-management-ui.
 */
import { getApiBase } from "../api/api-context.js";

export type PackageScope = "global" | "local";

/** A pi `packages[]` entry — either a bare source string or a filter object. */
export type PackageEntry = string | { source: string; [k: string]: unknown };

export interface MoveArgs {
	entry: PackageEntry;
	fromScope: PackageScope;
	fromCwd?: string;
	toScope: PackageScope;
	toCwd?: string;
}

export interface MoveSuccessResponse {
	ok: true;
	moveId: string;
	phases: Array<"install" | "remove" | "settings-edit">;
}

export interface MoveErrorResponse {
	ok: false;
	status: number;
	/** Server-supplied stable code for UI branching (e.g. "already_at_destination"). */
	code?:
		| "invalid_request"
		| "unsupported_source_for_destination"
		| "already_at_destination"
		| "operation_in_flight"
		| "internal_error";
	message: string;
}

export type MoveResponse = MoveSuccessResponse | MoveErrorResponse;

/**
 * POST /api/packages/move. Returns a structured discriminated union;
 * never throws on HTTP-error responses (network errors still throw).
 *
 * Partial-success (install OK, remove failed) is delivered later via
 * the `package_operation_complete` WS event's `partialSuccess` field —
 * this helper only reports the synchronous accept/reject outcome.
 */
export async function movePackage(args: MoveArgs): Promise<MoveResponse> {
	const res = await fetch(`${getApiBase()}/api/packages/move`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(args),
	});
	const body = (await res.json().catch(() => ({}))) as any;

	if (res.ok && body?.success && body?.data?.moveId) {
		return {
			ok: true,
			moveId: body.data.moveId,
			phases: body.data.phases ?? [],
		};
	}

	return {
		ok: false,
		status: res.status,
		code: body?.code,
		message: body?.error ?? `HTTP ${res.status}`,
	};
}

// ── Reset-to-npm (source-override → published variant) ──────────────────
// See change: reset-override-to-npm.

export interface ResetToNpmArgs {
	/** The local/git `packages[]` entry to reset. */
	source: string;
	scope: PackageScope;
	cwd?: string;
}

export interface ResetSuccessResponse {
	ok: true;
	resetId: string;
	/** The published spec the server resolved and is installing. */
	publishedSource: string;
}

export interface ResetErrorResponse {
	ok: false;
	status: number;
	code?: "invalid_request" | "operation_in_flight" | "internal_error";
	message: string;
}

export type ResetResponse = ResetSuccessResponse | ResetErrorResponse;

/**
 * POST /api/packages/reset-to-npm. The server resolves the published target
 * authoritatively from the installed row; the client only names the source +
 * scope. Returns a discriminated union; never throws on HTTP-error responses.
 * Partial-success (install OK, remove failed) arrives later via the
 * `package_operation_complete` WS event's `partialSuccess` field.
 */
export async function resetToNpm(args: ResetToNpmArgs): Promise<ResetResponse> {
	const res = await fetch(`${getApiBase()}/api/packages/reset-to-npm`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(args),
	});
	const body = (await res.json().catch(() => ({}))) as any;

	if (res.ok && body?.success && body?.data?.resetId) {
		return {
			ok: true,
			resetId: body.data.resetId,
			publishedSource: body.data.publishedSource,
		};
	}

	return {
		ok: false,
		status: res.status,
		code: body?.code,
		message: body?.error ?? `HTTP ${res.status}`,
	};
}
