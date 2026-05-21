/**
 * Pure helpers for reading / writing the producer's settings file at
 *   ~/.pi/agent/extensions/pi-dashboard-subagents/config.json
 *
 * The producer extension (`pi-dashboard-subagents`) owns this file. The
 * dashboard plugin server mirrors `inheritContext` through it so producer
 * behavior obeys the dashboard's toggle. Unexposed keys
 * (`exposeInheritanceInTool`, `inheritance.*`, plus any user-added
 * `additionalProperties`) are preserved verbatim across reads/writes.
 *
 * See change: add-subagent-inspector §16.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Shape mirrored from pi-dashboard-subagents/extensions/settings.ts. */
export interface ProducerSettings {
	inheritContext?: boolean;
	exposeInheritanceInTool?: boolean;
	inheritance?: {
		recentTurns?: number;
		toolOutputWindow?: number;
		maxChars?: number;
	};
	[k: string]: unknown;
}

/** Absolute path to the producer's settings file. */
export function producerFilePath(): string {
	return path.join(
		os.homedir(),
		".pi",
		"agent",
		"extensions",
		"pi-dashboard-subagents",
		"config.json",
	);
}

/**
 * Read producer settings file. Returns `{}` when missing or unparseable.
 * Never throws.
 */
export function readProducerFile(filePath: string = producerFilePath()): ProducerSettings {
	try {
		if (!fs.existsSync(filePath)) return {};
		const raw = fs.readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as ProducerSettings;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch (err) {
		console.warn(
			"[plugin:subagents] failed to read producer file:",
			err instanceof Error ? err.message : err,
		);
		return {};
	}
}

/**
 * Atomic write via tmp + rename. Creates parent dir if missing.
 * Never throws; logs and returns on failure.
 */
export function writeProducerFile(
	merged: ProducerSettings,
	filePath: string = producerFilePath(),
): void {
	try {
		const dir = path.dirname(filePath);
		fs.mkdirSync(dir, { recursive: true });
		const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
		fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", { encoding: "utf-8" });
		fs.renameSync(tmp, filePath);
	} catch (err) {
		console.warn(
			"[plugin:subagents] failed to write producer file:",
			err instanceof Error ? err.message : err,
		);
	}
}

/**
 * Merge a plugin-config patch (currently `{ inheritContext? }`) into existing
 * producer settings, preserving unexposed keys verbatim. Used by the plugin
 * server's onResponse hook.
 */
export function mergeIntoProducerSettings(
	existing: ProducerSettings,
	patch: { inheritContext?: boolean },
): ProducerSettings {
	const out: ProducerSettings = { ...existing };
	if (patch.inheritContext !== undefined) out.inheritContext = patch.inheritContext;
	return out;
}
