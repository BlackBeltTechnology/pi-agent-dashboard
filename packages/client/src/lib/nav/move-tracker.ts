/**
 * In-flight package-move tracker. Decoupled from `package-queue` because
 * move operations have their own moveId-keyed identity and partial-
 * success semantics; they don't fit the source-keyed install/remove
 * /update model.
 *
 * State per moveId:
 *   - phase: "running" | "success" | "error" | "partial-success"
 *   - source: string                      (for UI display)
 *   - fromScope/toScope/fromCwd/toCwd:    (for recovery actions)
 *   - message: string                     (last progress / error message)
 *   - partialSuccess?: { ... }            (set when install OK, remove failed)
 *
 * Listens for `package_operation_complete` WS events with a `moveId` and
 * updates state. Listeners (the React hook) get notified on every change.
 *
 * See change: unify-package-management-ui.
 */
import { t as i18nT } from "../i18n/i18n.js";
import type { PackageScope } from "../package/packages-api.js";

export type MovePhase = "running" | "success" | "error" | "partial-success";

export interface MoveState {
	moveId: string;
	source: string;
	fromScope: PackageScope;
	fromCwd?: string;
	toScope: PackageScope;
	toCwd?: string;
	/**
	 * Which composite op this state tracks. `"reset"` (reset-to-npm) reuses the
	 * exact moveId-keyed + partial-success machinery as `"move"`; only the
	 * display copy differs. Defaults to `"move"`. See change: reset-override-to-npm.
	 */
	kind?: "move" | "reset";
	phase: MovePhase;
	message: string;
	partialSuccess?: {
		installed: boolean;
		removed: boolean;
		removeError?: string;
	};
}

const SUCCESS_AUTOCLEAR_MS = 3000;

class MoveTracker {
	private byMoveId = new Map<string, MoveState>();
	private listeners = new Set<() => void>();
	private autoClearTimers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor() {
		if (typeof window !== "undefined") {
			window.addEventListener("pi-package-event", this.onWindowEvent);
		}
	}

	register(state: Omit<MoveState, "phase" | "message">): void {
		const isReset = state.kind === "reset";
		this.byMoveId.set(state.moveId, {
			...state,
			phase: "running",
			message: isReset
				? i18nT("status.resetting", undefined, "Resetting…")
				: i18nT("status.moving", undefined, "Moving…"),
		});
		this.notify();
	}

	/** Look up by moveId. */
	get(moveId: string): MoveState | undefined {
		return this.byMoveId.get(moveId);
	}

	/** Look up by source — returns the most-recent move for that source, if any. */
	getBySource(source: string): MoveState | undefined {
		for (const state of this.byMoveId.values()) {
			if (state.source === source) return state;
		}
		return undefined;
	}

	/** Manually clear a moveId (e.g. user dismissed a partial-success banner). */
	clear(moveId: string): void {
		const t = this.autoClearTimers.get(moveId);
		if (t) {
			clearTimeout(t);
			this.autoClearTimers.delete(moveId);
		}
		this.byMoveId.delete(moveId);
		this.notify();
	}

	subscribe(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	}

	__resetForTests(): void {
		for (const t of this.autoClearTimers.values()) clearTimeout(t);
		this.autoClearTimers.clear();
		this.byMoveId.clear();
		this.notify();
	}

	private onWindowEvent = (e: Event) => {
		const msg = (e as CustomEvent).detail;
		if (!msg || typeof msg !== "object") return;
		if (msg.type !== "package_operation_complete") return;
		if (typeof msg.moveId !== "string") return;
		const state = this.byMoveId.get(msg.moveId);
		if (!state) return;

		if (msg.success) {
			if (msg.partialSuccess && msg.partialSuccess.removed === false) {
				// Install OK, remove failed → keep state visible until user
				// clicks "Cleanup origin" or dismiss; no auto-clear.
				this.byMoveId.set(msg.moveId, {
					...state,
					phase: "partial-success",
					message:
						msg.partialSuccess.removeError ??
						"Installed at destination but removal from origin failed",
					partialSuccess: msg.partialSuccess,
				});
			} else {
				this.byMoveId.set(msg.moveId, {
					...state,
					phase: "success",
					message: state.kind === "reset"
						? i18nT("status.resetComplete", undefined, "Reset complete")
						: i18nT("status.moveComplete", undefined, "Move complete"),
				});
				const t = setTimeout(() => {
					this.byMoveId.delete(msg.moveId);
					this.autoClearTimers.delete(msg.moveId);
					this.notify();
				}, SUCCESS_AUTOCLEAR_MS);
				this.autoClearTimers.set(msg.moveId, t);
			}
		} else {
			this.byMoveId.set(msg.moveId, {
				...state,
				phase: "error",
				message: msg.error ?? "Move failed",
			});
		}
		this.notify();
	};

	private notify(): void {
		for (const cb of this.listeners) {
			try {
				cb();
			} catch {
				/* ignore */
			}
		}
	}
}

export const moveTracker = new MoveTracker();
