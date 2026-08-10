/**
 * SPIKE — design D5c for change `fix-openspec-board-drop-targeting`.
 * Throwaway. Answers three questions prose could not settle:
 *   Q1  Can drag handlers defined in the PARENT of <DndContext> read the
 *       droppable rect map? If not, which of (a) child+useDndContext,
 *       (b) parent-held element refs, (c) useDndMonitor actually works?
 *   Q2  How must pointerY be derived inside onDragMove so it lives in the
 *       same coordinate space as the scroll-live Rect getters?
 *   Q3  Does dnd-kit auto-scroll the column body when `over` is the BODY
 *       (pointer in an inter-card gap) vs when `over` is a CARD?
 */
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DndContext, PointerSensor, pointerWithin, useDndContext, useDndMonitor,
  useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable } from "@dnd-kit/sortable";

const logEl = () => document.getElementById("log")!;
const log = (s: string) => { logEl().textContent += "\n" + s; };
(window as any).__spike = { results: {} as Record<string, unknown> };
const record = (k: string, v: unknown) => { (window as any).__spike.results[k] = v; };

const COLS = [
  { key: "alpha", n: 14 },   // overflows 380px -> scrollable
  { key: "beta", n: 3 },
];

function Card({ id }: { id: string }) {
  const s = useSortable({ id, data: { type: "card" } });
  return (
    <div ref={s.setNodeRef} className="card" data-card={id}
         style={{ opacity: s.isDragging ? 0.4 : 1 }}
         {...s.attributes} {...s.listeners}>
      {id}
    </div>
  );
}

function Column({ colKey, items }: { colKey: string; items: string[] }) {
  const { setNodeRef: bodyRef } = useDroppable({ id: colKey, data: { type: "body", groupKey: colKey } });
  return (
    <div className="col" data-col={colKey}>
      <div className="head">{colKey}</div>
      <div ref={bodyRef} className="body" data-body={colKey}>
        <SortableContext items={items} strategy={() => null}>
          {items.map((i) => <Card key={i} id={i} />)}
        </SortableContext>
      </div>
    </div>
  );
}

/** Q1(a)/(c): a component INSIDE DndContext — can it see the rect map? */
function Probe() {
  const ctx = useDndContext();
  const seen = useRef(false);

  useDndMonitor({
    onDragStart() {
      seen.current = false;
      log("── drag start ──");
    },
    onDragMove(e) {
      // Q1: is the rect map populated here?
      const rects = ctx.droppableRects;
      const containers = ctx.droppableContainers;
      if (!seen.current) {
        seen.current = true;
        const cardRects = [...containers].filter(([, c]) => c.data.current?.type === "card");
        record("Q1_child_rectMap_size", rects.size);
        record("Q1_child_cardContainers", cardRects.length);
        record("Q1_child_hasRects", rects.size > 0);
        log(`Q1 child: droppableRects.size=${rects.size} cardContainers=${cardRects.length}`);

        // Q2: pointerY derivation vs the real pointer position.
        const act = e.activatorEvent as PointerEvent;
        const derived = act.clientY + e.delta.y;
        const real = (window as any).__spike.lastPointerY;
        record("Q2_activatorY", act.clientY);
        record("Q2_deltaY", e.delta.y);
        record("Q2_derivedY", derived);
        record("Q2_realPointerY", real);
        record("Q2_error_px", real == null ? null : Math.round(derived - real));
        log(`Q2 pointerY: activator=${act.clientY} + delta=${Math.round(e.delta.y)} = ${Math.round(derived)} | real=${real} | err=${real == null ? "?" : Math.round(derived - real)}px`);

        // Are the rect getters scroll-live? Compare getter vs raw snapshot.
        const first = [...containers].find(([, c]) => c.data.current?.type === "card")?.[1];
        if (first?.rect.current) {
          const r: any = first.rect.current;
          record("Q1_getter_top", Math.round(r.top));
          record("Q1_raw_top", Math.round(r.rect?.top ?? NaN));
          log(`rect getter.top=${Math.round(r.top)} raw.rect.top=${Math.round(r.rect?.top ?? NaN)}`);
        }
      }
      // Q3 instrumentation: what is `over` right now, and did the body scroll?
      const body = document.querySelector('[data-body="alpha"]') as HTMLElement;
      (window as any).__spike.liveOver = e.over ? String(e.over.id) : null;
      (window as any).__spike.liveOverType = e.over?.data.current?.type ?? null;
      (window as any).__spike.bodyScrollTop = body?.scrollTop ?? null;
    },
  });
  return null;
}

function App() {
  const [cols] = useState(() =>
    COLS.map((c) => ({ key: c.key, items: Array.from({ length: c.n }, (_, i) => `${c.key}-${i + 1}`) })),
  );
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }));

  // Q1: the PARENT of <DndContext> tries to read the context — the exact
  // position OpenSpecBoardView's handlers occupy today.
  const parentCtx = useDndContext();
  record("Q1_parent_rectMap_size", parentCtx.droppableRects.size);
  record("Q1_parent_containers_size", parentCtx.droppableContainers.getEnabled().length);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={() => {
        // parent-side read, at drag time
        record("Q1_parent_rectMap_size_atDragStart", parentCtx.droppableRects.size);
        log(`Q1 parent: droppableRects.size=${parentCtx.droppableRects.size} (at drag start)`);
      }}
      onDragEnd={() => log("── drag end ──")}
    >
      <Probe />
      <div className="board">
        {cols.map((c) => <Column key={c.key} colKey={c.key} items={c.items} />)}
      </div>
    </DndContext>
  );
}

window.addEventListener("pointermove", (e) => { (window as any).__spike.lastPointerY = e.clientY; }, true);

createRoot(document.getElementById("root")!).render(<App />);
log("mounted");
