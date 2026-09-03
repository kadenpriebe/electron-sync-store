/**
 * The inspector page: the architecture diagram, drawn live from the trace
 * feed. It has no store of its own and never touches the library — it only
 * watches. Every box on screen corresponds to a file in src/, and every dot
 * that moves is one real IPC message that already happened.
 */
import type { Feed, PaneLabel, Rect, Slots } from "./demo-protocol";
import type { InspectorBridge } from "./inspector-preload";
import type { AppState } from "./state";

declare global {
  interface Window {
    __inspector: InspectorBridge;
  }
}

const inspector = window.__inspector;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element: #${id}`);
  return node as T;
}

// ---------------------------------------------------------------------------
// Bookkeeping
// ---------------------------------------------------------------------------

/** webContents.id → which pane it is. Filled by "pane-created" meta events. */
const labelOf = new Map<number, PaneLabel>();

/** Main's state at each seq, so a mirror's state can be shown from its seq. */
const stateAtSeq = new Map<number, AppState>();
let pendingState: AppState | undefined;

let firstAt: number | undefined;
let logCount = 0;

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

const logList = el<HTMLOListElement>("log");
const logCounter = el("log-count");

function describe(entry: Feed): string {
  const e = entry.event;
  switch (e.kind) {
    case "pane-created":
      return `renderer ${e.label.toUpperCase()} = webContents ${e.id}`;
    case "bootstrap-served":
      return `bootstrap → ${who(e.to)}  (seq ${e.seq})`;
    case "snapshot-served":
      return `snapshot → ${who(e.to)}  (seq ${e.seq})`;
    case "dispatch-received":
      return `dispatch ← ${who(e.from)}  ${JSON.stringify(e.action)}`;
    case "reducer-ran":
      return `reducer ${e.action.type} → ${JSON.stringify(e.after)}`;
    case "broadcast":
      return `broadcast seq ${e.seq} → ${e.to.map(who).join(", ") || "nobody"}`;
    case "bootstrap-applied":
      return `mirror populated, seq ${e.seq}`;
    case "dispatch-sent":
      return `dispatch ${JSON.stringify(e.action)}`;
    case "update-received":
      return `update seq ${e.seq}: ${e.verdict}`;
    case "resync-started":
      return "gap → asking main for a snapshot";
    case "resync-finished":
      return `snapshot seq ${e.seq}: ${e.applied ? "applied" : "discarded (stale)"}`;
    default: {
      const exhaustive: never = e;
      return String(exhaustive);
    }
  }
}

function who(id: number): string {
  const label = labelOf.get(id);
  return label ? label.toUpperCase() : `wc${id}`;
}

function log(entry: Feed): void {
  if (firstAt === undefined) firstAt = entry.at;
  const li = document.createElement("li");
  li.className = entry.side;

  const t = document.createElement("span");
  t.className = "t";
  t.textContent = `+${entry.at - firstAt} ms`;

  const s = document.createElement("span");
  s.className = "s";
  s.textContent =
    entry.side === "renderer" ? who(entry.from) : entry.side === "main" ? "main" : "·";

  const d = document.createElement("span");
  d.className = "e";
  d.textContent = describe(entry);

  li.append(t, s, d);
  logList.append(li);
  while (logList.children.length > 400) logList.firstElementChild?.remove();
  logList.scrollTop = logList.scrollHeight;

  logCount += 1;
  logCounter.textContent = String(logCount);
}

// ---------------------------------------------------------------------------
// Animation primitives
// ---------------------------------------------------------------------------

const wires = el("wires");

function center(node: HTMLElement): { x: number; y: number } {
  const r = node.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Playback speed. Each event is shown one at a time, and a burst of clicks
 * would otherwise take seconds to catch up. When the backlog grows the
 * animation shortens, so the picture never falls far behind the log.
 */
function tempo(): number {
  const backlog = queue.length;
  if (backlog > 12) return 0.15;
  if (backlog > 4) return 0.4;
  return 1;
}

/** Move a dot from one element to another. Resolves when it arrives. */
function travel(from: HTMLElement, to: HTMLElement, color: "m" | "r"): Promise<void> {
  return new Promise((resolve) => {
    const a = center(from);
    const b = center(to);
    const ms = Math.round(420 * tempo());
    const dot = document.createElement("div");
    dot.className = `dot ${color}`;
    dot.style.transitionDuration = `${ms}ms`;
    dot.style.transform = `translate(${a.x}px, ${a.y}px)`;
    wires.append(dot);

    // Force the starting transform to be laid out before changing it,
    // otherwise the browser skips straight to the destination.
    void dot.offsetWidth;

    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      dot.remove();
      resolve();
    };
    dot.addEventListener("transitionend", finish);
    setTimeout(finish, ms + 100);
    dot.style.transform = `translate(${b.x}px, ${b.y}px)`;
  });
}

function flash(node: HTMLElement, cls: string, ms = 260): Promise<void> {
  node.classList.add(cls);
  return new Promise((resolve) => {
    setTimeout(() => {
      node.classList.remove(cls);
      resolve();
    }, Math.round(ms * tempo()));
  });
}

/**
 * Events arrive within a millisecond of each other; the animation plays them
 * one at a time so the eye can follow. The log is written immediately, so the
 * real timing is always visible even while the picture is catching up.
 */
const queue: Array<() => Promise<void>> = [];
let pumping = false;

function enqueue(step: () => Promise<void>): void {
  queue.push(step);
  if (!pumping) void pump();
}

async function pump(): Promise<void> {
  pumping = true;
  while (queue.length > 0) {
    const step = queue.shift();
    if (step) await step();
  }
  pumping = false;
}

// ---------------------------------------------------------------------------
// Diagram elements
// ---------------------------------------------------------------------------

const mainSeq = el("main-seq");
const mainSubs = el("main-subs");
const mainState = el("main-state");
const boxStore = el("box-store");
const boxReducer = el("box-reducer");
const reducerLast = el("reducer-last");
const handler = {
  snapshotSync: el("h-snapshot-sync"),
  snapshot: el("h-snapshot"),
  dispatch: el("h-dispatch"),
  broadcast: el("h-broadcast"),
};

type Pane = {
  id: HTMLElement;
  preload: HTMLElement;
  boot: HTMLElement;
  mirror: HTMLElement;
  seq: HTMLElement;
  verdict: HTMLElement;
  state: HTMLElement;
  slot: HTMLElement;
};

function pane(label: PaneLabel): Pane {
  return {
    id: el(`${label}-id`),
    preload: el(`${label}-preload`),
    boot: el(`${label}-boot`),
    mirror: el(`${label}-mirror`),
    seq: el(`${label}-seq`),
    verdict: el(`${label}-verdict`),
    state: el(`${label}-state`),
    slot: el(`slot-${label}`),
  };
}

const panes: Record<PaneLabel, Pane> = { a: pane("a"), b: pane("b") };

function paneFor(id: number): Pane | undefined {
  const label = labelOf.get(id);
  return label ? panes[label] : undefined;
}

function show(state: AppState | undefined): string {
  return state ? JSON.stringify(state) : "—";
}

function setMirror(p: Pane, seq: number, state: AppState | undefined): void {
  p.seq.textContent = String(seq);
  if (state) p.state.textContent = show(state);
}

// ---------------------------------------------------------------------------
// Feed → picture
// ---------------------------------------------------------------------------

function handle(entry: Feed): void {
  log(entry);

  if (entry.side === "meta") {
    const { id, label } = entry.event;
    labelOf.set(id, label);
    panes[label].id.textContent = `webContents ${id}`;
    return;
  }

  if (entry.side === "main") {
    const e = entry.event;
    switch (e.kind) {
      case "bootstrap-served": {
        const p = paneFor(e.to);
        enqueue(async () => {
          await flash(handler.snapshotSync, "flash-main");
          if (!p) return;
          mainSubs.textContent = String(new Set(labelOf.keys()).size);
          await travel(handler.snapshotSync, p.preload, "m");
          p.boot.textContent = `booted · seq ${e.seq}`;
          await flash(p.preload, "flash-main", 200);
        });
        return;
      }
      case "snapshot-served": {
        const p = paneFor(e.to);
        enqueue(async () => {
          await flash(handler.snapshot, "flash-main");
          if (p) await travel(handler.snapshot, p.preload, "m");
        });
        return;
      }
      case "dispatch-received": {
        enqueue(() => flash(handler.dispatch, "flash-main"));
        return;
      }
      case "reducer-ran": {
        pendingState = e.after;
        enqueue(async () => {
          reducerLast.textContent = `${e.action.type} → ${show(e.after)}`;
          mainState.textContent = show(e.after);
          await flash(boxReducer, "flash-main");
        });
        return;
      }
      case "broadcast": {
        if (pendingState) stateAtSeq.set(e.seq, pendingState);
        const targets = e.to.map(paneFor).filter((p): p is Pane => p !== undefined);
        enqueue(async () => {
          mainSeq.textContent = String(e.seq);
          await flash(boxStore, "flash-main", 180);
          await flash(handler.broadcast, "flash-main", 180);
          await Promise.all(targets.map((p) => travel(handler.broadcast, p.preload, "m")));
        });
        return;
      }
      default: {
        const exhaustive: never = e;
        return exhaustive;
      }
    }
  }

  // entry.side === "renderer"
  const p = paneFor(entry.from);
  if (!p) return;
  const e = entry.event;
  switch (e.kind) {
    case "bootstrap-applied": {
      stateAtSeq.set(e.seq, e.state);
      enqueue(async () => {
        setMirror(p, e.seq, e.state);
        p.verdict.textContent = "bootstrap";
        p.verdict.className = "";
        await flash(p.mirror, "flash-rend");
      });
      return;
    }
    case "dispatch-sent": {
      enqueue(async () => {
        await flash(p.preload, "flash-rend", 150);
        await travel(p.preload, handler.dispatch, "r");
      });
      return;
    }
    case "update-received": {
      const state = stateAtSeq.get(e.seq);
      enqueue(async () => {
        p.verdict.textContent = `seq ${e.seq} · ${e.verdict}`;
        p.verdict.className = `verdict-${e.verdict}`;
        if (e.verdict === "applied") setMirror(p, e.seq, state);
        await flash(p.mirror, e.verdict === "applied" ? "flash-ok" : "flash-bad");
      });
      return;
    }
    case "resync-started": {
      enqueue(async () => {
        await travel(p.preload, handler.snapshot, "r");
      });
      return;
    }
    case "resync-finished": {
      const state = stateAtSeq.get(e.seq);
      enqueue(async () => {
        p.verdict.textContent = `resync seq ${e.seq} · ${e.applied ? "applied" : "discarded"}`;
        p.verdict.className = e.applied ? "verdict-applied" : "verdict-stale";
        if (e.applied) setMirror(p, e.seq, state);
        await flash(p.mirror, e.applied ? "flash-ok" : "flash-bad");
      });
      return;
    }
    default: {
      const exhaustive: never = e;
      return exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Layout: tell main where the real renderer panes should be drawn
// ---------------------------------------------------------------------------

function rect(node: HTMLElement): Rect {
  const r = node.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

function slots(): Slots {
  return { a: rect(panes.a.slot), b: rect(panes.b.slot) };
}

let layoutQueued = false;
function reportLayout(): void {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => {
    layoutQueued = false;
    inspector.slots(slots());
  });
}

new ResizeObserver(reportLayout).observe(panes.a.slot);
new ResizeObserver(reportLayout).observe(panes.b.slot);
window.addEventListener("resize", reportLayout);

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-reload]")) {
  button.addEventListener("click", () => {
    const label = button.dataset["reload"] as PaneLabel;
    inspector.reload(label);
  });
}

el("clear").addEventListener("click", () => {
  logList.replaceChildren();
  logCount = 0;
  logCounter.textContent = "0";
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

inspector.onFeed(handle);
inspector.ready(slots());
