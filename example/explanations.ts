/**
 * What each box in the inspector says about itself when clicked.
 *
 * Two things only: a sentence or two on what this is, and a short numbered
 * list of what it actually does. Written in the first person, in plain
 * English, for someone who has never seen this project.
 */

export type Topic = {
  /** Short name shown as the panel heading. */
  title: string;
  /** The file (or idea) this box stands for. */
  file: string;
  /** A sentence or two: what I am and why I exist. */
  essence: string;
  /** What I actually do, in order. */
  steps: string[];
};

export const topics: Record<string, Topic> = {
  overview: {
    title: "The whole picture",
    file: "how to read this screen",
    essence:
      "One place owns the state, and every window keeps its own copy of it. A window never changes its copy directly: it asks the owner, and the owner tells every window the result.",
    steps: [
      "The box on top owns the state. Nothing else may change it.",
      "The two boxes below are real windows. Each keeps a full copy.",
      "Click + in a window and the number moves at once. That is a guess.",
      "The ask travels up, the owner decides, and the answer comes back down to every window.",
      "The dots are those messages, slowed down so you can watch them.",
    ],
  },

  guessing: {
    title: "Why windows guess",
    file: "the point of the whole thing",
    essence:
      "The owner handles one ask at a time, so the busier it gets, the longer its answer takes. A window that waits for that answer feels slow. These windows do not wait: they show the result immediately and check afterwards.",
    steps: [
      "Click +. The number moves in 0 ms, before any message has left the window.",
      "The ask goes to the owner and the answer comes back. That is the second number next to the window.",
      'Press "50 clicks at once" to hand the owner a pile of asks, and watch its answer time climb.',
      "The number on the page never slows down, however long the answer takes.",
      "If the owner says no, that one guess is undone and the number snaps back.",
    ],
  },

  main: {
    title: "The owner",
    file: "src/main/index.ts · the main process",
    essence:
      "I own the state and I am the only one allowed to change it. Every window has to ask me, and I answer one ask at a time.",
    steps: [
      "A window asks me to change something.",
      "I run the ask through the rules and get a new state.",
      "I add one to my change counter.",
      "I send the new state, and that number, to every window.",
      "Because there is only one of me, every window gets the same history in the same order.",
    ],
  },

  store: {
    title: "Where the state sits",
    file: "src/core/store.ts",
    essence:
      "I am the box the state sits in. I hold one value, swap it for a new one when told, and tell everyone who is listening.",
    steps: [
      "Someone reads the current value. No waiting — it is right here.",
      "Someone hands me a change. I pass it to the rules and keep what comes back.",
      "I tell every listener that the value changed.",
      "I know nothing about windows or messages, which is why the very same code runs on both sides.",
    ],
  },

  reducer: {
    title: "The rules",
    file: "example/state.ts",
    essence:
      "I am the app's rulebook. Hand me the current state and something someone wants to do, and I hand back the new state.",
    steps: [
      '"Add 1" means the count goes up by one.',
      '"Change the name" means the name is replaced.',
      "I never edit the old state. I always hand back a new one.",
      "I give the same answer to the same question every time, which is what lets a window run me to guess what the owner will say.",
    ],
  },

  "h-snapshot-sync": {
    title: "First copy for a new window",
    file: "src/main/index.ts · the snapshot-sync handler",
    essence:
      "A window that just opened has nothing. It asks me once for the whole state and waits right there until I answer, so its very first line of code already has the data.",
    steps: [
      "A new window asks, and freezes while it waits.",
      "I add it to the list of windows I keep up to date.",
      "I hand back the whole state and its change number.",
      "The window unfreezes and draws immediately: no spinner, no loading state.",
    ],
  },

  "h-snapshot": {
    title: "Fresh copy on request",
    file: "src/main/index.ts · the snapshot handler",
    essence:
      "The same answer as the first copy, but for a window that is already running and has noticed it missed something.",
    steps: [
      "A window sees a gap in the change numbers: it has 7 and just got 9.",
      "It asks me for the whole state again.",
      "I hand it back, without freezing anything.",
      "The window throws away what it had and starts from mine.",
    ],
  },

  "h-dispatch": {
    title: "Asks from windows",
    file: "src/main/index.ts · the dispatch handler",
    essence:
      "Windows cannot change the state. They ask me, and I always answer yes or no — to the window that asked, and to nobody else.",
    steps: [
      "An ask arrives, tagged with which window sent it and which of its asks it is.",
      "I run it through the rules.",
      "It worked: I answer yes, and say which change number it landed at.",
      "The rules refused it: nothing changes anywhere, and I answer no with the reason.",
      "Either way the answer goes back to that one window alone.",
    ],
  },

  "h-broadcast": {
    title: "Every change, to every window",
    file: "src/main/index.ts · the update message",
    essence:
      "After any change I send the new state out to every window, with a number on it. The number is how a window can tell whether it missed one.",
    steps: [
      "The state changed.",
      "I add one to the number: 7, then 8, then 9.",
      "I send the new state and that number to every window at the same moment.",
      "A window holding 7 that receives 9 knows it missed 8, and asks for a fresh copy instead of trusting it.",
    ],
  },

  boundary: {
    title: "The wall between them",
    file: "how messages cross",
    essence:
      "The owner and the windows are separate programs with separate memory. Nothing is ever shared between them; everything is copied.",
    steps: [
      "A message is copied on the way out and rebuilt on the way in.",
      "Plain data makes the trip: numbers, text, lists, objects.",
      "Live things do not: a function or a promise cannot cross.",
      "This wall is the whole reason a window needs its own copy of the state.",
    ],
  },

  renderer: {
    title: "One window",
    file: "a page, its copy of the state, and its door",
    essence:
      "I am one window: the page you can see, a full copy of the state, and a door to the owner. The window beside me is a completely separate program; we never talk to each other, only to the owner.",
    steps: [
      "Before my page loads, I fetch the state once.",
      "My page reads that copy instantly, with no waiting anywhere.",
      "When you click, I show the change straight away and ask the owner.",
      "When the owner's answer reaches everyone, I take the official version.",
    ],
  },

  preload: {
    title: "The door",
    file: "src/preload/index.ts",
    essence:
      "I run before the page does, and I am the only part of a window that can talk to the owner. I hand the page exactly four things it may use, and nothing else.",
    steps: [
      "I ask the owner for the state and wait for it. Nobody is looking at the window yet, so nobody is kept waiting.",
      "I hand the page four things: the state, a way to ask for a fresh copy, a way to send an ask, and a way to be told about changes.",
      "The page gets nothing else, so a bad script inside it cannot reach the rest of the computer.",
    ],
  },

  mirror: {
    title: "This window's copy",
    file: "src/renderer/index.ts",
    essence:
      "I am this window's copy of the state, with this window's unanswered guesses drawn on top. What the page shows is the two of them combined.",
    steps: [
      "You click. I show the result immediately and put the ask on a short waiting list.",
      "I send the ask to the owner.",
      "The owner says yes: the ask leaves the list, and what you already saw was right.",
      "The owner says no: the ask leaves the list, and the screen goes back to the official state.",
      "A change caused by the other window arrives: I take it, then put my own waiting guesses back on top.",
    ],
  },

  page: {
    title: "The app",
    file: "example/index.html · example/renderer.ts",
    essence:
      "I am the actual app you can see and click. I read the state and I ask for changes as if everything were local. I know nothing about windows, copies or messages.",
    steps: [
      "Read the state on my first line. It is already there.",
      "Draw it.",
      "Redraw it whenever it changes.",
      "A button asks for a change, and the screen updates on that same line.",
    ],
  },

  log: {
    title: "What happened, in order",
    file: "every decision, as it was made",
    essence:
      "Every decision the library made, in the order it made them, with the real time each one happened.",
    steps: [
      "The owner reports every ask it got, every rule it ran, and everything it sent.",
      "Each window reports what it guessed, sent and received.",
      "All of it lands here with a timestamp.",
      "The times are real. A whole round trip is usually one or two milliseconds; the dots are slowed down on purpose.",
    ],
  },
};
