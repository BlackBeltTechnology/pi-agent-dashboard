/**
 * MultiSelectList — a TUI multi-select component implementing pi-tui's
 * `Component` interface. Used by `polyfillMultiselect` to emulate the
 * `ctx.ui.multiselect(...)` call that `pi-coding-agent`'s `ExtensionUIContext`
 * does not expose natively.
 *
 * Keyboard contract (intentional — no "select all" binding in TUI):
 *   ↑ / k        move cursor up
 *   ↓ / j        move cursor down
 *   space        toggle the checked state of the current item
 *   enter        confirm → onConfirm(selected[])
 *   esc          cancel  → onCancel()
 *
 * The selected array preserves the original option order, not toggle order.
 */

interface Item {
  value: string;
  label: string;
  description?: string;
  checked: boolean;
}

/**
 * Minimal shape of pi-tui's `Component` interface — we avoid importing from
 * `@earendil-works/pi-tui` directly so this module stays compile-friendly when
 * that peer dep isn't present (e.g. in unit tests running via vitest without
 * the full pi runtime).
 */
export interface ComponentLike {
  render(width: number): string[];
  handleInput?(data: string): void;
}

const CURSOR = "▸ ";
const NO_CURSOR = "  ";
const CHECKED = "[x]";
const UNCHECKED = "[ ]";
const FOOTER_HINT = "space toggle · enter confirm · esc cancel";

const MAX_VISIBLE = 10;

function truncate(text: string, maxWidth: number): string {
  if (maxWidth <= 1) return "";
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 1) return "…";
  return text.slice(0, Math.max(0, maxWidth - 1)) + "…";
}

export class MultiSelectList implements ComponentLike {
  private items: Item[];
  private cursor = 0;
  private scrollOffset = 0;

  onConfirm?: (selectedValues: string[]) => void;
  onCancel?: () => void;
  private title: string;
  private message?: string;

  constructor(
    title: string,
    options: string[],
    message?: string,
  ) {
    this.title = title;
    this.message = message;
    this.items = options.map((opt) => ({
      value: opt,
      label: opt,
      checked: false,
    }));
  }

  /** Expose current state for testing / adapters. */
  getItems(): readonly Item[] {
    return this.items;
  }
  getCursor(): number {
    return this.cursor;
  }

  /** Return values of currently checked items in original option order. */
  private selectedValues(): string[] {
    return this.items.filter((it) => it.checked).map((it) => it.value);
  }

  render(width: number): string[] {
    const lines: string[] = [];
    if (this.title) lines.push(truncate(this.title, width));
    if (this.message) lines.push(truncate(this.message, width));
    if (lines.length > 0) lines.push("");

    // Scroll window around cursor.
    const visible = Math.min(MAX_VISIBLE, this.items.length);
    if (this.cursor < this.scrollOffset) {
      this.scrollOffset = this.cursor;
    } else if (this.cursor >= this.scrollOffset + visible) {
      this.scrollOffset = this.cursor - visible + 1;
    }

    for (let i = 0; i < visible; i++) {
      const idx = this.scrollOffset + i;
      const item = this.items[idx];
      if (!item) break;
      const marker = idx === this.cursor ? CURSOR : NO_CURSOR;
      const box = item.checked ? CHECKED : UNCHECKED;
      let line = `${marker}${box} ${item.label}`;
      if (item.description) line += ` — ${item.description}`;
      lines.push(truncate(line, width));
    }

    if (this.items.length > visible) {
      lines.push(`  (${this.cursor + 1}/${this.items.length})`);
    }

    lines.push("");
    lines.push(truncate(FOOTER_HINT, width));
    return lines;
  }

  handleInput(data: string): void {
    // Escape
    if (data === "\u001b" || data === "\x1b") {
      this.onCancel?.();
      return;
    }
    // Enter (CR or LF)
    if (data === "\r" || data === "\n") {
      this.onConfirm?.(this.selectedValues());
      return;
    }
    // Space — toggle current
    if (data === " ") {
      const item = this.items[this.cursor];
      if (item) item.checked = !item.checked;
      return;
    }
    // Arrow up / k
    if (data === "\u001b[A" || data === "k") {
      if (this.cursor > 0) this.cursor--;
      return;
    }
    // Arrow down / j
    if (data === "\u001b[B" || data === "j") {
      if (this.cursor < this.items.length - 1) this.cursor++;
      return;
    }
    // Everything else (including "a", "A", bulk-toggle attempts) is a no-op.
  }
}
