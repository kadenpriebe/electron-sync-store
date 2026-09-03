/**
 * What each box in the inspector says about itself when clicked.
 *
 * Written in the first person, as the file talking, in short plain sentences.
 * Every everyday picture is paired with the real term, so the picture builds
 * intuition and the term is what you say out loud.
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
    who: "One place owns the state. Every window keeps a copy. Messages keep the copies right.",
    picture:
      "One kitchen, two dining rooms. Only the kitchen cooks. Each room has a board showing what is on. Order slips go up, new boards come down.",
    steps: [
      "Top box: the main process. It owns the state.",
      "Dashed line: the process boundary. Only copies cross it.",
      "Bottom boxes: two real windows. Each holds a copy and shows a live page.",
      "Dots are messages. Blue goes up, amber comes down, slowed so you can see them.",
    ],
    terms: [
      ["main process", "Electron's Node side. One per app. Owns the state."],
      ["renderer process", "one window's page. One per window."],
      ["IPC", "messages between them. The only way they talk."],
      ["mirror", "a window's own copy of the state."],
    ],
    why: "Two processes cannot share memory. So one owns the truth and the rest hold copies.",
    watch: "Click + and follow the dots: one up, two down. That is the whole library.",
  },

  main: {
    title: "Main process",
    file: "src/main/index.ts",
    who: "I own the state, and I am the only one who changes it.",
    picture:
      "I am the kitchen. Slips come to me, I cook them in the order they arrive, then I rewrite every room's board.",
    steps: [
      "Make the store with the app's reducer.",
      "Register my four handlers before any window exists.",
      "A proposal arrives: run it through the reducer.",
      "Bump seq and send the new state to every window that booted.",
    ],
    terms: [
      ["single writer", "one place may change state. Everyone else asks."],
      ["total order", "whatever reaches me first, happened first. No clocks needed."],
      ["seq", "how many changes I have made. Stamped on everything I send."],
      ["subscriber", "a window that booted, so I keep it up to date."],
    ],
    why: "Two writers could disagree, and then you need clocks and merge rules. One writer deletes that whole problem. The cost is that every change takes a round trip.",
    watch: "seq goes up by exactly one per reducer run.",
  },

  store: {
    title: "Store",
    file: "src/core/store.ts",
    who: "I hold one value, swap it when told, and tell everyone listening.",
    picture:
      "A whiteboard with a rule: you cannot write on me. Hand me a note, I get a new board back from the recipe card and swap it in. Then I tap everyone on the list.",
    steps: [
      "getState() hands back the value. No waiting, no messages.",
      "dispatch(action) runs the reducer, keeps what it returns, then tells the listeners.",
      "subscribe(fn) adds a listener and hands back the function that removes it.",
    ],
    terms: [
      ["reducer", "(state, action) → new state. Nothing else."],
      ["listener", "a function called after every change."],
      ["pure", "same input, same output, touches nothing outside. Safe to re-run."],
    ],
    why: "I know nothing about Electron, so I run in a plain test with no windows. The same me runs inside every window's copy.",
    watch: "seq is main's count of changes. It only goes up.",
  },

  reducer: {
    title: "Reducer",
    file: "example/state.ts",
    who: "I am the app's rulebook: state in, action in, next state out.",
    picture:
      "The recipe card. Nobody improvises. \"increment\" means the count goes up by one. I never edit the old state; I hand back a new one.",
    steps: [
      "Take (state, action).",
      "Switch on action.type and return a new state.",
      "Default branch: assign to `never`, so a new action type will not compile until it is handled.",
    ],
    terms: [
      ["immutable update", "return a new object instead of editing the old one."],
      ["exhaustiveness check", "`never` makes the compiler prove every case is handled."],
      ["pure", "no surprises, so a window can run me to guess the answer."],
    ],
    why: "The library does not know your state. I am where the app's meaning lives. Being pure is what lets a window guess before main answers.",
    watch: "I flash when I run and show the action and what I returned.",
  },

  "h-snapshot-sync": {
    title: "snapshot-sync handler",
    file: "src/main/index.ts · ipcMain.on",
    who: "I answer the one question a window freezes on: what is the state right now?",
    picture:
      "A room is about to open. The host phones me and holds the line until I read out the menu. Nobody is inside yet, so nobody is kept waiting.",
    steps: [
      "A preload calls sendSync and freezes.",
      "I add it to my subscriber list.",
      "I set event.returnValue to {state, seq}. That is what unfreezes it.",
    ],
    terms: [
      ["sendSync", "a call that freezes the window until main answers."],
      ["bootstrap", "the first copy, the one that fills a mirror."],
    ],
    why: "I have to be listening before any window opens. A sendSync nobody answers does not error — it hangs forever.",
    watch: "Reload B: I flash, a dot goes down, and its bridge says booted.",
  },

  "h-snapshot": {
    title: "snapshot handler",
    file: "src/main/index.ts · ipcMain.handle",
    who: "Same answer as sendSync, without freezing anyone.",
    picture:
      "A room that has been open for hours notices its board skipped a number, and asks me for the whole menu again.",
    steps: [
      "A mirror sees a gap in seq and calls snapshot().",
      "I hand back {state, seq} as a promise, so nothing freezes.",
    ],
    terms: [
      ["invoke / handle", "ask-and-answer IPC. The window gets a promise."],
      ["resync", "throwing a copy away and taking a fresh one."],
    ],
    why: "A window that missed a message must not build on stale state. I am the recovery path.",
    watch: "Rare here: nothing drops messages on purpose yet. A blue dot to me means a window found a hole.",
  },

  "h-dispatch": {
    title: "dispatch handler",
    file: "src/main/index.ts · ipcMain.handle",
    who: "Windows cannot change state. They ask me, and I always answer yes or no.",
    picture:
      "The order window. A slip arrives with the room's name and a ticket number. If the recipe card takes it, the boards get rewritten and the slip goes back stamped \"yes, rewrite 8\". If the card refuses, nothing changes and the slip goes back stamped \"no\", with the reason, to that room alone.",
    steps: [
      "{origin, action} arrives. origin says which window, and which of its asks this is.",
      "I run store.dispatch inside a try.",
      "It worked: reply {status: confirmed, seq}. It threw: reply {status: rejected, reason}. I never throw.",
    ],
    terms: [
      ["origin", "{client, n}: whose ask this is. Echoed on the broadcast."],
      ["rejection", "the reducer threw. Nothing changed, and only the asker hears about it."],
      ["propose vs. apply", "windows propose actions; only main applies them."],
    ],
    why: "The window already showed its guess. My answer is what tells it whether the guess held — and a broadcast goes to everyone, so it cannot say no to one window.",
    watch: "Green: it ran, and a broadcast follows. Red: refused, and a red dot carries the reason back to the asker only.",
  },

  "h-broadcast": {
    title: "update (broadcast)",
    file: "src/main/index.ts · webContents.send",
    who: "After every change I tell every subscribed window the new state and its number.",
    picture:
      "I run to every room and rewrite the board. I number each rewrite: 7, 8, 9. A room holding 7 that gets 9 knows it missed one.",
    steps: [
      "The store's listener fires with the new state.",
      "seq goes up by one.",
      "Send {state, seq} to every subscriber that still exists.",
    ],
    terms: [
      ["broadcast", "one sender, many receivers, no reply."],
      ["full snapshot", "I send the whole state every time, not just the part that changed."],
    ],
    why: "I send to subscribers, not to windows: a window with no mirror has no use for this.",
    watch: "One amber dot per window, all leaving at the same moment.",
  },

  boundary: {
    title: "Process boundary",
    file: "IPC · structured clone",
    who: "I am the wall between main and every window. Only copies cross me.",
    picture:
      "Different buildings. You cannot hand a plate through the wall; you photocopy the menu and slide the copy under the door. Changing the copy does nothing to the original.",
    steps: [
      "A message is copied on the way out and rebuilt on the way in.",
      "Objects, arrays, strings, numbers, Date, Map and Set survive.",
      "Functions and promises throw. Class instances quietly lose their methods.",
    ],
    terms: [
      ["structured clone", "the deep copy that IPC uses."],
      ["serialisable", "able to survive that copy. State has to be."],
      ["no shared memory", "each process has its own; messages are the only sharing."],
    ],
    why: "This wall is why mirrors exist at all. A window cannot read main's memory, so it keeps its own copy.",
    watch: "Every dot is one copy going under the door. Nothing else crosses.",
  },

  renderer: {
    title: "Renderer process",
    file: "one Chromium page, its preload, and its mirror",
    who: "I am one window: a page, a copy of the state, and a bridge to main.",
    picture:
      "My own building, with my own memory. I cannot see the kitchen's whiteboard, so I keep a full copy on my wall. My page reads that copy instantly.",
    steps: [
      "The preload runs first, blocks once for the state, and hands the page a small bridge.",
      "The page builds the mirror from it, with no waiting.",
      "The page draws from getState() and subscribes to changes.",
      "A click becomes dispatch(action): up to main, back as a broadcast.",
    ],
    terms: [
      ["context isolation", "the page's code and the preload's run apart. The bridge is the only link."],
      ["WebContentsView", "how this pane is a real, separate window drawn inside the diagram."],
    ],
    why: "Both panes are genuinely separate processes. The library does not know they share a frame, so what you see here is what two real windows would do.",
    watch: "Click + in one pane and watch the other.",
  },

  preload: {
    title: "Preload and bridge",
    file: "src/preload/index.ts",
    who: "I run before the page, and I am the only code that can see both sides.",
    picture:
      "The host at the door. Before the room opens I phone the kitchen and wait for the full menu. Then I hand the room exactly four things it may use.",
    steps: [
      "sendSync for {state, seq}: block until main answers.",
      "Build the bridge: initialState, snapshot(), dispatch(), onUpdate().",
      "contextBridge puts it on window under one key.",
    ],
    terms: [
      ["preload script", "a file Electron runs in the window, before the page, with IPC access."],
      ["contextBridge", "the safe way to hand one chosen object to the page."],
    ],
    why: "sendSync freezes the UI, so I do it before there is a UI: once per window, before the first paint. In exchange the page's first line can read state with no await and no spinner.",
    watch: "My chip says \"not booted\" until main answers. Reload a pane to watch it happen again.",
  },

  mirror: {
    title: "Mirror",
    file: "src/renderer/index.ts",
    who: "I am this window's copy of the state, with this window's unanswered guesses drawn on top.",
    picture:
      "The board on the wall, plus sticky notes down the side. Only the kitchen rewrites the board. The notes are this room's own orders, not answered yet. What the waiter reads is the board with the notes on top.",
    steps: [
      "Start from the state the preload already fetched. No waiting.",
      "dispatch: add a guess, redraw at once, then ask main.",
      "getState() is the confirmed state with the guesses replayed on top.",
      "An update arrives: older than mine → ignore. Exactly next → take it, and drop the guess it answers. A jump → I missed one, resync.",
      "Main says no → drop that guess and redraw. That is the rollback.",
    ],
    terms: [
      ["optimistic update", "show the change before main confirms it."],
      ["pending queue", "my guesses main has not answered yet."],
      ["rebase", "replaying my guesses on top of a newer confirmed state."],
      ["rollback", "drop a refused guess; the redraw without it is the undo."],
      ["gap detection", "noticing a missing number instead of applying the wrong next state."],
    ],
    why: "Saving the old state and restoring it on failure would also undo another window's change that arrived meanwhile, and any newer guess of my own. Replaying a queue has neither problem.",
    watch: "Set latency to 1.5 s and click +: pending goes to 1 before any dot has moved. Then arm \"reject next\" and the number snaps back.",
  },

  page: {
    title: "Page",
    file: "example/index.html · example/renderer.ts",
    who: "I am the app. I read state and dispatch actions as if it were all local.",
    picture:
      "The waiter. I read the board on the wall and write slips. I never phone the kitchen and I never wait.",
    steps: [
      "createRendererStore(reducer): no await, state is there on the next line.",
      "render(getState()) on line one. No spinner anywhere.",
      "subscribe(render), so guesses and rollbacks repaint too.",
      "Buttons call dispatch. The number changes on that line.",
    ],
    terms: [
      ["synchronous read", "getState() answers immediately, from local memory."],
      ["never-rejecting promise", "dispatch resolves to confirmed or rejected, so ignoring it is safe."],
    ],
    why: "The design is measured by how simple I get to be. An await here would mean the library leaked into the app.",
    watch: "This pane is a real window. Clicking + here is a real click in a real page.",
  },

  log: {
    title: "Event log",
    file: "the trace hook, printed",
    who: "I list every decision the library made, in order, with the real time.",
    picture:
      "The diagram is the slow-motion replay; I am the stopwatch. Both read the same feed.",
    steps: [
      "Main reports each handler, each reducer run and each broadcast.",
      "Each window reports what it sent, got, or resynced.",
      "Main stamps them with a time and forwards them here.",
    ],
    terms: [
      ["trace hook", "an optional callback that reports what happened and changes nothing."],
    ],
    why: "The same feed the diagram draws from is what the tests can assert on.",
    watch: "A full round trip is usually one or two milliseconds. The dots are lying about speed on purpose.",
  },
};
