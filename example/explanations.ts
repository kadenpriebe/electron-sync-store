/**
 * What each box in the inspector says about itself when clicked.
 *
 * Written in the first person, as the file talking. Every everyday picture is
 * paired with the real term, so the picture builds intuition and the term is
 * what you say out loud.
 */

export type Topic = {
  /** Short name shown as the panel heading. */
  title: string;
  /** The file (or concept) this is. */
  file: string;
  /** One sentence: what I am. */
  who: string;
  /** The everyday picture, in my own voice. */
  picture: string;
  /** What I actually do, in order. */
  steps: string[];
  /** Term → what it means. These are the words to use in conversation. */
  terms: Array<[string, string]>;
  /** Why I am built this way, or what breaks without me. */
  why: string;
  /** What to look for in the live diagram. */
  watch: string;
};

export const topics: Record<string, Topic> = {
  overview: {
    title: "The whole picture",
    file: "how to read this screen",
    who: "This screen is the architecture of the library, drawn from what the code actually does as it runs.",
    picture:
      "Think of a restaurant with one kitchen and many dining rooms. The kitchen (main process) is the only place food gets made. Each dining room (renderer process) has a menu board that shows what's available right now. Nobody in a dining room cooks; they send an order slip to the kitchen, and the kitchen updates every board when something changes. Everything you see here is that: one kitchen up top, two dining rooms below, and slips travelling between them.",
    steps: [
      "The top box is the main process. It owns the state and is the only thing allowed to change it.",
      "The dashed line is the process boundary. Nothing crosses it except copied messages.",
      "The two boxes below are renderer processes. Each holds a full copy of the state (a mirror) and shows a real page.",
      "Dots are IPC messages. Blue leaves a renderer; amber leaves main. They are slowed down so you can see them.",
      "The log on the right records the same events with real timestamps, which are usually under a millisecond apart.",
    ],
    terms: [
      ["main process", "the Node.js side of Electron; owns windows, files, the OS. One per app."],
      ["renderer process", "a Chromium page. One per window or pane. Cannot touch Node directly."],
      ["IPC", "inter-process communication: the only way main and a renderer can talk."],
      ["mirror", "this library's word for a renderer's full local copy of main's state."],
    ],
    why: "Two processes cannot share memory. That single fact forces every design decision you see here: someone must own the truth, everyone else must hold a copy, and copies must be kept current by messages.",
    watch: "Click + in a pane and follow one dot up to main and two dots back down. That round trip is the whole library in one motion.",
  },

  main: {
    title: "Main process",
    file: "src/main/index.ts",
    who: "I am the kitchen. The state lives in me, and I am the only one who ever changes it.",
    picture:
      "Every order slip comes to me. I cook it in the order the slips arrive, and after each one I write the new menu on every dining room's board. Because there is only one of me, there is never a question of which order came first: whatever reached my counter first, went first. That is what gives the whole system a single, agreed history without any clocks or conflict resolution.",
    steps: [
      "Create the core store with the app's reducer and initial state.",
      "Register four IPC handlers before any window exists (the bootstrap one must be listening before a preload asks, or that preload blocks forever).",
      "When a dispatch arrives, run it through the reducer.",
      "After every change, increment seq and send {state, seq} to every renderer that has bootstrapped.",
    ],
    terms: [
      ["single writer", "exactly one place may mutate state. Everything else proposes."],
      ["total order", "every change has a definite position in one sequence. Arrival order at the single writer is that order."],
      ["seq / sequence number", "a counter of how many changes I have applied, ever. Stamped on every broadcast."],
      ["subscriber", "a webContents that bootstrapped and therefore has a mirror to keep current."],
    ],
    why: "If two places could write, they could disagree, and then you need clocks, versions and merge rules. Making me the only writer removes that whole category of problem. The price is that every write takes a round trip through me.",
    watch: "Click any of my four handler chips to see one conversation at a time. Watch seq climb by exactly one per reducer run.",
  },

  store: {
    title: "Store",
    file: "src/core/store.ts",
    who: "I am the smallest piece: a value, a function that replaces it, and a list of people to tell.",
    picture:
      "I am a whiteboard with a rule. You cannot scribble on me. You hand me a note (an action), I hand the note and the current board to the reducer, the reducer gives me a new board, and I swap it in. Then I tap everyone on the list and say 'the board changed'. That is all I know how to do, and I deliberately know nothing about Electron, windows or messages.",
    steps: [
      "getState() returns the current value. Always synchronous, never crosses a process.",
      "dispatch(action) runs the reducer and stores what it returns, then notifies every listener.",
      "subscribe(listener) adds a callback and returns a function that removes it again.",
    ],
    terms: [
      ["reducer", "a pure function (state, action) → new state. No side effects, no mutation."],
      ["listener / subscriber", "a callback that is invoked after each change with the new state."],
      ["unsubscribe handle", "the function subscribe returns; calling it removes the listener. React's useSyncExternalStore expects exactly this shape."],
      ["pure", "same inputs, same output, touches nothing outside itself. This is what makes replaying actions safe."],
    ],
    why: "Keeping Electron out of me is the seam that makes tests possible. I can be exercised in plain Node with no windows. And the same me runs inside every renderer's mirror, so the logic that produces state in main is the logic that will predict it locally.",
    watch: "My seq and subscribers counters, and the state below them. seq is main's count; it only ever goes up.",
  },

  reducer: {
    title: "Reducer",
    file: "example/state.ts",
    who: "I am the app's rulebook: given the current state and an action, I say what the next state is.",
    picture:
      "I am the recipe card. The kitchen never improvises; it looks up the action's name on my card and follows the steps exactly. 'increment' means count goes up by one. 'set-user' means replace the name. I never modify the old state; I always return a fresh one. And because I am just a function, the same card can sit in the kitchen and in every dining room.",
    steps: [
      "Receive (state, action).",
      "Switch on action.type and return a new state object for that case.",
      "In the default branch, assign the action to a variable typed `never`. If a new action type is added and not handled, this line stops compiling.",
    ],
    terms: [
      ["discriminated union", "a set of object shapes told apart by one shared field (here, `type`)."],
      ["exhaustiveness check", "using `never` so the compiler proves every case is handled."],
      ["immutable update", "returning a new object ({ ...state, count: state.count + 1 }) instead of editing the old one."],
    ],
    why: "The library is generic: it does not know what your state looks like. I am where the app's meaning lives. Keeping me pure is what will let a renderer run me locally to guess the outcome before main confirms it (that is the next feature).",
    watch: "I flash amber when I run, and the text shows the action and the state I produced.",
  },

  "h-snapshot-sync": {
    title: "snapshot-sync handler",
    file: "src/main/index.ts · ipcMain.on",
    who: "I answer the one blocking question a renderer ever asks: 'what is the state right now?'",
    picture:
      "A new dining room opens. Before the doors unlock, the host phones the kitchen and waits on the line until I read out the whole menu. Only then do the doors open. Nobody is inside yet, so nobody is kept waiting. I also write that room's name in my subscriber list, so from now on it gets every board update.",
    steps: [
      "A preload calls ipcRenderer.sendSync on my channel and blocks.",
      "I add event.sender to the subscriber set (a Set, so a reload of the same renderer does not add it twice).",
      "I set event.returnValue to {state, seq}. Setting returnValue is what unblocks the caller.",
    ],
    terms: [
      ["sendSync", "a renderer→main call that blocks the renderer until main sets event.returnValue."],
      ["bootstrap", "the first fetch of state that populates a mirror."],
      ["event.sender", "the webContents that sent the message; how main knows who asked."],
    ],
    why: "I must be registered before any window is created. If a preload asks and nobody is listening, it does not error; it hangs forever. That is why createMainStore runs at startup, before the first BrowserWindow.",
    watch: "Press 'reload renderer B'. I flash, an amber dot goes to B's preload, and its bridge says 'booted · seq N'.",
  },

  "h-snapshot": {
    title: "snapshot handler",
    file: "src/main/index.ts · ipcMain.handle",
    who: "I give the same answer as snapshot-sync, but asynchronously, for a renderer that is already running.",
    picture:
      "A dining room that has been open for hours notices its board skipped a number. Instead of guessing what it missed, it calls me and asks for the whole menu again. This call does not block anyone; the room keeps serving while it waits.",
    steps: [
      "A mirror detects a gap in seq and calls bridge.snapshot(), which is ipcRenderer.invoke.",
      "I return {state, seq}. invoke/handle is request-response, so the renderer gets a promise.",
    ],
    terms: [
      ["invoke / handle", "Electron's request-response IPC pair. Returns a promise on the renderer side."],
      ["resync", "replacing a mirror wholesale with a fresh snapshot after a detected gap."],
    ],
    why: "A mirror that missed a message must never apply the next one on top of stale data; it would describe a history that never happened. I am the recovery path.",
    watch: "I am rarely used in this demo because nothing drops messages on purpose yet. A blue dot to me means a mirror found a hole.",
  },

  "h-dispatch": {
    title: "dispatch handler",
    file: "src/main/index.ts · ipcMain.on",
    who: "I receive proposals. A renderer cannot change state; it can only ask me to.",
    picture:
      "I am the order window. A slip comes in, I hand it to the store, which hands it to the recipe card. The dining room that sent it does not wait for a reply; it goes back to serving and finds out what happened when the board updates like everyone else.",
    steps: [
      "ipcRenderer.send arrives with an action.",
      "I call store.dispatch(action). That runs the reducer and, via the store's listener, triggers a broadcast.",
    ],
    terms: [
      ["fire-and-forget", "send with no reply. The sender is never blocked."],
      ["propose vs. apply", "renderers propose actions; only main applies them."],
    ],
    why: "Fire-and-forget keeps the UI thread free. The trade is that the sender's own screen does not change until the broadcast returns, one round trip later. That visible gap is exactly what optimistic updates will fill.",
    watch: "I flash when a blue dot lands. The reducer flashes right after.",
  },

  "h-broadcast": {
    title: "update (broadcast)",
    file: "src/main/index.ts · webContents.send",
    who: "After every change, I tell every subscribed renderer the new state and its sequence number.",
    picture:
      "The kitchen finishes an order and I run to every dining room and rewrite the board. I number each rewrite: 7, 8, 9. A room that has 7 and receives 9 knows it missed 8, and asks for the full menu instead of trusting 9.",
    steps: [
      "The store's listener fires with the new state.",
      "seq += 1.",
      "For each subscriber that is not destroyed, webContents.send(update, {state, seq}).",
    ],
    terms: [
      ["broadcast", "one sender, many receivers. Here: main to every mirror."],
      ["isDestroyed()", "a webContents can be torn down mid-loop; sending to it throws."],
      ["full snapshot vs. delta", "I send the whole state each time. Sending only the changed part is a future step the seq machinery already makes safe."],
    ],
    why: "Sending to every subscriber rather than every window matters: a pane like the two below is not a BrowserWindow, and a window with no mirror has no use for the state.",
    watch: "I flash, then one amber dot per subscriber leaves me at the same moment. Compare their arrival with 'update seq N: applied' in the log.",
  },

  boundary: {
    title: "Process boundary",
    file: "IPC · structured clone",
    who: "I am the wall between main and every renderer. Nothing crosses me except copies.",
    picture:
      "The kitchen and the dining rooms are in different buildings. You cannot hand a plate through the wall; you can only photocopy the menu and slide the copy under the door. Anything that does not photocopy, like a live function or a promise, simply cannot cross. And once the copy is on the other side, changing it does nothing to the original.",
    steps: [
      "A message is serialised with the structured clone algorithm, sent, and deserialised on the other side.",
      "Plain objects, arrays, strings, numbers, Date, Map, Set survive.",
      "Functions, symbols, promises throw. Class instances lose their prototype and methods silently.",
    ],
    terms: [
      ["structured clone", "the browser's deep-copy algorithm used for IPC and postMessage."],
      ["serialisable", "able to survive structured clone. State must be."],
      ["no shared memory", "each process has its own heap; the only sharing is by message."],
    ],
    why: "This wall is why a mirror exists at all. Since a renderer cannot read main's memory, it must hold its own copy. The compile-time serialisability check (a planned feature) exists to catch state that would silently lose its methods crossing me.",
    watch: "Every dot you see is one copy going under the door. Nothing else ever crosses.",
  },

  renderer: {
    title: "Renderer process",
    file: "one Chromium page, its preload, and its mirror",
    who: "I am one dining room: a page, a mirror of the state, and a bridge to the kitchen.",
    picture:
      "I am a separate building with my own memory. I cannot see the kitchen's whiteboard, so I keep a full copy of it on my wall (the mirror). My page reads that copy instantly, no phone call needed. When I want to change something I send a slip to the kitchen and wait for the board rewrite like everyone else. The other room next to me is an identical building; we do not talk to each other, only to the kitchen.",
    steps: [
      "The preload runs first, blocks once for the initial state, and exposes a narrow bridge.",
      "The page creates the mirror from that initial state, synchronously.",
      "The page renders from getState() and subscribes to changes.",
      "User input becomes dispatch(action), which goes to main and comes back as a broadcast.",
    ],
    terms: [
      ["renderer process", "a Chromium page process. Sandboxed by default since Electron 20."],
      ["context isolation", "the page's JavaScript and the preload's run in separate worlds; the bridge is the only link."],
      ["WebContentsView", "how this pane is embedded in the inspector: a real, separate renderer inside another window's frame."],
    ],
    why: "Both panes are genuine, separate processes. The library does not know they share a window. That is the point of the demo: what you see here is exactly what two top-level windows would do.",
    watch: "Click + in one pane and watch the other pane change after the round trip.",
  },

  preload: {
    title: "Preload and bridge",
    file: "src/preload/index.ts",
    who: "I run in the renderer before the page's own code, and I am the only code that can see both worlds.",
    picture:
      "I am the host at the door. Before the room opens I phone the kitchen and wait on the line for the full menu (the one blocking call). Then I hand the room exactly four things it may use: the menu I fetched, a way to ask for it again, a way to send a slip, and a way to be told about board rewrites. The room never gets my phone. If someone in the room turns out to be a bad actor, all they can do is those four things.",
    steps: [
      "ipcRenderer.sendSync(snapshot-sync): block until main replies with {state, seq}.",
      "Build the bridge object: initialState, snapshot(), dispatch(), onUpdate().",
      "contextBridge.exposeInMainWorld puts it on window under one key. Functions are proxied; other values are copied and frozen.",
    ],
    terms: [
      ["preload script", "a file Electron runs in the renderer, before the page, with IPC access."],
      ["contextBridge", "the API that safely exposes a chosen object from the preload world to the page world."],
      ["sendSync", "blocks the renderer until main answers. Normally discouraged; deliberate here."],
    ],
    why: "The docs call sendSync a last resort because it freezes the UI. I make it before there is any UI to freeze: once per pane, before first paint, one hop. In exchange the page's very first line can read state with no await and no loading spinner. That is what makes 'synchronous' literally true.",
    watch: "My chip says 'not booted' until main answers, then 'booted · seq N'. Reload a pane to see it happen again.",
  },

  mirror: {
    title: "Mirror",
    file: "src/renderer/index.ts",
    who: "I am this renderer's full local copy of the state, and the rules for keeping it honest.",
    picture:
      "I am the menu board on this room's wall. Reading me is instant because I am right here. The kitchen rewrites me by message, and each rewrite carries a number. I only accept a rewrite if its number is exactly one more than mine. Lower or equal, I have already seen it. Two or more higher, I missed one, and I refuse to guess: I put the rewrite down and ask the kitchen for the whole menu.",
    steps: [
      "Start from bridge.initialState. No await; the preload already fetched it.",
      "getState() returns my copy. Never touches IPC.",
      "On each update: seq ≤ mine → stale, ignore. seq = mine + 1 → apply and notify. Otherwise → gap, resync.",
      "resync() is guarded: never two at once, and a returned snapshot is applied only if newer than what arrived while waiting.",
    ],
    terms: [
      ["eventually consistent", "I am briefly behind main after every change (about one IPC hop), then catch up."],
      ["gap detection", "noticing a missing sequence number rather than silently applying the wrong next state."],
      ["stale", "an update at or below my current seq; already reflected."],
      ["self-healing", "recovering from a gap automatically, without the app noticing."],
    ],
    why: "The slow-snapshot guard matters: without it, a resync that takes a while could return and overwrite fresher state that arrived in the meantime with older state. That is the bug this kind of machinery usually introduces, and it is handled.",
    watch: "My lastSeq and last verdict. Green 'applied' is the normal case. Red would mean a gap, followed by a blue dot to the snapshot handler.",
  },

  page: {
    title: "Page",
    file: "example/index.html · example/renderer.ts",
    who: "I am the app. I know nothing about IPC; I read state and dispatch actions like it was all local.",
    picture:
      "I am the waiter. I look at the board on the wall and tell customers what is available. When a customer wants something, I write a slip and drop it in the chute. I never phone the kitchen and I never wait; the board on the wall will update when it updates.",
    steps: [
      "createRendererStore(): synchronous. State is available on the next line.",
      "render(store.getState()) on line one. No loading state anywhere.",
      "store.subscribe(render) so every applied update repaints.",
      "Buttons and the input call store.dispatch(...).",
    ],
    terms: [
      ["consumer", "code that uses the library's store without knowing how it is implemented."],
      ["synchronous read", "getState() returns immediately from local memory."],
    ],
    why: "The whole design is measured by how simple I get to be. If I needed an await, a spinner, or knowledge of channels, the library would have leaked its implementation into the app.",
    watch: "This pane is a real renderer process drawn inside the diagram. Clicking + here is a real click in a real page.",
  },

  log: {
    title: "Event log",
    file: "the trace hook, printed",
    who: "I list every decision the library made, in order, with the real time it happened.",
    picture:
      "The diagram is a slow-motion replay. I am the stopwatch. Both come from the same source: a small callback the library calls at every decision point, with a plain description of what it decided. The animation reads it to draw; I read it to print.",
    steps: [
      "Main calls trace({kind, ...}) at each handler and after each reducer run and broadcast.",
      "Each renderer calls trace(...) when it bootstraps, sends, receives, or resyncs. Those travel to main over a demo-only channel.",
      "Main forwards everything to this window with a timestamp.",
    ],
    terms: [
      ["instrumentation / trace hook", "an optional callback that reports internal events without changing behaviour."],
      ["discriminated union", "each event has a `kind`, so code can switch on it exhaustively."],
    ],
    why: "The same hook the diagram uses will let the tests prove behaviour instead of assuming it: 'after a gap, a resync-started event must follow' is checkable.",
    watch: "Look at the timestamps. A full round trip, dispatch to both mirrors applied, is usually one or two milliseconds. The dots are lying about speed on purpose.",
  },
};
