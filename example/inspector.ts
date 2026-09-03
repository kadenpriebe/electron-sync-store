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
    case "reject-armed":
      return e.armed ? "chaos switch armed: main will refuse the next proposal" : "chaos switch off";
    case "bootstrap-served":
      return `bootstrap → ${who(e.to)}  (seq ${e.seq})`;
    case "snapshot-served":
      return `snapshot → ${who(e.to)}  (seq ${e.seq})`;
    case "dispatch-received":
      return `dispatch ← ${whose(e.origin)}  ${JSON.stringify(e.action)}`;
    case "dispatch-rejected":
      return "from" in e
        ? `refused ${whose(e.origin)}: ${e.reason} → reply to ${who(e.from)} only`
        : `main refused #${e.origin.n}: ${e.reason} → rolled back`;
    case "dispatch-confirmed":
      return `main confirmed #${e.origin.n} at seq ${e.seq}`;
    case "mirror-changed":
      return `page sees ${brief(e.state)}${e.pending ? ` · ${e.pending} pending` : ""}`;
    case "reducer-ran":
      return `reducer ${e.action.type} → ${JSON.stringify(e.after)}`;
    case "broadcast":
      return `broadcast seq ${e.seq}${e.origin ? ` (${whose(e.origin)})` : ""} → ${e.to.map(who).join(", ") || "nobody"}`;
    case "bootstrap-applied":
      return `mirror populated, seq ${e.seq}`;
    case "dispatch-sent":
      return `guess #${e.origin.n} ${JSON.stringify(e.action)} applied, sent to main`;
    case "update-received":
      return `update seq ${e.seq}: ${e.verdict}${e.origin ? ` (${whose(e.origin)})` : ""}`;
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
  stripPending: HTMLElement;
  preloadBox: HTMLElement;
  preload: HTMLElement;
  boot: HTMLElement;
  mirror: HTMLElement;
  seq: HTMLElement;
  pending: HTMLElement;
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
    stripPending: el(`${label}-strip-pending`),
    preloadBox: el(`${label}-preload-box`),
    preload: el(`${label}-preload`),
    boot: el(`${label}-boot`),
    mirror: el(`${label}-mirror`),
    seq: el(`${label}-seq`),
    pending: el(`${label}-pending`),
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
  p.stripPending.textContent = n === 1 ? "1 guess pending" : `${n} guesses pending`;
}

function setVerdict(p: Pane, text: string, cls: string): void {
  p.verdict.textContent = text;
  p.verdict.className = cls;
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
  mirrors: Record<
    PaneLabel,
    { seq: number; state?: AppState; verdict: string; verdictClass: string; pending: number }
  >;
} = {
  seq: 0,
  mirrors: {
    a: { seq: 0, verdict: "—", verdictClass: "", pending: 0 },
    b: { seq: 0, verdict: "—", verdictClass: "", pending: 0 },
  },
};

function syncPicture(): void {
  if (truth.state) setMainState(truth.state);
  mainSeq.textContent = String(truth.seq);
  if (truth.lastReducer) reducerLast.textContent = truth.lastReducer;
  for (const label of ["a", "b"] as const) {
    const m = truth.mirrors[label];
    setMirror(panes[label], m.seq, m.state);
    setPending(panes[label], m.pending);
    setVerdict(panes[label], m.verdict, m.verdictClass);
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
function travel(from: HTMLElement, to: HTMLElement, color: "m" | "r" | "x"): Promise<void> {
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
      case "dispatch-rejected": {
        const p = paneFor(e.from);
        enqueue(async () => {
          await flash(at.handler("dispatch"), "flash-bad");
          if (p) await travel(at.handler("dispatch"), at.preload(p), "x");
        });
        return;
      }
      case "reducer-ran": {
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
      if (!truth.state) truth.state = e.state;
      if (mainStripState.textContent === "—") setMainState(e.state);
      truth.mirrors[label] = {
        seq: e.seq,
        state: e.state,
        verdict: "bootstrap",
        verdictClass: "",
        pending: 0,
      };
      enqueue(async () => {
        setMirror(p, e.seq, e.state);
        setPending(p, 0);
        setVerdict(p, "bootstrap", "");
        await flash(at.mirror(p), "flash-rend");
      });
      return;
    }
    case "dispatch-sent": {
      clientOf.set(e.origin.client, label);
      const m = truth.mirrors[label];
      m.verdict = `guess #${e.origin.n} · waiting for main`;
      m.verdictClass = "verdict-guess";
      enqueue(async () => {
        // The guess is already on the page by the time this event exists.
        setVerdict(p, `guess #${e.origin.n} · waiting for main`, "verdict-guess");
        await flash(at.mirror(p), "flash-guess", 200);
        await flash(at.preload(p), "flash-rend", 150);
        await travel(at.preload(p), at.handler("dispatch"), "r");
      });
      return;
    }
    case "dispatch-confirmed": {
      const m = truth.mirrors[label];
      m.verdict = `#${e.origin.n} confirmed · seq ${e.seq}`;
      m.verdictClass = "verdict-applied";
      enqueue(async () => {
        // The addressed reply, from the handler back to the sender alone.
        await travel(at.handler("dispatch"), at.preload(p), "m");
        setVerdict(p, `#${e.origin.n} confirmed · seq ${e.seq}`, "verdict-applied");
        await flash(at.mirror(p), "flash-ok", 200);
      });
      return;
    }
    case "dispatch-rejected": {
      const m = truth.mirrors[label];
      m.verdict = `#${e.origin.n} refused · rolled back`;
      m.verdictClass = "verdict-rejected";
      enqueue(async () => {
        setVerdict(p, `#${e.origin.n} refused · rolled back`, "verdict-rejected");
        await flash(at.mirror(p), "flash-bad", 500);
      });
      return;
    }
    case "mirror-changed": {
      const m = truth.mirrors[label];
      m.state = e.state;
      m.pending = e.pending;
      enqueue(async () => {
        setMirrorState(p, e.state);
        setPending(p, e.pending);
      });
      return;
    }
    case "update-received": {
      const m = truth.mirrors[label];
      const mine = e.origin && clientOf.get(e.origin.client) === label;
      const text = `seq ${e.seq} · ${e.verdict}${mine ? ` · own #${e.origin?.n}` : ""}`;
      if (e.verdict === "applied") m.seq = e.seq;
      m.verdict = text;
      m.verdictClass = `verdict-${e.verdict}`;
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
      const m = truth.mirrors[label];
      const text = `resync seq ${e.seq} · ${e.applied ? "applied" : "discarded"}`;
      if (e.applied) m.seq = e.seq;
      m.verdict = text;
      m.verdictClass = e.applied ? "verdict-applied" : "verdict-stale";
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
  origin: Origin;
  sentAt: number;
  /** What the sender's page showed the moment it guessed. */
  guess?: AppState;
  receivedAt?: number;
  before?: AppState;
  after?: AppState;
  seq?: number;
  /** Main refused; the reason. */
  rejected?: string;
  /** When main's reply reached the sender. */
  replyAt?: number;
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
      origin: entry.event.origin,
      sentAt: entry.at,
      // The mirror re-derived and told us before it sent; that was the guess.
      guess: truth.mirrors[label].state,
      targets: [],
      applied: new Map(),
    };
    // Safety net: if main never answers, play what we have.
    journey.timer = window.setTimeout(playJourney, 4000);
    return;
  }

  const c = journey.captured;
  if (entry.side === "main") {
    const e = entry.event;
    if (e.kind === "dispatch-received") c.receivedAt = entry.at;
    if (e.kind === "dispatch-rejected") c.rejected = e.reason;
    if (e.kind === "reducer-ran") {
      c.before = e.before;
      c.after = e.after;
    }
    if (e.kind === "broadcast") {
      c.seq = e.seq;
      c.targets = e.to.map((id) => labelOf.get(id)).filter((l): l is PaneLabel => !!l);
    }
  } else if (entry.side === "renderer") {
    const label = labelOf.get(entry.from);
    const e = entry.event;
    if (e.kind === "update-received" && label && c.seq === e.seq) {
      c.applied.set(label, { at: entry.at, verdict: e.verdict, seq: e.seq });
    }
    if (label === c.senderLabel && (e.kind === "dispatch-confirmed" || e.kind === "dispatch-rejected")) {
      c.replyAt = entry.at;
    }
  }

  const complete =
    c.rejected !== undefined
      ? c.replyAt !== undefined
      : c.seq !== undefined && c.replyAt !== undefined && c.targets.every((l) => c.applied.has(l));
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
  const n = c.origin.n;
  const seq = c.seq ?? truth.seq;
  const prevSeq = c.seq === undefined ? truth.seq : c.seq - 1;
  const mine = c.applied.get(c.senderLabel);
  const others = c.targets.filter((l) => l !== c.senderLabel).map((l) => l.toUpperCase());
  const roundTrip = c.replyAt === undefined ? undefined : c.replyAt - c.sentAt;
  const ms = roundTrip === undefined ? "a few" : String(Math.max(1, roundTrip));
  const button = c.action.type === "increment" ? "+" : c.action.type === "decrement" ? "−" : "the input";
  const arrival =
    c.receivedAt === undefined
      ? ""
      : c.receivedAt - c.sentAt < 1
        ? ", less than a millisecond after you left"
        : `, ${c.receivedAt - c.sentAt} ms after you left`;
  const otherPanes = c.targets.filter((l) => l !== c.senderLabel).map((l) => panes[l]);
  const guessCount = c.guess?.count ?? "?";

  const outbound: JourneyStep[] = [
    {
      at: p.pageTitle,
      title: `You were born as a click in Renderer ${L}.`,
      text: `The page turned you into an action: ${actionJson}. That is all you are: a plain object with a type. The whole trip you are about to take already happened, in about ${ms} ms. The boxes above have been rewound so you can watch it in slow motion. Keep an eye on the number in this window: it changes at the very next stop, before anything has crossed to main.`,
    },
    {
      at: p.mirror,
      title: "The mirror applies you at once, as a guess.",
      text: `store.dispatch(you) pushed you onto the pending list and re-ran the reducer over the confirmed state: ${show(c.before ?? c.guess)} → ${show(c.guess)}. The page re-rendered from that. Nobody has asked main anything yet. This is the optimistic update: the assumption that main will agree, made visible immediately, and tagged as guess #${n} so the answer can find it later.`,
      effect: () => {
        if (c.guess) setMirrorState(p, c.guess);
        setPending(p, 1);
        setVerdict(p, `guess #${n} · waiting for main`, "verdict-guess");
      },
    },
    {
      at: p.preload,
      title: "The bridge: the only door out.",
      text: `The preload exposed exactly four things to the page, and this is one of them: dispatch. It calls ipcRenderer.invoke with {origin: {client, n: ${n}}, action}. invoke, not send: a promise now waits for main's verdict, and the page may ignore it or use it.`,
    },
    {
      at: boundary,
      title: "You are being copied.",
      text: `Two processes cannot share memory. Structured clone reads you field by field and rebuilds you inside main's memory; the original stays behind and is garbage. If you had carried a function, a promise, or a class instance with methods, this is where it would have been lost.`,
    },
    {
      at: handlerEl.dispatch,
      title: "You arrive at main.",
      text: `ipcMain.handle("dispatch") received you${arrival}. Main is the only place allowed to change the state. Whatever order messages reach this counter is the order of truth. Main notes your origin, ${L} #${n}, so that whatever you cause can carry it.`,
    },
  ];

  if (c.rejected !== undefined) {
    return [
      ...outbound,
      {
        at: boxReducer,
        title: "The reducer refuses you.",
        text: `It threw: "${c.rejected}". The store never swapped, seq stays ${seq}, and no broadcast leaves. Main caught the throw and turned it into a reply. In an application this is any rule only main can check: a permission, a quota, a value that changed under the user's feet.`,
        effect: () => {
          reducerLast.textContent = `${c.action.type} → threw`;
        },
      },
      {
        at: handlerEl.dispatch,
        title: "You go back as a verdict.",
        text: `{status: "rejected", reason: "${c.rejected}"}, addressed to Renderer ${L} alone. No other window ever hears that you existed. That is what the addressed reply can do that a broadcast cannot: say no to one window.`,
      },
      {
        at: boundary,
        title: "Crossing back.",
        text: `Copied once more, into Renderer ${L}'s memory only.`,
      },
      {
        at: p.preload,
        title: `Caught by Renderer ${L}'s preload.`,
        text: `The promise from stop 3 resolves with the verdict, ${ms} ms after you left. It resolves, it does not reject: a caller that ignored the promise is not holding an unhandled rejection.`,
      },
      {
        at: p.mirror,
        title: "The rollback.",
        text: `Guess #${n} leaves the pending list and the visible state is re-derived from the confirmed state: ${show(c.before ?? c.guess)}. Nothing was saved and restored. The replay simply no longer includes you, which is why a guess from another window, or a newer guess of your own, would have survived this untouched.`,
        effect: () => {
          if (c.before) setMirrorState(p, c.before);
          setPending(p, 0);
          setVerdict(p, `#${n} refused · rolled back`, "verdict-rejected");
        },
      },
      {
        at: p.pageTitle,
        title: "The pixel snaps back.",
        text: `The number showed ${guessCount} for ${ms} ms and shows ${c.before?.count ?? "?"} again now, with the reason underneath. That is the honest cost of guessing: a wrong guess is visible for one round trip. The library's job was to make it exactly one round trip, roll back nothing else, and tell the page why.`,
      },
    ];
  }

  return [
    ...outbound,
    {
      at: boxReducer,
      title: "The reducer consumes you.",
      text: `It read your type, "${c.action.type}", and returned a new state: ${show(c.before)} → ${show(c.after)}. The same reducer the mirror ran at stop 2, so the same answer. You, the action, end here. What continues is the new state.`,
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
      text: `You are now {state, seq: ${seq}, origin: ${L} #${n}}. Main sends you to every renderer that bootstrapped: ${c.targets.map((l) => l.toUpperCase()).join(" and ") || "none"}. One copy per renderer, leaving at the same instant. The origin is the part only Renderer ${L} will care about.`,
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
      title: "The mirror checks your number, and your origin.",
      text: `Is your seq (${seq}) exactly one more than mine (${prevSeq})? ${mine ? `Verdict: ${mine.verdict}.` : "Yes."} You become the confirmed state. And your origin is this mirror's own guess #${n}, so the guess is retired in the same step. Pending is empty; the page shows ${c.after?.count ?? "?"}, the number it has shown since stop 2. Without the origin the guess would have been replayed on top of you and shown ${typeof c.after?.count === "number" ? c.after.count + (c.action.type === "increment" ? 1 : c.action.type === "decrement" ? -1 : 0) : "N+2"} for a moment.`,
      effect: () => {
        setMirror(p, seq, c.after);
        setPending(p, 0);
        setVerdict(p, `seq ${seq} · ${mine?.verdict ?? "applied"} · own #${n}`, `verdict-${mine?.verdict ?? "applied"}`);
      },
    },
    {
      at: p.preload,
      title: "The verdict arrives.",
      text: `{status: "confirmed", seq: ${seq}} resolves the promise from stop 3, ${ms} ms after you left. Nothing changes on screen; the page already knew. This reply is addressed to Renderer ${L} alone, and it is also the safety net: had the broadcast been lost, the seq in here is what would retire the guess after the resync.`,
      effect: () => {
        setVerdict(p, `#${n} confirmed · seq ${seq}`, "verdict-applied");
      },
    },
    {
      at: p.pageTitle,
      title: "The other windows catch up.",
      text: `${others.length ? `Renderer ${others.join(" and ")} got the same broadcast, without a matching origin, and applied it the ordinary way, about ${ms} ms after your click.` : "No other renderer was open to catch up."} For the window that clicked, click to pixel was zero waiting: it changed at stop 2 and spent stops 3 to ${outbound.length + 7} checking.`,
      effect: () => {
        for (const other of otherPanes) {
          setMirror(other, seq, c.after);
          setVerdict(other, `seq ${seq} · applied`, "verdict-applied");
        }
      },
    },
    {
      at: p.pageTitle,
      title: "Why this is the point.",
      text: `Every Electron state library surveyed for this project waits for the broadcast before changing the pixel. This one changed it at stop 2 and used the rest of the trip to check the guess. When the guess is wrong, main says so and only that guess is rolled back. Press "reject next", then "be a click" again, to walk that path.`,
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
  const prevSeq = c.seq === undefined ? truth.seq : c.seq - 1;
  if (c.before) setMainState(c.before);
  mainSeq.textContent = String(prevSeq);
  reducerLast.textContent = "idle";
  for (const label of new Set([c.senderLabel, ...c.targets])) {
    const p = panes[label];
    setMirror(p, prevSeq, c.before);
    setPending(p, 0);
    setVerdict(p, "—", "");
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

const rejectButton = el<HTMLButtonElement>("reject-next");
let rejectArmed = false;

function showRejectArmed(armed: boolean): void {
  rejectArmed = armed;
  rejectButton.classList.toggle("armed", armed);
  rejectButton.textContent = armed ? "reject next · armed" : "reject next";
}

rejectButton.addEventListener("click", () => {
  inspector.rejectNext(!rejectArmed);
});

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-latency]")) {
  button.addEventListener("click", () => {
    for (const other of document.querySelectorAll("[data-latency]")) other.classList.remove("on");
    button.classList.add("on");
    inspector.latency(Number(button.dataset["latency"]));
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
