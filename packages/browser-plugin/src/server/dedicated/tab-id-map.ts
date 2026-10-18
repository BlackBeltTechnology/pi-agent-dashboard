/**
 * Per-instance numeric tab ids (change: add-dedicated-agent-browser, D4). Status,
 * pane paths and the screencast tap address tabs by number; CDP uses string
 * `targetId`s. Ids are minted from 1, never reused within an instance.
 */
export class TabIdMap {
  private next = 1;
  private readonly byTarget = new Map<string, number>();
  private readonly byTab = new Map<number, string>();

  /** The tab id of a target, minting one on first sight. */
  assign(targetId: string): number {
    let id = this.byTarget.get(targetId);
    if (id === undefined) {
      id = this.next++;
      this.byTarget.set(targetId, id);
      this.byTab.set(id, targetId);
    }
    return id;
  }

  tabIdFor(targetId: string): number | undefined {
    return this.byTarget.get(targetId);
  }

  targetFor(tabId: number): string | undefined {
    return this.byTab.get(tabId);
  }
}
