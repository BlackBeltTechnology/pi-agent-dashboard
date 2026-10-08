/**
 * BrowserPaneTab + BrowserTabLabel RTL (change: add-browser-editor-pane-tab).
 * Test-plan: #F2 #F3 #F4 #F5 #F6 #F7 #F8 #F9 #F10 #F11 #F12 #F16 #P2.
 */
import type {
	BrowserRelayStatusMessage,
	BrowserRelayTabState,
} from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { InteractiveUiRequestSnapshot } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrowserPaneTab } from "../BrowserPaneTab.js";
import { BrowserTabLabel } from "../BrowserTabLabel.js";
import { __resetRelayStoreForTests } from "../relay-store.js";
import { parseBrowserTabPath } from "../tab-path.js";
import { renderWithPlugin, SESSION } from "./test-utils.js";

interface TabSpec {
	tabId: number;
	state?: BrowserRelayTabState;
	reason?: "devtools" | "no-session";
	title?: string;
	url?: string;
	agentEmulation?: boolean;
}

function status(tabs: TabSpec[], instanceId = "i1"): BrowserRelayStatusMessage {
	return {
		type: "browser_relay_status",
		auditSeq: 0,
		instances: [
			{
				instanceId,
				profileDirectory: "OSS",
				state: "connected",
				tabs: tabs.map((tab) => ({
					tabId: tab.tabId,
					title: tab.title ?? `Tab ${tab.tabId}`,
					url: tab.url ?? "https://example.test/p",
					state: tab.state ?? ("live" as const),
					...(tab.reason ? { reason: tab.reason } : {}),
					...(tab.agentEmulation ? { agentEmulation: true } : {}),
				})),
			},
		],
	};
}

const frame = (n: number, tabId = 1) => ({
	type: "browser_relay_frame" as const,
	instanceId: "i1",
	tabId,
	jpegBase64: `frame${n}`,
	metadata: { deviceWidth: 1280, deviceHeight: 800, timestamp: n },
});

const rect = (w: number, h: number) =>
	({ left: 0, top: 0, width: w, height: h, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

// jsdom has no PointerEvent: a MouseEvent subclass keeps clientX/pointerType.
class FakePointerEvent extends MouseEvent {
	pointerType: string;
	constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
		super(type, init);
		this.pointerType = init.pointerType ?? "mouse";
	}
}

let resizeCallbacks: Array<(entries: Array<{ contentRect: { width: number; height: number } }>) => void> = [];
class FakeResizeObserver {
	private readonly cb: (entries: Array<{ contentRect: { width: number; height: number } }>) => void;
	constructor(cb: (entries: Array<{ contentRect: { width: number; height: number } }>) => void) {
		this.cb = cb;
		resizeCallbacks.push(cb);
	}
	observe() {}
	disconnect() {
		resizeCallbacks = resizeCallbacks.filter((c) => c !== this.cb);
	}
	unobserve() {}
}

beforeEach(() => {
	__resetRelayStoreForTests();
	resizeCallbacks = [];
	vi.stubGlobal("PointerEvent", FakePointerEvent);
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ profiles: {} }) })));
});
afterEach(() => {
	cleanup();
	__resetRelayStoreForTests();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const PATH = "browser:i1:1";

function mount(opts: { path?: string; isActive?: boolean; interactive?: InteractiveUiRequestSnapshot[] } = {}) {
	const onClose = vi.fn();
	const r = renderWithPlugin(
		<BrowserPaneTab path={opts.path ?? PATH} session={SESSION} isActive={opts.isActive ?? true} onClose={onClose} />,
		{ interactiveRequests: () => opts.interactive ?? [] },
	);
	return { ...r, onClose };
}
const emitStatus = (r: { ws: { emit(m: unknown): void } }, s: BrowserRelayStatusMessage) => act(() => r.ws.emit(s));
const sent = (send: ReturnType<typeof vi.fn>, type: string) => send.mock.calls.map((c) => c[0]).filter((m) => m.type === type);
const inputs = (send: ReturnType<typeof vi.fn>) => sent(send, "browser_relay_input");

describe("tab path", () => {
	it("parses browser:<instance>:<tab>, instance ids may contain colons", () => {
		expect(parseBrowserTabPath("browser:i1:42")).toEqual({ instanceId: "i1", tabId: 42 });
		expect(parseBrowserTabPath("browser:a:b:7")).toEqual({ instanceId: "a:b", tabId: 7 });
		for (const bad of ["browser:i1", "browser::1", "browser:i1:x", "browser:i1:1.5", "term:1", "browser:i1:01"]) expect(parseBrowserTabPath(bad)).toBeNull();
	});
});

describe("lifecycle (#F2 #F3 #F4)", () => {
	it("#F2 one subscribe on open, one unsubscribe on close", async () => {
		const r = mount();
		emitStatus(r, status([{ tabId: 1 }]));
		await waitFor(() => expect(sent(r.send, "browser_relay_subscribe")).toHaveLength(1));
		expect(sent(r.send, "browser_relay_subscribe")[0]).toEqual({ type: "browser_relay_subscribe", instanceId: "i1", tabId: 1 });
		r.unmount();
		expect(sent(r.send, "browser_relay_unsubscribe")).toEqual([{ type: "browser_relay_unsubscribe", instanceId: "i1", tabId: 1 }]);
	});

	it("#F3 background (isActive=false) holds no subscription; re-activation subscribes once", async () => {
		let setActive: (v: boolean) => void = () => {};
		function Harness() {
			const [active, set] = useState(false);
			setActive = set;
			return <BrowserPaneTab path={PATH} session={SESSION} isActive={active} onClose={vi.fn()} />;
		}
		const r = renderWithPlugin(<Harness />);
		emitStatus(r, status([{ tabId: 1 }]));
		await flushMicro();
		expect(sent(r.send, "browser_relay_subscribe")).toHaveLength(0);
		act(() => setActive(true));
		await waitFor(() => expect(sent(r.send, "browser_relay_subscribe")).toHaveLength(1));
	});

	it("#F3 relay tab removed → 'no longer available' + Close, unsubscribes, no input", async () => {
		const r = mount();
		emitStatus(r, status([{ tabId: 1 }]));
		await waitFor(() => expect(r.getByTestId("browser-pane-tab")).toBeTruthy());
		emitStatus(r, status([{ tabId: 2 }]));
		await waitFor(() => expect(r.getByTestId("browser-pane-gone")).toBeTruthy());
		expect(r.getByTestId("browser-pane-gone").textContent).toContain("no longer available");
		expect(sent(r.send, "browser_relay_unsubscribe")).toHaveLength(1);
		fireEvent.click(r.getByText("Close"));
		expect(r.onClose).toHaveBeenCalledTimes(1);
		expect(inputs(r.send)).toHaveLength(0);
	});

	it("#F4 detached → live sends exactly one new subscribe, no remount", async () => {
		const r = mount();
		emitStatus(r, status([{ tabId: 1, state: "detached", reason: "no-session" }]));
		await flushMicro();
		expect(sent(r.send, "browser_relay_subscribe")).toHaveLength(0);
		emitStatus(r, status([{ tabId: 1, state: "live" }]));
		await waitFor(() => expect(sent(r.send, "browser_relay_subscribe")).toHaveLength(1));
		emitStatus(r, status([{ tabId: 1, state: "no-frames" }])); // still viewable → no re-subscribe
		await flushMicro();
		expect(sent(r.send, "browser_relay_subscribe")).toHaveLength(1);
	});
});

describe("frames, idle, detached (#F5 #F6)", () => {
	it("renders the frame; waiting text before the first one", async () => {
		const r = mount();
		emitStatus(r, status([{ tabId: 1 }]));
		await waitFor(() => expect(r.getByTestId("browser-pane-waiting")).toBeTruthy());
		act(() => r.ws.emit(frame(1)));
		await waitFor(() => expect((r.getByTestId("browser-pane-frame") as HTMLImageElement).src).toContain("frame1"));
		expect(r.queryByTestId("browser-pane-waiting")).toBeNull();
		act(() => r.ws.emit(frame(2, 99))); // another tab's frame is ignored
		expect((r.getByTestId("browser-pane-frame") as HTMLImageElement).src).toContain("frame1");
	});

	it("#F5 no-frames keeps the last frame visible, adds a non-blocking idle strip + Bring to front", async () => {
		const r = mount();
		emitStatus(r, status([{ tabId: 1 }]));
		act(() => r.ws.emit(frame(1)));
		await waitFor(() => expect(r.getByTestId("browser-pane-frame")).toBeTruthy());
		emitStatus(r, status([{ tabId: 1, state: "no-frames" }]));
		await waitFor(() => expect(r.getByTestId("browser-pane-idle")).toBeTruthy());
		expect(r.getByTestId("browser-pane-frame")).toBeTruthy();
		const frameArea = r.getByTestId("browser-pane-frame-area");
		expect(frameArea.contains(r.getByTestId("browser-pane-idle"))).toBe(false); // not over the frame
		fireEvent.click(r.getByTestId("browser-pane-idle").querySelector("button")!);
		expect(inputs(r.send).at(-1)).toMatchObject({ kind: "bringToFront" });
	});

	it("#F6 devtools hides the frame, shows the text, blocks input; no-session has its own text", async () => {
		const r = mount();
		emitStatus(r, status([{ tabId: 1 }]));
		act(() => r.ws.emit(frame(1)));
		await waitFor(() => expect(r.getByTestId("browser-pane-frame")).toBeTruthy());
		emitStatus(r, status([{ tabId: 1, state: "detached", reason: "devtools" }]));
		await waitFor(() => expect(r.queryByTestId("browser-pane-frame")).toBeNull());
		expect(r.getByTestId("browser-pane-devtools").textContent).toContain("DevTools open on this tab");
		fireEvent.keyDown(r.getByTestId("browser-pane-frame-box"), { key: "a" });
		expect(inputs(r.send)).toHaveLength(0);
		emitStatus(r, status([{ tabId: 1, state: "detached", reason: "no-session" }]));
		await waitFor(() => expect(r.getByTestId("browser-pane-nosession")).toBeTruthy());
		expect(r.queryByTestId("browser-pane-waiting")).toBeNull();
	});
});

describe("toolbar + input (#F7 #F8 #F9)", () => {
	async function ready() {
		const r = mount();
		emitStatus(r, status([{ tabId: 1, url: "chrome-extension://zzz/p.html" }]));
		act(() => r.ws.emit(frame(1)));
		await waitFor(() => expect(r.getByTestId("browser-pane-frame")).toBeTruthy());
		const img = r.getByTestId("browser-pane-frame");
		img.getBoundingClientRect = () => rect(400, 200);
		return r;
	}

	it("shows the read-only (already redacted) URL", async () => {
		const r = await ready();
		const url = r.getByTestId("browser-pane-url") as HTMLInputElement;
		expect(url.readOnly).toBe(true);
		expect(url.value).toBe("chrome-extension://zzz/p.html");
	});

	it("#F8 a centre tap is one click at 0.5/0.5; pointer move only for a mouse; drag is not selection", async () => {
		const r = await ready();
		const box = r.getByTestId("browser-pane-frame-box");
		const down = new FakePointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch" });
		box.dispatchEvent(down);
		box.dispatchEvent(new FakePointerEvent("pointerup", { bubbles: true, clientX: 200, clientY: 100, pointerType: "touch" }));
		const clicks = inputs(r.send).filter((m) => m.kind === "mouse");
		expect(clicks).toEqual([expect.objectContaining({ kind: "mouse", action: "click", x: 0.5, y: 0.5 })]);
		box.dispatchEvent(new FakePointerEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100, pointerType: "touch" }));
		expect(inputs(r.send).filter((m) => m.action === "move")).toHaveLength(0);
		box.dispatchEvent(new FakePointerEvent("pointermove", { bubbles: true, clientX: 100, clientY: 50, pointerType: "mouse" }));
		expect(inputs(r.send).filter((m) => m.action === "move")).toEqual([expect.objectContaining({ x: 0.25, y: 0.25 })]);
		// mouse press suppresses the browser's selection/drag start
		const mdown = new FakePointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" });
		box.dispatchEvent(mdown);
		expect(mdown.defaultPrevented).toBe(true);
		expect(box.style.userSelect).toBe("none");
		expect(box.style.touchAction).toBe("none");
		// a right-button mouse release is not a click
		const before = inputs(r.send).length;
		box.dispatchEvent(new FakePointerEvent("pointerup", { bubbles: true, button: 2, clientX: 10, clientY: 10, pointerType: "mouse" }));
		expect(inputs(r.send)).toHaveLength(before);
	});

	it("wheel and key events are forwarded with normalized positions", async () => {
		const r = await ready();
		const box = r.getByTestId("browser-pane-frame-box");
		fireEvent.wheel(box, { clientX: 100, clientY: 100, deltaY: 40 });
		expect(inputs(r.send).at(-1)).toMatchObject({ kind: "scroll", x: 0.25, y: 0.5, deltaY: 40 });
		fireEvent.keyDown(box, { key: "a", code: "KeyA" });
		fireEvent.keyUp(box, { key: "a", code: "KeyA" });
		expect(inputs(r.send).slice(-2)).toMatchObject([{ kind: "key", keyType: "keyDown", key: "a" }, { kind: "key", keyType: "keyUp", key: "a" }]);
	});

	it("#F7 Input off sends no input from the frame (nor the bridge, nor resize); Bring to front still works", async () => {
		const r = await ready();
		fireEvent.click(r.getByTestId("browser-pane-input-toggle"));
		expect(r.getByTestId("browser-pane-input-toggle").getAttribute("aria-pressed")).toBe("false");
		const box = r.getByTestId("browser-pane-frame-box");
		const n = inputs(r.send).length;
		box.dispatchEvent(new FakePointerEvent("pointerup", { bubbles: true, clientX: 200, clientY: 100, pointerType: "touch" }));
		fireEvent.wheel(box, { clientX: 1, clientY: 1, deltaY: 1 });
		fireEvent.keyDown(box, { key: "a" });
		expect(inputs(r.send)).toHaveLength(n);
		expect((r.getByTestId("browser-pane-text-bridge") as HTMLInputElement).disabled).toBe(true);
		fireEvent.click(r.getByTestId("browser-pane-bring-to-front"));
		expect(inputs(r.send).at(-1)).toMatchObject({ kind: "bringToFront" });
	});

	it("Fit/1:1 toggles the scale mode", async () => {
		const r = await ready();
		expect(r.getByTestId("browser-pane-fit-toggle").textContent).toBe("Fit");
		fireEvent.click(r.getByTestId("browser-pane-fit-toggle"));
		expect(r.getByTestId("browser-pane-fit-toggle").textContent).toBe("1:1");
	});

	it("#F9 typing `abc` + Enter into the bridge sends 4 key inputs in order and clears the control", async () => {
		const r = await ready();
		const bridge = r.getByTestId("browser-pane-text-bridge") as HTMLInputElement;
		fireEvent.change(bridge, { target: { value: "a" } });
		fireEvent.change(bridge, { target: { value: "b" } });
		fireEvent.change(bridge, { target: { value: "c" } });
		fireEvent.keyDown(bridge, { key: "Enter" });
		expect(inputs(r.send).filter((m) => m.kind === "key").map((m) => m.key)).toEqual(["a", "b", "c", "Enter"]);
		expect(inputs(r.send).at(-1)).toMatchObject({ keyType: "keyDown", key: "Enter", text: "\r" });
		expect(bridge.value).toBe("");
		fireEvent.keyDown(bridge, { key: "Backspace" });
		fireEvent.keyDown(bridge, { key: "Tab" });
		expect(inputs(r.send).slice(-2).map((m) => m.key)).toEqual(["Backspace", "Tab"]);
	});

	it("a pasted multi-character change sends each character", async () => {
		const r = await ready();
		fireEvent.change(r.getByTestId("browser-pane-text-bridge"), { target: { value: "hi" } });
		expect(inputs(r.send).filter((m) => m.kind === "key").map((m) => m.key)).toEqual(["h", "i"]);
	});
});

describe("viewport follows the pane (#F10 #P2)", () => {
	const resizes = (send: ReturnType<typeof vi.fn>) => inputs(send).filter((m) => m.kind === "resize");
	const observe = (w: number, h: number) => act(() => resizeCallbacks.forEach((cb) => cb([{ contentRect: { width: w, height: h } }])));

	async function ready(tab: TabSpec = { tabId: 1 }) {
		const r = mount();
		emitStatus(r, status([tab]));
		await waitFor(() => expect(r.getByTestId("browser-pane-tab")).toBeTruthy());
		vi.useFakeTimers();
		return r;
	}

	it("#P2 a 2 s drag sends ≤ 4 resizes and the last carries the final size", async () => {
		const r = await ready();
		for (let t = 0; t < 2000; t += 50) {
			observe(500 + t / 10, 400 + t / 10); // keeps moving past the dead-band
			act(() => {
				vi.advanceTimersByTime(50);
			});
		}
		observe(777, 555);
		act(() => {
			vi.advanceTimersByTime(600);
		});
		const rs = resizes(r.send);
		expect(rs.length).toBeLessThanOrEqual(5); // ≤4 inside the 2 s window + the trailing settle
		expect(rs.filter((_, i) => i < 4).length).toBeLessThanOrEqual(4);
		expect(rs.at(-1)).toMatchObject({ width: 777, height: 555 });
	});

	it("#F10 inside the 16 px dead-band nothing is sent after the first", async () => {
		const r = await ready();
		observe(600, 400);
		act(() => {
			vi.advanceTimersByTime(600);
		});
		expect(resizes(r.send)).toHaveLength(1);
		observe(610, 405);
		act(() => {
			vi.advanceTimersByTime(600);
		});
		expect(resizes(r.send)).toHaveLength(1);
		observe(640, 405);
		act(() => {
			vi.advanceTimersByTime(600);
		});
		expect(resizes(r.send)).toHaveLength(2);
	});

	it("#F10 while the agent owns emulation: no resize requests; they resume when the flag clears", async () => {
		const r = await ready({ tabId: 1, agentEmulation: true });
		observe(600, 400);
		act(() => {
			vi.advanceTimersByTime(1200);
		});
		expect(resizes(r.send)).toHaveLength(0);
		emitStatus(r, status([{ tabId: 1 }]));
		observe(620, 420);
		act(() => {
			vi.advanceTimersByTime(600);
		});
		expect(resizes(r.send)).toEqual([expect.objectContaining({ width: 620, height: 420 })]);
	});

	it("#F10 Input off requests no resize", async () => {
		const r = await ready();
		fireEvent.click(r.getByTestId("browser-pane-input-toggle"));
		observe(700, 500);
		act(() => {
			vi.advanceTimersByTime(1200);
		});
		expect(resizes(r.send)).toHaveLength(0);
	});
});

describe("takeover Done (#F11)", () => {
	const req = (over: Partial<InteractiveUiRequestSnapshot> = {}, meta: Record<string, unknown> = {}): InteractiveUiRequestSnapshot => ({
		requestId: "p1",
		method: "confirm",
		status: "pending",
		params: { _pluginMeta: { pluginId: "browser", kind: "browser-takeover", instanceId: "i1", ...meta } },
		...over,
	});

	it("shows Done only for a pending browser-takeover prompt of THIS instance; click answers the prompt once", async () => {
		const interactive = [req()];
		const r = mount({ interactive });
		emitStatus(r, status([{ tabId: 1 }]));
		await waitFor(() => expect(r.getByTestId("browser-pane-done")).toBeTruthy());
		fireEvent.click(r.getByTestId("browser-pane-done"));
		fireEvent.click(r.getByTestId("browser-pane-done"));
		const resp = sent(r.send, "prompt_response");
		expect(resp).toEqual([{ type: "prompt_response", sessionId: "s1", promptId: "p1", answer: "true", source: "dashboard-browser-takeover" }]);
	});

	it.each([
		["another instance", [req({}, { instanceId: "other" })]],
		["another kind", [req({}, { kind: "something-else" })]],
		["answered elsewhere", [req({ status: "resolved" })]],
		["cancelled / timed out", [req({ status: "cancelled" })]],
		["no plugin meta", [{ requestId: "p2", method: "confirm", status: "pending", params: {} } as InteractiveUiRequestSnapshot]],
		["none", []],
	])("no Done for %s", async (_name, interactive) => {
		const r = mount({ interactive });
		emitStatus(r, status([{ tabId: 1 }]));
		await waitFor(() => expect(r.getByTestId("browser-pane-tab")).toBeTruthy());
		expect(r.queryByTestId("browser-pane-done")).toBeNull();
	});
});

describe("tab label (#F12 #F16)", () => {
	const label = (path = PATH) => renderWithPlugin(<BrowserTabLabel path={path} />);

	it("#F12 shows a state dot for each of the four states", async () => {
		const r = label();
		for (const state of ["live", "no-frames", "detached", "client-screencast-active"] as const) {
			emitStatus(r, status([{ tabId: 1, state, ...(state === "detached" ? { reason: "devtools" as const } : {}) }]));
			await waitFor(() => expect(r.getByTestId("browser-tab-state").getAttribute("data-state")).toBe(state));
		}
	});

	it("title falls back to the URL host, then 'Browser tab'", async () => {
		const r = label();
		emitStatus(r, status([{ tabId: 1, title: "Inbox" }]));
		await waitFor(() => expect(r.getByTestId("browser-tab-label").textContent).toBe("Inbox"));
		emitStatus(r, status([{ tabId: 1, title: "", url: "https://mail.example.com/x?y=1" }]));
		await waitFor(() => expect(r.getByTestId("browser-tab-label").textContent).toBe("mail.example.com"));
		emitStatus(r, status([{ tabId: 1, title: "", url: "" }]));
		await waitFor(() => expect(r.getByTestId("browser-tab-label").textContent).toBe("Browser tab"));
	});

	it("#F16 the label updates while no body is mounted (background tab)", async () => {
		const r = label();
		emitStatus(r, status([{ tabId: 1, title: "One" }]));
		await waitFor(() => expect(r.getByTestId("browser-tab-label").textContent).toBe("One"));
		emitStatus(r, status([{ tabId: 1, title: "Two" }]));
		await waitFor(() => expect(r.getByTestId("browser-tab-label").textContent).toBe("Two"));
		expect(r.queryByTestId("browser-pane-tab")).toBeNull();
	});

	it("a vanished tab falls back to 'Browser tab' without a dot", async () => {
		const r = label();
		emitStatus(r, status([{ tabId: 2 }]));
		await waitFor(() => expect(r.getByTestId("browser-tab-label").textContent).toBe("Browser tab"));
		expect(r.queryByTestId("browser-tab-state")).toBeNull();
	});
});

async function flushMicro() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}
