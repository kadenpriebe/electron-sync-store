/**
 * The inspector page: the architecture diagram, drawn live from the trace
 * feed. It has no store of its own and never touches the library — it only
 * watches. Every box on screen corresponds to a file in src/, and every dot
 * that moves is one real IPC message that already happened.
 *
 * Three levels of looking:
 *   calm view    three boxes, one line of state each, a real page in each window
 *   details      every file and handler, plus a live event log
 *   be a click   you become one message and walk it from click to pixel, with
 *                the real values from your click
 */
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

/** Main's state at each seq, so a mirror's state can be shown from its seq. */
const stateAtSeq = new Map<number, AppState>();
let pendingState: AppState | undefined;

let firstAt: number | undefined;
let logCount = 0;

function who(id: number): string {
  const label = labelOf.get(id);
  return label ? label.toUpperCase() : `wc${id}`;
}

function show(state: AppState | undefined): string {
  return state ? JSON.stringify(state) : "—";
}

/** The calm view's one-line rendering of a state. */
function brief(state: AppState | undefined): string {
  return state ? `count ${state.count} · user ${state.user}` : "—";
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
const boundary = el("boundary");
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
  preloadBox: HTMLElement;
  preload: HTMLElement;
  boot: HTMLElement;
  mirror: HTMLElement;
  seq: HTMLElement;
  verdict: HTMLElement;
  state: HTMLElement;
  pageTitle: HTMLElement;
  slot: HTMLElement;
};

function pane(label: PaneLabel): Pane {
  return {
    id: el(`${label}-id`),
    strip: el(`${label}-strip`),
    stripState: el(`${label}-strip-state`),
    stripSeq: el(`${label}-strip-seq`),
    preloadBox: el(`${label}-preload-box`),
    preload: el(`${label}-preload`),
    boot: el(`${label}-boot`),
    mirror: el(`${label}-mirror`),
    seq: el(`${label}-seq`),
    verdict: el(`${label}-verdict`),
    state: el(`${label}-state`),
    pageTitle: el(`${label}-page-title`),
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
  if (state) {
    p.state.textContent = show(state);
    p.stripState.textContent = brief(state);
  }
}

/**
 * What is actually true right now, kept regardless of animation. The picture
 * lags behind this on purpose while dots travel; a journey rewinds the picture
 * and replays it; on exit the picture snaps back to this.
 */
const truth: {
  state?: AppState;
  seq: number;
  lastReducer?: string;
  mirrors: Record<PaneLabel, { seq: number; state?: AppState; verdict: string }>;
} = {
  seq: 0,
  mirrors: { a: { seq: 0, verdict: "—" }, b: { seq: 0, verdict: "—" } },
};

function syncPicture(): void {
  if (truth.state) setMainState(truth.state);
  mainSeq.textContent = String(truth.seq);
  if (truth.lastReducer) reducerLast.textContent = truth.lastReducer;
  for (const label of ["a", "b"] as const) {
    const m = truth.mirrors[label];
    setMirror(panes[label], m.seq, m.state);
    panes[label].verdict.textContent = m.verdict;
  }
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

const queue: Array<() => Promise<void>> = [];
let pumping = false;

/** While a journey is armed or playing, live animation is paused. */
let liveAnimation = true;

function enqueue(step: () => Promise<void>): void {
  if (!liveAnimation) return;
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
  journeyObserve(entry);

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
        mainSubs.textContent = String(labelOf.size);
        enqueue(async () => {
          await flash(at.handler("snapshotSync"), "flash-main");
          if (!p) return;
          await travel(at.handler("snapshotSync"), at.preload(p), "m");
          p.boot.textContent = `booted · seq ${e.seq}`;
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
      case "reducer-ran": {
        pendingState = e.after;
        truth.state = e.after;
        truth.lastReducer = `${e.action.type} → ${show(e.after)}`;
        enqueue(async () => {
          reducerLast.textContent = `${e.action.type} → ${show(e.after)}`;
          setMainState(e.after);
          await flash(isVisible(boxReducer) ? boxReducer : mainStrip, "flash-main");
        });
        return;
      }
      case "broadcast": {
        if (pendingState) stateAtSeq.set(e.seq, pendingState);
        truth.seq = e.seq;
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
      stateAtSeq.set(e.seq, e.state);
      if (!truth.state) truth.state = e.state;
      if (mainStripState.textContent === "—") setMainState(e.state);
      truth.mirrors[label] = { seq: e.seq, state: e.state, verdict: "bootstrap" };
      enqueue(async () => {
        setMirror(p, e.seq, e.state);
        p.verdict.textContent = "bootstrap";
        p.verdict.className = "";
        await flash(at.mirror(p), "flash-rend");
      });
      return;
    }
    case "dispatch-sent": {
      enqueue(async () => {
        await flash(at.preload(p), "flash-rend", 150);
        await travel(at.preload(p), at.handler("dispatch"), "r");
      });
      return;
    }
    case "update-received": {
      const state = stateAtSeq.get(e.seq);
      if (e.verdict === "applied") {
        truth.mirrors[label] = { seq: e.seq, state, verdict: `seq ${e.seq} · applied` };
      } else {
        truth.mirrors[label].verdict = `seq ${e.seq} · ${e.verdict}`;
      }
      enqueue(async () => {
        p.verdict.textContent = `seq ${e.seq} · ${e.verdict}`;
        p.verdict.className = `verdict-${e.verdict}`;
        if (e.verdict === "applied") setMirror(p, e.seq, state);
        await flash(at.mirror(p), e.verdict === "applied" ? "flash-ok" : "flash-bad");
      });
      return;
    }
    case "resync-started": {
      enqueue(() => travel(at.preload(p), at.handler("snapshot"), "r"));
      return;
    }
    case "resync-finished": {
      const state = stateAtSeq.get(e.seq);
      if (e.applied) {
        truth.mirrors[label] = { seq: e.seq, state, verdict: `resync seq ${e.seq} · applied` };
      }
      enqueue(async () => {
        p.verdict.textContent = `resync seq ${e.seq} · ${e.applied ? "applied" : "discarded"}`;
        p.verdict.className = e.applied ? "verdict-applied" : "verdict-stale";
        if (e.applied) setMirror(p, e.seq, state);
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

function section(title: string, ...children: (Node | string)[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const h = document.createElement("h3");
  h.textContent = title;
  frag.append(h, ...children);
  return frag;
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

  const steps = document.createElement("ol");
  for (const step of topic.steps) {
    const li = document.createElement("li");
    li.textContent = step;
    steps.append(li);
  }

  const terms = document.createElement("dl");
  for (const [term, meaning] of topic.terms) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = meaning;
    terms.append(dt, dd);
  }

  explainBody.replaceChildren(
    h2,
    file,
    paragraph(topic.who, "who"),
    section("The picture", paragraph(topic.picture)),
    section("What I actually do", steps),
    section("Say it right", terms),
    section("Why I am built this way", paragraph(topic.why)),
    section("Watch for it", paragraph(topic.watch, "watch")),
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
  if (journey.phase !== "idle") return;
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
// Be a click: you are the message
// ---------------------------------------------------------------------------

type Captured = {
  sender: Pane;
  senderLabel: PaneLabel;
  action: AppAction;
  sentAt: number;
  receivedAt?: number;
  before?: AppState;
  after?: AppState;
  seq?: number;
  targets: PaneLabel[];
  applied: Map<PaneLabel, { at: number; verdict: string; seq: number }>;
};

/** `effect` changes the picture when this stop is reached (slow-motion replay). */
type JourneyStep = { at: HTMLElement; title: string; text: string; effect?: () => void };

const journey: {
  phase: "idle" | "armed" | "playing";
  captured?: Captured;
  steps: JourneyStep[];
  index: number;
  wasDetailed: boolean;
  timer?: number;
} = { phase: "idle", steps: [], index: 0, wasDetailed: false };

const you = el("you");
const card = el("journey-card");
const cardStep = el("journey-step");
const cardTitle = el("journey-title");
const cardText = el("journey-text");
let journeyHere: HTMLElement | undefined;

function showCard(step: string, title: string, text: string): void {
  cardStep.textContent = step;
  cardTitle.textContent = title;
  cardText.textContent = text;
  card.hidden = false;
}

function placeYou(node: HTMLElement | undefined): void {
  journeyHere?.classList.remove("journey-here");
  journeyHere = node;
  if (!node) {
    you.hidden = true;
    return;
  }
  node.classList.add("journey-here");
  const c = center(node);
  const first = you.hidden;
  you.hidden = false;
  if (first) you.style.transitionDuration = "0s";
  you.style.transform = `translate(${c.x}px, ${c.y}px)`;
  if (first) {
    void you.offsetWidth;
    you.style.transitionDuration = "";
  }
}

function startJourney(): void {
  if (journey.phase !== "idle") return;
  closeExplanation();
  journey.phase = "armed";
  journey.captured = undefined;
  journey.wasDetailed = document.body.classList.contains("detailed");
  liveAnimation = false;
  queue.length = 0;
  el("journey-back").hidden = true;
  el("journey-next").hidden = true;
  showCard(
    "BE A CLICK",
    "Click + or − in either window.",
    "You are about to become that click. The screen will pause the live animation and walk you through every stop the message makes, using the real values from your click.",
  );
}

/** Watch the feed while armed; when a full round trip has been seen, play it. */
function journeyObserve(entry: Feed): void {
  if (journey.phase !== "armed") return;

  if (!journey.captured) {
    if (entry.side !== "renderer" || entry.event.kind !== "dispatch-sent") return;
    const label = labelOf.get(entry.from);
    if (!label) return;
    journey.captured = {
      sender: panes[label],
      senderLabel: label,
      action: entry.event.action,
      sentAt: entry.at,
      targets: [],
      applied: new Map(),
    };
    // Safety net: if main never answers, play what we have.
    journey.timer = window.setTimeout(playJourney, 1500);
    return;
  }

  const c = journey.captured;
  if (entry.side === "main") {
    const e = entry.event;
    if (e.kind === "dispatch-received") c.receivedAt = entry.at;
    if (e.kind === "reducer-ran") {
      c.before = e.before;
      c.after = e.after;
    }
    if (e.kind === "broadcast") {
      c.seq = e.seq;
      c.targets = e.to.map((id) => labelOf.get(id)).filter((l): l is PaneLabel => !!l);
    }
  } else if (entry.side === "renderer" && entry.event.kind === "update-received") {
    const label = labelOf.get(entry.from);
    if (label && c.seq === entry.event.seq) {
      c.applied.set(label, { at: entry.at, verdict: entry.event.verdict, seq: entry.event.seq });
    }
  }

  const complete = c.seq !== undefined && c.targets.every((l) => c.applied.has(l));
  if (complete) {
    window.clearTimeout(journey.timer);
    // Let the sender's own re-render happen before we freeze the picture.
    window.setTimeout(playJourney, 80);
  }
}

function buildSteps(c: Captured): JourneyStep[] {
  const L = c.senderLabel.toUpperCase();
  const p = c.sender;
  const actionJson = JSON.stringify(c.action);
  const seq = c.seq ?? 0;
  const prevSeq = Math.max(0, seq - 1);
  const mine = c.applied.get(c.senderLabel);
  const roundTrip = mine ? mine.at - c.sentAt : undefined;
  const others = c.targets.filter((l) => l !== c.senderLabel).map((l) => l.toUpperCase());
  const otherText = others.length ? ` Renderer ${others.join(" and ")} got the same broadcast and did the same.` : "";
  const ms = roundTrip === undefined ? "a few" : String(Math.max(1, roundTrip));
  const button = c.action.type === "increment" ? "+" : c.action.type === "decrement" ? "−" : "the input";
  const arrival =
    c.receivedAt === undefined
      ? ""
      : c.receivedAt - c.sentAt < 1
        ? ", less than a millisecond after you left"
        : `, ${c.receivedAt - c.sentAt} ms after you left`;
  const otherPanes = c.targets.filter((l) => l !== c.senderLabel).map((l) => panes[l]);

  return [
    {
      at: p.pageTitle,
      title: `You were born as a click in Renderer ${L}.`,
      text: `The page turned you into an action: ${actionJson}. That is all you are: a plain object with a type. No functions, nothing attached. The whole trip you are about to take already happened, in about ${ms} ms; the boxes above have been rewound so you can watch it in slow motion.`,
    },
    {
      at: p.mirror,
      title: "The mirror passes you along.",
      text: `The page called store.dispatch(you). This mirror is Renderer ${L}'s copy of the state, but it is not allowed to change itself. It does not know what "${c.action.type}" means. It hands you to the bridge and goes back to waiting.`,
    },
    {
      at: p.preload,
      title: "The bridge: the only door out.",
      text: `The preload script exposed exactly four things to the page, and this is one of them: dispatch. It calls ipcRenderer.send and puts you on the wire. Fire-and-forget: nobody here waits for a reply.`,
    },
    {
      at: boundary,
      title: "You are being copied.",
      text: `Two processes cannot share memory. Structured clone reads you field by field and rebuilds you inside main's memory; the original stays behind and is garbage. If you had carried a function, a promise, or a class instance with methods, this is where it would have been lost.`,
    },
    {
      at: handlerEl.dispatch,
      title: "You arrive at main.",
      text: `ipcMain.on("dispatch") received you${arrival}. Main is the only place allowed to change the state. Whatever order messages reach this counter is the order of truth. No clocks, no conflicts.`,
    },
    {
      at: boxReducer,
      title: "The reducer consumes you.",
      text: `It read your type, "${c.action.type}", and returned a new state: ${show(c.before)} → ${show(c.after)}. You, the action, end here. What continues is the new state.`,
      effect: () => {
        reducerLast.textContent = `${c.action.type} → ${show(c.after)}`;
      },
    },
    {
      at: boxStore,
      title: "The store swaps and counts.",
      text: `The store replaced its state with the reducer's result and woke its listeners. seq went from ${prevSeq} to ${seq}. That number is how every copy will check it missed nothing.`,
      effect: () => {
        if (c.after) setMainState(c.after);
        mainSeq.textContent = String(seq);
      },
    },
    {
      at: handlerEl.broadcast,
      title: "You become a broadcast.",
      text: `You are now {state, seq: ${seq}}. Main sends you to every renderer that bootstrapped: ${c.targets.map((l) => l.toUpperCase()).join(" and ") || "none"}. One copy per renderer, leaving at the same instant.`,
    },
    {
      at: boundary,
      title: "Crossing back.",
      text: `Copied again, once into each renderer's memory. Same rules as on the way up.`,
    },
    {
      at: p.preload,
      title: `Caught by Renderer ${L}'s preload.`,
      text: `ipcRenderer.on("update") receives you and hands you to the mirror's onUpdate callback. The preload does not look inside you; it only passes you through.`,
    },
    {
      at: p.mirror,
      title: "The mirror checks your number.",
      text: `Is your seq (${seq}) exactly one more than mine (${prevSeq})? ${mine ? `Verdict: ${mine.verdict}.` : "Yes."} The mirror swaps in your state and tells its subscribers. If the number had skipped, it would have refused you and asked main for a full snapshot instead.`,
      effect: () => {
        setMirror(p, seq, c.after);
        p.verdict.textContent = `seq ${seq} · ${mine?.verdict ?? "applied"}`;
        p.verdict.className = `verdict-${mine?.verdict ?? "applied"}`;
      },
    },
    {
      at: p.pageTitle,
      title: "The pixel changes.",
      text: `The page re-rendered from the mirror. The number you clicked ${button} for finally shows ${c.after?.count ?? "?"}. Round trip, click to pixel: about ${ms} ms.${otherText}`,
      effect: () => {
        for (const other of otherPanes) {
          setMirror(other, seq, c.after);
          other.verdict.textContent = `seq ${seq} · applied`;
          other.verdict.className = "verdict-applied";
        }
      },
    },
    {
      at: p.pageTitle,
      title: "The gap.",
      text: `Look back at stop 1: the window you clicked in showed nothing until now. Every step in between took about ${ms} ms, and it is still a wait the user can feel on a slow machine. Letting the mirror apply your click at stop 2 and checking against main later is called an optimistic update. It is the next thing this library is getting.`,
    },
  ];
}

function playJourney(): void {
  if (journey.phase !== "armed" || !journey.captured) return;
  journey.phase = "playing";
  setDetailed(true);
  journey.steps = buildSteps(journey.captured);
  journey.index = 0;
  el("journey-back").hidden = false;
  el("journey-next").hidden = false;
  // getBoundingClientRect forces layout, so the detailed view can be measured
  // immediately. Deliberately not requestAnimationFrame: Chromium withholds
  // animation frames from a window it considers occluded, and this must run.
  renderStep();
}

/** Put the picture back to the moment before the captured click. */
function rewindPicture(c: Captured): void {
  const prevSeq = Math.max(0, (c.seq ?? 1) - 1);
  if (c.before) setMainState(c.before);
  mainSeq.textContent = String(prevSeq);
  reducerLast.textContent = "idle";
  for (const label of c.targets) {
    const p = panes[label];
    setMirror(p, prevSeq, c.before);
    p.verdict.textContent = "—";
    p.verdict.className = "";
  }
}

function renderStep(): void {
  const step = journey.steps[journey.index];
  if (!step || !journey.captured) return;
  const last = journey.index === journey.steps.length - 1;

  // Replay: rewind, then apply every effect up to and including this stop,
  // so stepping backwards is as consistent as stepping forwards.
  rewindPicture(journey.captured);
  for (let i = 0; i <= journey.index; i++) journey.steps[i]?.effect?.();

  showCard(`STOP ${journey.index + 1} OF ${journey.steps.length}`, step.title, step.text);
  el("journey-back").toggleAttribute("disabled", journey.index === 0);
  el("journey-next").textContent = last ? "done" : "next";
  placeYou(step.at);
}

function stepJourney(delta: number): void {
  if (journey.phase !== "playing") return;
  const next = journey.index + delta;
  if (next >= journey.steps.length) {
    exitJourney();
    return;
  }
  if (next < 0) return;
  journey.index = next;
  renderStep();
}

function exitJourney(): void {
  if (journey.phase === "idle") return;
  window.clearTimeout(journey.timer);
  journey.phase = "idle";
  journey.captured = undefined;
  card.hidden = true;
  placeYou(undefined);
  liveAnimation = true;
  syncPicture();
  setDetailed(journey.wasDetailed);
}

el("journey-start").addEventListener("click", startJourney);
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-journey]")) {
  button.addEventListener("click", startJourney);
}
el("journey-next").addEventListener("click", () => stepJourney(1));
el("journey-back").addEventListener("click", () => stepJourney(-1));
el("journey-exit").addEventListener("click", exitJourney);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (journey.phase !== "idle") exitJourney();
    else closeExplanation();
  }
  if (journey.phase === "playing") {
    if (event.key === "ArrowRight") stepJourney(1);
    if (event.key === "ArrowLeft") stepJourney(-1);
  }
});

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
  // A timer rather than requestAnimationFrame, for the same reason as in
  // playJourney: this must also run while the window is occluded.
  setTimeout(() => {
    layoutQueued = false;
    inspector.slots(slots());
    if (journey.phase === "playing") placeYou(journeyHere);
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

el("clear").addEventListener("click", () => {
  logList.replaceChildren();
  logCount = 0;
  logCounter.textContent = "0";
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

inspector.onFeed(handle);
updateSide();
inspector.ready(slots());
