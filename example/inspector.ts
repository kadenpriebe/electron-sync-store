/**
 * The inspector page: the architecture diagram, drawn live from the trace
 * feed. It has no store of its own and never touches the library — it only
 * watches. Every box on screen corresponds to a file in src/, and every dot
 * that moves is one real IPC message that already happened.
 *
 * Two levels of looking:
 *   calm view  three boxes, one line of state each, a real page in each window
 *   details    every file and handler, plus a live event log
 */
import type { Origin } from "../src/shared/protocol";
import type { Feed, PaneLabel, Rect, Slots } from "./demo-protocol";
import { topics, type Topic } from "./explanations";
import type { InspectorBridge } from "./inspector-preload";
import type { AppAction, AppState } from "./state";

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

/** A mirror's random client id → which pane it lives in. Learned from its first dispatch. */
const clientOf = new Map<string, PaneLabel>();

let firstAt: number | undefined;
let logCount = 0;

function who(id: number): string {
  const label = labelOf.get(id);
  return label ? label.toUpperCase() : `wc${id}`;
}

/** "A #3": which pane's guess, and which one. */
function whose(origin: Origin | undefined): string {
  if (!origin) return "";
  const label = clientOf.get(origin.client);
  return `${label ? label.toUpperCase() : "?"} #${origin.n}`;
}

function show(state: AppState | undefined): string {
  return state ? JSON.stringify(state) : "—";
}

/** The calm view's one-line rendering of a state. */
function brief(state: AppState | undefined): string {
  return state ? `count ${state.count} · user ${state.user}` : "—";
}

/** What an action asks for, in words rather than JSON. */
function asks(action: AppAction): string {
  switch (action.type) {
    case "increment":
      return "add 1";
    case "decrement":
      return "subtract 1";
    case "set-user":
      return `change the name to "${action.user}"`;
  }
}

/** "A and B", "A", "nobody". */
function list(names: string[]): string {
  if (names.length === 0) return "nobody";
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

const logList = el<HTMLOListElement>("log");
const logCounter = el("log-count");

function describe(entry: Feed): string {
  const e = entry.event;
  switch (e.kind) {
    case "pane-created":
      return `window ${e.label.toUpperCase()} opened · webContents ${e.id}`;
    case "reject-armed":
      return e.armed
        ? "armed: the owner will say no to the next ask"
        : "off again: the owner will say yes";
    case "bootstrap-served":
      return `gave ${who(e.to)} its first copy · change ${e.seq}`;
    case "snapshot-served":
      return `gave ${who(e.to)} a fresh copy · change ${e.seq}`;
    case "dispatch-received":
      return `${whose(e.origin)} asks to ${asks(e.action)}`;
    case "dispatch-rejected":
      return "from" in e
        ? `said no to ${whose(e.origin)}: ${e.reason} · told ${who(e.from)} alone`
        : `the owner said no to my ask #${e.origin.n}: ${e.reason} · guess undone`;
    case "dispatch-confirmed":
      return `the owner said yes to my ask #${e.origin.n} · change ${e.seq}`;
    case "mirror-changed":
      return `page now shows ${brief(e.state)}${e.pending ? ` · ${e.pending} guess${e.pending === 1 ? "" : "es"} waiting` : ""}`;
    case "reducer-ran":
      return `the rules ran ${asks(e.action)} → ${brief(e.after)}`;
    case "broadcast":
      return `sent change ${e.seq} to ${list(e.to.map(who))}${e.origin ? ` · answers ${whose(e.origin)}` : ""}`;
    case "bootstrap-applied":
      return `first copy in place · change ${e.seq}`;
    case "dispatch-sent":
      return `applied ${asks(e.action)} as a guess · asked the owner (#${e.origin.n})`;
    case "update-received":
      return `change ${e.seq} arrived · ${
        e.verdict === "applied" ? "used it" : e.verdict === "stale" ? "older than mine, ignored" : "a number is missing"
      }${e.origin ? ` · answers ${whose(e.origin)}` : ""}`;
    case "resync-started":
      return "missed a message · asking main for a fresh copy";
    case "resync-finished":
      return `fresh copy · change ${e.seq} · ${e.applied ? "used it" : "mine was newer, ignored"}`;
    default: {
      const exhaustive: never = e;
      return String(exhaustive);
    }
  }
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
    entry.side === "renderer" ? who(entry.from) : entry.side === "main" ? "owner" : "·";

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
// Diagram elements, with calm-view fallbacks
// ---------------------------------------------------------------------------

const mainStrip = el("main-strip");
const mainStripState = el("main-strip-state");
const mainSeq = el("main-seq");
const mainSubs = el("main-subs");
const mainState = el("main-state");
const boxStore = el("box-store");
const boxReducer = el("box-reducer");
const reducerLast = el("reducer-last");
const handlerEl = {
  snapshotSync: el("h-snapshot-sync"),
  snapshot: el("h-snapshot"),
  dispatch: el("h-dispatch"),
  broadcast: el("h-broadcast"),
};

type Pane = {
  id: HTMLElement;
  strip: HTMLElement;
  stripState: HTMLElement;
  stripSeq: HTMLElement;
  stripPending: HTMLElement;
  preloadBox: HTMLElement;
  preload: HTMLElement;
  boot: HTMLElement;
  mirror: HTMLElement;
  seq: HTMLElement;
  pending: HTMLElement;
  verdict: HTMLElement;
  state: HTMLElement;
  timing: HTMLElement;
  slot: HTMLElement;
};

function pane(label: PaneLabel): Pane {
  return {
    id: el(`${label}-id`),
    strip: el(`${label}-strip`),
    stripState: el(`${label}-strip-state`),
    stripSeq: el(`${label}-strip-seq`),
    stripPending: el(`${label}-strip-pending`),
    preloadBox: el(`${label}-preload-box`),
    preload: el(`${label}-preload`),
    boot: el(`${label}-boot`),
    mirror: el(`${label}-mirror`),
    seq: el(`${label}-seq`),
    pending: el(`${label}-pending`),
    verdict: el(`${label}-verdict`),
    state: el(`${label}-state`),
    timing: el(`${label}-timing`),
    slot: el(`slot-${label}`),
  };
}

const panes: Record<PaneLabel, Pane> = { a: pane("a"), b: pane("b") };

function paneFor(id: number): Pane | undefined {
  const label = labelOf.get(id);
  return label ? panes[label] : undefined;
}

function isVisible(node: HTMLElement): boolean {
  return node.offsetParent !== null;
}

/** In the calm view the detailed boxes are hidden; dots land on the strips. */
const at = {
  handler(name: keyof typeof handlerEl): HTMLElement {
    const node = handlerEl[name];
    return isVisible(node) ? node : mainStrip;
  },
  preload(p: Pane): HTMLElement {
    return isVisible(p.preload) ? p.preload : p.strip;
  },
  mirror(p: Pane): HTMLElement {
    return isVisible(p.mirror) ? p.mirror : p.strip;
  },
};

function setMainState(state: AppState): void {
  mainState.textContent = show(state);
  mainStripState.textContent = brief(state);
}

function setMirror(p: Pane, seq: number, state: AppState | undefined): void {
  p.seq.textContent = String(seq);
  p.stripSeq.textContent = String(seq);
  if (state) setMirrorState(p, state);
}

/** What the page in this pane currently sees. */
function setMirrorState(p: Pane, state: AppState): void {
  p.state.textContent = show(state);
  p.stripState.textContent = brief(state);
}

function setPending(p: Pane, n: number): void {
  p.pending.textContent = String(n);
  p.stripPending.hidden = n === 0;
  p.stripPending.textContent =
    n === 1 ? "1 guess not answered yet" : `${n} guesses not answered yet`;
}

function setVerdict(p: Pane, text: string, cls: string): void {
  p.verdict.textContent = text;
  p.verdict.className = cls;
}

// ---------------------------------------------------------------------------
// How long the owner took
// ---------------------------------------------------------------------------

/**
 * The demo's whole argument in two numbers: the page changed in 0 ms, and the
 * owner's answer arrived some time later. Measured from the feed, not
 * animated, so a pile of asks shows the real backlog.
 */
const asked = new Map<string, number>();
const waitingEl = el("waiting");

function askKey(origin: Origin): string {
  return `${origin.client}#${origin.n}`;
}

function showWaiting(): void {
  waitingEl.textContent = String(asked.size);
}

function nowAsking(origin: Origin, at: number): void {
  asked.set(askKey(origin), at);
  showWaiting();
}

function nowAnswered(p: Pane, origin: Origin, at: number, said: string): void {
  const sentAt = asked.get(askKey(origin));
  asked.delete(askKey(origin));
  showWaiting();
  if (sentAt === undefined) return;
  p.timing.textContent = `on screen in 0 ms · ${said} ${Math.max(0, at - sentAt)} ms later`;
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
 * animation shortens; past a point it is skipped altogether and the steps
 * only apply their values, so a pile of fifty asks leaves the picture correct
 * within a moment instead of a minute behind.
 */
function tempo(): number {
  const backlog = queue.length;
  if (backlog > 40) return 0;
  if (backlog > 12) return 0.15;
  if (backlog > 4) return 0.4;
  return 1;
}

/**
 * How long a dot takes to cross. When a delay has been chosen, a message
 * really does take that long, so the dot takes exactly as long and the
 * picture is true. At real speed a crossing is under a millisecond, which
 * cannot be watched, so it is replayed slowly and the header says so.
 */
const SLOW_MOTION_MS = 420;

let messageMs = 0;

function crossing(): number {
  return Math.round((messageMs || SLOW_MOTION_MS) * tempo());
}

/** Move a dot from one element to another. Resolves when it arrives. */
function travel(from: HTMLElement, to: HTMLElement, color: "m" | "r" | "x"): Promise<void> {
  const ms = crossing();
  if (ms === 0) return Promise.resolve();
  // A burst at a slow setting can put hundreds of messages in flight at once.
  // Past the point where they can be told apart, the step still takes its real
  // time but stops drawing another dot.
  if (wires.childElementCount > 120) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  return new Promise((resolve) => {
    const a = center(from);
    const b = center(to);
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
  const held = Math.round(ms * tempo());
  if (held === 0) return Promise.resolve();
  node.classList.add(cls);
  return new Promise((resolve) => {
    setTimeout(() => {
      node.classList.remove(cls);
      resolve();
    }, held);
  });
}

const queue: Array<() => Promise<void>> = [];
let pumping = false;

function enqueue(step: () => Promise<void>): void {
  // With a delay set, the delay itself spaces the events out: each step runs
  // the moment its event arrives, dots overlap exactly as the real messages
  // do, and the picture keeps the real clock. At real speed the whole trip
  // happens inside a millisecond, so the steps are played one after another
  // instead — a replay, which the header says it is.
  if (messageMs > 0) {
    void step();
    return;
  }
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
// Feed → picture
// ---------------------------------------------------------------------------

function handle(entry: Feed): void {
  log(entry);

  if (entry.side === "meta") {
    const e = entry.event;
    if (e.kind === "pane-created") {
      labelOf.set(e.id, e.label);
      panes[e.label].id.textContent = `webContents ${e.id}`;
    } else {
      showRejectArmed(e.armed);
    }
    return;
  }

  if (entry.side === "main") {
    const e = entry.event;
    switch (e.kind) {
      case "bootstrap-served": {
        const p = paneFor(e.to);
        mainSubs.textContent = String(labelOf.size);
        enqueue(async () => {
          await flash(at.handler("snapshotSync"), "flash-main");
          if (!p) return;
          await travel(at.handler("snapshotSync"), at.preload(p), "m");
          p.boot.textContent = `has change ${e.seq}`;
          await flash(at.preload(p), "flash-main", 200);
        });
        return;
      }
      case "snapshot-served": {
        const p = paneFor(e.to);
        enqueue(async () => {
          await flash(at.handler("snapshot"), "flash-main");
          if (p) await travel(at.handler("snapshot"), at.preload(p), "m");
        });
        return;
      }
      case "dispatch-received": {
        enqueue(() => flash(at.handler("dispatch"), "flash-main"));
        return;
      }
      case "dispatch-rejected": {
        const p = paneFor(e.from);
        enqueue(async () => {
          await flash(at.handler("dispatch"), "flash-bad");
          if (p) await travel(at.handler("dispatch"), at.preload(p), "x");
        });
        return;
      }
      case "reducer-ran": {
        enqueue(async () => {
          reducerLast.textContent = `${e.action.type} → ${show(e.after)}`;
          setMainState(e.after);
          await flash(isVisible(boxReducer) ? boxReducer : mainStrip, "flash-main");
        });
        return;
      }
      case "broadcast": {
        const targets = e.to.map(paneFor).filter((p): p is Pane => p !== undefined);
        enqueue(async () => {
          mainSeq.textContent = String(e.seq);
          await flash(isVisible(boxStore) ? boxStore : mainStrip, "flash-main", 180);
          await flash(at.handler("broadcast"), "flash-main", 180);
          await Promise.all(targets.map((p) => travel(at.handler("broadcast"), at.preload(p), "m")));
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
  const label = labelOf.get(entry.from);
  if (!p || !label) return;
  const e = entry.event;
  switch (e.kind) {
    case "bootstrap-applied": {
      if (mainStripState.textContent === "—") setMainState(e.state);
      enqueue(async () => {
        setMirror(p, e.seq, e.state);
        setPending(p, 0);
        setVerdict(p, "got its first copy", "");
        await flash(at.mirror(p), "flash-rend");
      });
      return;
    }
    case "dispatch-sent": {
      clientOf.set(e.origin.client, label);
      nowAsking(e.origin, entry.at);
      enqueue(async () => {
        // The guess is already on the page by the time this event exists.
        setVerdict(p, "showed my guess · waiting for an answer", "verdict-guess");
        await flash(at.mirror(p), "flash-guess", 200);
        await flash(at.preload(p), "flash-rend", 150);
        await travel(at.preload(p), at.handler("dispatch"), "r");
      });
      return;
    }
    case "dispatch-confirmed": {
      nowAnswered(p, e.origin, entry.at, "the owner said yes");
      enqueue(async () => {
        // The addressed reply, from the handler back to the sender alone.
        await travel(at.handler("dispatch"), at.preload(p), "m");
        setVerdict(p, `the owner said yes · change ${e.seq}`, "verdict-applied");
        await flash(at.mirror(p), "flash-ok", 200);
      });
      return;
    }
    case "dispatch-rejected": {
      nowAnswered(p, e.origin, entry.at, "the owner said no");
      enqueue(async () => {
        setVerdict(p, "the owner said no · guess undone", "verdict-rejected");
        await flash(at.mirror(p), "flash-bad", 500);
      });
      return;
    }
    case "mirror-changed": {
      enqueue(async () => {
        setMirrorState(p, e.state);
        setPending(p, e.pending);
      });
      return;
    }
    case "update-received": {
      const mine = e.origin && clientOf.get(e.origin.client) === label;
      const text =
        e.verdict === "applied"
          ? `change ${e.seq}${mine ? ", my own" : ""} · now official`
          : e.verdict === "stale"
            ? `change ${e.seq} · older than mine, ignored`
            : `change ${e.seq} · I missed one, asking for a fresh copy`;
      enqueue(async () => {
        setVerdict(p, text, `verdict-${e.verdict}`);
        // The state the page sees follows in its own "mirror-changed" event.
        if (e.verdict === "applied") setMirror(p, e.seq, undefined);
        await flash(at.mirror(p), e.verdict === "applied" ? "flash-ok" : "flash-bad");
      });
      return;
    }
    case "resync-started": {
      enqueue(() => travel(at.preload(p), at.handler("snapshot"), "r"));
      return;
    }
    case "resync-finished": {
      const text = `fresh copy · change ${e.seq} · ${e.applied ? "now official" : "mine was newer, ignored"}`;
      enqueue(async () => {
        setVerdict(p, text, e.applied ? "verdict-applied" : "verdict-stale");
        if (e.applied) setMirror(p, e.seq, undefined);
        await flash(at.mirror(p), e.applied ? "flash-ok" : "flash-bad");
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
// Side column: intro, explanation, or log
// ---------------------------------------------------------------------------

const introPanel = el("intro");
const explainPanel = el("explain");
const explainBody = el("explain-body");
const logPanel = el("log-panel");
let selected: HTMLElement | undefined;
let explaining = false;

function updateSide(): void {
  explainPanel.hidden = !explaining;
  const detailed = document.body.classList.contains("detailed");
  introPanel.hidden = explaining || detailed;
  logPanel.hidden = explaining || !detailed;
}

function paragraph(text: string, cls?: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.textContent = text;
  if (cls) p.className = cls;
  return p;
}

function renderTopic(topic: Topic, tone: "main" | "rend" | ""): void {
  const h2 = document.createElement("h2");
  h2.textContent = topic.title;

  const file = document.createElement("div");
  file.className = "file";
  file.textContent = topic.file;

  const heading = document.createElement("h3");
  heading.textContent = "What I actually do";

  const steps = document.createElement("ol");
  for (const step of topic.steps) {
    const li = document.createElement("li");
    li.textContent = step;
    steps.append(li);
  }

  const code: HTMLElement[] = [];
  if (topic.code) {
    const codeHeading = document.createElement("h3");
    codeHeading.textContent = "What the compiler refuses";
    const pre = document.createElement("pre");
    pre.textContent = topic.code.join("\n");
    code.push(codeHeading, pre);
  }

  explainBody.replaceChildren(
    h2,
    file,
    ...(topic.essence ? [paragraph(topic.essence, "who")] : []),
    heading,
    steps,
    ...code,
  );
  explainBody.scrollTop = 0;
  explainPanel.className = `explain ${tone ? `${tone}-topic` : ""}`;
  explaining = true;
  updateSide();
}

function select(target: HTMLElement | undefined, key: string): void {
  const topic = topics[key];
  if (!topic) return;
  selected?.classList.remove("selected");
  selected = target;
  selected?.classList.add("selected");

  const tone = target?.closest(".proc.main")
    ? "main"
    : target?.closest(".proc.rend")
      ? "rend"
      : "";
  renderTopic(topic, tone);
}

function closeExplanation(): void {
  selected?.classList.remove("selected");
  selected = undefined;
  explaining = false;
  updateSide();
}

document.addEventListener("click", (event) => {
  const origin = event.target as HTMLElement;
  if (origin.closest("button")) return;
  const target = origin.closest<HTMLElement>("[data-explain]");
  if (!target) return;
  select(target, target.dataset["explain"] ?? "");
});

// Hover highlights only the innermost clickable box, not every ancestor.
let hovered: HTMLElement | undefined;
document.addEventListener("mouseover", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-explain]");
  if (target === hovered) return;
  hovered?.classList.remove("hover");
  hovered = target ?? undefined;
  hovered?.classList.add("hover");
});

el("explain-close").addEventListener("click", closeExplanation);

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-topic]")) {
  button.addEventListener("click", () => {
    select(undefined, button.dataset["topic"] ?? "");
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeExplanation();
});

// ---------------------------------------------------------------------------
// Details toggle
// ---------------------------------------------------------------------------

const detailsToggle = el<HTMLButtonElement>("details-toggle");

function setDetailed(on: boolean): void {
  document.body.classList.toggle("detailed", on);
  detailsToggle.textContent = on ? "hide details" : "show details";
  detailsToggle.classList.toggle("on", on);
  updateSide();
  reportLayout();
}

detailsToggle.addEventListener("click", () => {
  setDetailed(!document.body.classList.contains("detailed"));
});
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-details]")) {
  button.addEventListener("click", () => setDetailed(true));
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
  // A timer rather than requestAnimationFrame: Chromium withholds animation
  // frames from a window it considers occluded, and this must still run.
  setTimeout(() => {
    layoutQueued = false;
    inspector.slots(slots());
  }, 0);
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

const rejectButton = el<HTMLButtonElement>("reject-next");
let rejectArmed = false;

function showRejectArmed(armed: boolean): void {
  rejectArmed = armed;
  rejectButton.classList.toggle("armed", armed);
  rejectButton.textContent = armed ? "armed · the owner will say no" : "make the owner say no";
}

rejectButton.addEventListener("click", () => {
  inspector.rejectNext(!rejectArmed);
});

// 25 asks from each window, all at once. The owner answers them one at a time.
el("rush").addEventListener("click", () => inspector.rush(25));

const dotsNote = el("dots-note");

function setMessageMs(ms: number): void {
  messageMs = ms;
  dotsNote.textContent =
    ms === 0 ? "dots: slow motion · a real trip is under 1 ms" : "dots: real time";
  dotsNote.title =
    ms === 0
      ? "A crossing really takes under a millisecond, too fast to watch. The dots are a replay; the true times are on each window's line and in the log."
      : `A crossing really takes ${ms} ms now, and that is how long each dot takes.`;
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-latency]")) {
  button.addEventListener("click", () => {
    for (const other of document.querySelectorAll("[data-latency]")) other.classList.remove("on");
    button.classList.add("on");
    const ms = Number(button.dataset["latency"]);
    setMessageMs(ms);
    inspector.latency(ms);
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
setMessageMs(0);
updateSide();
inspector.ready(slots());
