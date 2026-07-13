/**
 * Fact-provenance labeller. Every fact a module reports is tagged
 * `file-derived` (read from files + `createRequire`, always available) or
 * `server-enriched` (came from a live `/api/*` endpoint). A partial run with
 * the server down is then never mistaken for a clean bill of health.
 *
 * See change: add-modular-doctor-skill (design.md D4, spec: server-down label).
 */

export type Provenance = "file-derived" | "server-enriched";

export interface Fact<T = unknown> {
	label: string;
	value: T;
	provenance: Provenance;
}

/** Tag a file-derived fact (works with the server down). */
export function fileFact<T>(label: string, value: T): Fact<T> {
	return { label, value, provenance: "file-derived" };
}

/** Tag a server-enriched fact (only present when `/api/*` was reachable). */
export function serverFact<T>(label: string, value: T): Fact<T> {
	return { label, value, provenance: "server-enriched" };
}

export interface ProvenanceSummary {
	total: number;
	fileDerived: number;
	serverEnriched: number;
	/** True when NO server-enriched fact is present (server was down). */
	serverUnavailable: boolean;
}

/** Summarise a fact list so a report can render the provenance banner. */
export function summariseProvenance(facts: Fact[]): ProvenanceSummary {
	let fileDerived = 0;
	let serverEnriched = 0;
	for (const f of facts) {
		if (f.provenance === "server-enriched") serverEnriched++;
		else fileDerived++;
	}
	return {
		total: facts.length,
		fileDerived,
		serverEnriched,
		serverUnavailable: serverEnriched === 0,
	};
}
