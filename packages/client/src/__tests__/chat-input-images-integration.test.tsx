/**
 * Integration tests for the chat-input pending-image wiring.
 *
 * Same harness pattern as chat-input-draft-integration.test.tsx — a minimal
 * App-shaped parent that owns `pendingImagesMap` and passes
 * `images`/`onImagesChange` into `<CommandInput>`. This gives genuine
 * coverage for the two motivating bugs:
 *   1. Route takeover (e.g. Settings) unmounts CommandInput; coming back
 *      MUST restore the previously pasted images.
 *   2. Switching sessions before sending MUST NOT leak images from session A
 *      into session B's send_prompt.
 *
 * Pasting is simulated via `fireEvent.paste(textarea, { clipboardData })`
 * with a synthetic `DataTransfer`-like object containing a small Blob.
 */
import React, { useState, useCallback } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { ImageContent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { CommandInput } from "../components/chat/CommandInput.js";

const EMPTY_IMAGES: readonly ImageContent[] = Object.freeze([]);

function Harness({
	initialSessionId = "A",
	onSendCapture,
}: {
	initialSessionId?: string;
	onSendCapture?: (sid: string, text: string, images?: ImageContent[]) => void;
}) {
	const [pendingImagesMap, setPendingImagesMap] = useState<Map<string, ImageContent[]>>(new Map());
	const [sessionId, setSessionId] = useState(initialSessionId);
	const [chatVisible, setChatVisible] = useState(true);

	const selectedImages =
		(pendingImagesMap.get(sessionId) ?? (EMPTY_IMAGES as ImageContent[]));

	const setImagesForSelected = useCallback((next: ImageContent[]) => {
		setPendingImagesMap((m) => {
			if (next.length === 0) {
				if (!m.has(sessionId)) return m;
				const out = new Map(m);
				out.delete(sessionId);
				return out;
			}
			if (m.get(sessionId) === next) return m;
			const out = new Map(m);
			out.set(sessionId, next);
			return out;
		});
	}, [sessionId]);

	const clearImagesForSession = useCallback((sid: string) => {
		setPendingImagesMap((m) => {
			if (!m.has(sid)) return m;
			const next = new Map(m);
			next.delete(sid);
			return next;
		});
	}, []);

	const handleSend = useCallback(
		(text: string, images?: ImageContent[]) => {
			onSendCapture?.(sessionId, text, images);
			clearImagesForSession(sessionId);
		},
		[sessionId, clearImagesForSession, onSendCapture],
	);

	return (
		<div>
			<button data-testid="toggle-chat" onClick={() => setChatVisible((v) => !v)}>
				toggle
			</button>
			<button data-testid="switch-A" onClick={() => setSessionId("A")}>A</button>
			<button data-testid="switch-B" onClick={() => setSessionId("B")}>B</button>
			<div data-testid="current-session">{sessionId}</div>
			<div data-testid="map-snapshot">
				{Array.from(pendingImagesMap.entries())
					.map(([sid, imgs]) => `${sid}=${imgs.length}`)
					.sort()
					.join(",")}
			</div>
			{chatVisible && (
				<CommandInput
					commands={[]}
					onSend={handleSend}
					sessionId={sessionId}
					images={selectedImages}
					onImagesChange={setImagesForSelected}
				/>
			)}
		</div>
	);
}

function getTextarea(container: HTMLElement): HTMLTextAreaElement {
	return container.querySelector("textarea")!;
}

function getThumbnails(container: HTMLElement): HTMLImageElement[] {
	return Array.from(container.querySelectorAll("img"))
		.filter((img) => img.src.startsWith("data:image"));
}

// Simulate a clipboard paste event carrying a single image file. We use a
// minimal `DataTransferItemList`-like shape because the React event system
// just forwards these through.
function pasteImage(textarea: HTMLTextAreaElement, mime = "image/png", bytes = 100) {
	const file = new File([new Uint8Array(bytes)], "x", { type: mime });
	const item = {
		kind: "file" as const,
		type: mime,
		getAsFile: () => file,
	};
	const clipboardData = {
		items: [item] as unknown as DataTransferItemList,
	};
	fireEvent.paste(textarea, { clipboardData });
}

// Paste reads the file through a real (async) FileReader, then sets React
// state on `onload`. A fixed number of macrotask ticks is NOT enough under CPU
// contention (the full parallel suite), so we poll the DOM until the thumbnail
// actually lands instead of guessing a tick count. Eliminates the
// "expected length 1 but got 0" flake. See change: fix-flaky-full-suite-tests.
async function waitForThumbnails(container: HTMLElement, count: number) {
	await waitFor(() => expect(getThumbnails(container)).toHaveLength(count));
}

describe("chat-input pending-image integration", () => {
	beforeEach(() => {
		// Sanity: fresh state per test.
		window.localStorage.clear();
	});
	afterEach(() => {
		cleanup();
		window.localStorage.clear();
	});

	it("pasted images survive unmount/remount of the chat view (route takeover)", async () => {
		const { container, getByTestId } = render(<Harness />);
		const textarea = getTextarea(container);
		pasteImage(textarea);
		await waitForThumbnails(container, 1);

		// Simulate /settings: CommandInput unmounts.
		fireEvent.click(getByTestId("toggle-chat"));
		expect(container.querySelector("textarea")).toBeNull();

		// Come back: CommandInput remounts and pulls images from App state.
		fireEvent.click(getByTestId("toggle-chat"));
		expect(getThumbnails(container)).toHaveLength(1);
	});

	it("pasted images do NOT leak across session switches", async () => {
		const onSend = vi.fn();
		const { container, getByTestId } = render(<Harness onSendCapture={onSend} />);
		let textarea = getTextarea(container);

		// Paste into A.
		pasteImage(textarea);
		await waitForThumbnails(container, 1);

		// Switch to B — preview must be empty.
		fireEvent.click(getByTestId("switch-B"));
		textarea = getTextarea(container);
		expect(getThumbnails(container)).toHaveLength(0);

		// Type and send in B.
		fireEvent.change(textarea, { target: { value: "hello B" } });
		fireEvent.keyDown(textarea, { key: "Enter" });

		// onSend captured for session B with NO images.
		expect(onSend).toHaveBeenCalledTimes(1);
		const [sid, text, images] = onSend.mock.calls[0];
		expect(sid).toBe("B");
		expect(text).toBe("hello B");
		expect(images).toBeUndefined();
	});

	it("pasted images survive a switch round-trip and arrive in the original session", async () => {
		const onSend = vi.fn();
		const { container, getByTestId } = render(<Harness onSendCapture={onSend} />);
		let textarea = getTextarea(container);

		// Paste in A.
		pasteImage(textarea);
		await waitForThumbnails(container, 1);

		// A → B → A.
		fireEvent.click(getByTestId("switch-B"));
		fireEvent.click(getByTestId("switch-A"));

		textarea = getTextarea(container);
		expect(getThumbnails(container)).toHaveLength(1);

		// Send from A.
		fireEvent.change(textarea, { target: { value: "hello A" } });
		fireEvent.keyDown(textarea, { key: "Enter" });

		expect(onSend).toHaveBeenCalledTimes(1);
		const [sid, text, images] = onSend.mock.calls[0];
		expect(sid).toBe("A");
		expect(text).toBe("hello A");
		expect(Array.isArray(images)).toBe(true);
		expect(images).toHaveLength(1);
		expect((images as ImageContent[])[0].mimeType).toBe("image/png");
	});

	it("clearImagesForSession runs after a successful send (preview empty, map entry removed)", async () => {
		const onSend = vi.fn();
		const { container, getByTestId } = render(<Harness onSendCapture={onSend} />);
		const textarea = getTextarea(container);

		pasteImage(textarea);
		await waitFor(() => expect(getByTestId("map-snapshot").textContent).toBe("A=1"));

		fireEvent.change(textarea, { target: { value: "send it" } });
		fireEvent.keyDown(textarea, { key: "Enter" });

		expect(getThumbnails(container)).toHaveLength(0);
		expect(getByTestId("map-snapshot").textContent).toBe("");
	});
});
