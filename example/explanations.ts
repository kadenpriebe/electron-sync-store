/**
 * What each box in the inspector says about itself when clicked.
 *
 * A short numbered list of what each one actually does, in the first person
 * and in plain English, for someone who has never seen this project. Only the
 * two panels a button opens lead with a sentence or two of prose.
 */

export type Topic = {
  /** Short name shown as the panel heading. */
  title: string;
  /** The file (or idea) this box stands for. */
  file: string;
  /** A sentence or two, on the two panels a button opens. Boxes have none. */
  essence?: string;
  /** What I actually do, in order. */
  steps: string[];
  /** Shown under "what the compiler refuses", as written. */
  code?: string[];
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

  batching: {
    title: "Why fifty asks make three messages",
    file: "src/core/store.ts · one message per moment",
    essence:
      "The owner does not send a message for every single change. Everything it changes in one moment goes out together, in one message. Each message says which changes it covers, so a window can still tell \"that was five changes at once\" apart from \"I missed five\".",
    steps: [
      "Fifty asks arrive in one moment. I answer all of them.",
      "I number the changes as I make them: 1, 2, 3, all the way to 50.",
      "I send one message: here is the new state, and it covers changes 1 to 50.",
      "A window that was up to date takes it, because the message starts exactly where the window left off.",
      "A window holding 7 that gets a message starting at 12 knows something never arrived, and asks for a fresh copy.",
      "The same idea inside each window: a part of the page that only watches the count is left alone when the name changes.",
    ],
  },

  main: {
    title: "The owner",
    file: "src/main/index.ts · the main process",
    steps: [
      "A window asks me to change something.",
      "I run the ask through the rules and get a new state.",
      "I add one to my change counter.",
      "I send the new state to every window, and say which changes that covers.",
      "If several asks land in the same moment I answer them all, then send one message for the lot.",
      "Because there is only one of me, every window gets the same history in the same order.",
    ],
  },

  store: {
    title: "Where the state sits",
    file: "src/core/store.ts",
    steps: [
      "Someone reads the current value. No waiting — it is right here.",
      "Someone hands me a change. I pass it to the rules and keep what comes back.",
      "I tell everyone watching that the value changed — but once per moment, not once per change.",
      "A watcher can ask about one part only, and I leave it alone while anything else changes.",
      "I know nothing about windows or messages, which is why the very same code runs on both sides.",
    ],
  },

  reducer: {
    title: "The rules",
    file: "example/state.ts",
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
    steps: [
      "A window has change 7, and the message that just arrived says it starts at 9. Something never reached it.",
      "It asks me for the whole state again.",
      "I hand it back, without freezing anything.",
      "The window throws away what it had and starts from mine.",
    ],
  },

  "h-dispatch": {
    title: "Asks from windows",
    file: "src/main/index.ts · the dispatch handler",
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
    steps: [
      "The state changed — maybe once, maybe fifty times in the same moment.",
      "I number every change: 7, then 8, then 9.",
      "I send one message to every window: the new state, and which changes it covers.",
      "A window takes the message if it starts exactly where that window left off.",
      "If it starts anywhere else, the window knows something never reached it, and asks for a fresh copy instead of trusting it.",
    ],
  },

  boundary: {
    title: "The wall between them",
    file: "src/shared/serializable.ts",
    steps: [
      "A message is copied on the way out and rebuilt on the way in.",
      "Plain data makes the trip: numbers, text, lists, objects.",
      "A function or a promise does not: sending one throws.",
      "Worse, some things arrive broken with no complaint. Anything built from a class arrives as plain data, and every action it could do is gone.",
      "So the state is checked when you write it, not when it breaks: put something in the state that cannot make the trip and the build stops.",
      "This wall is the whole reason a window needs its own copy of the state.",
    ],
    code: [
      "type State = {",
      "  count: number",
      "  bump(): void      ← the build stops here",
      "}",
      "",
      "Type '() => void' is not assignable to type 'never'.",
    ],
  },

  renderer: {
    title: "One window",
    file: "a page, its copy of the state, and its door",
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
    steps: [
      "I ask the owner for the state and wait for it. Nobody is looking at the window yet, so nobody is kept waiting.",
      "I hand the page four things: the state, a way to ask for a fresh copy, a way to send an ask, and a way to be told about changes.",
      "The page gets nothing else, so a bad script inside it cannot reach the rest of the computer.",
    ],
  },

  mirror: {
    title: "This window's copy",
    file: "src/renderer/index.ts",
    steps: [
      "You click. I show the result immediately and put the ask on a short waiting list.",
      "I send the ask to the owner.",
      "The owner says yes: the ask leaves the list, and what you already saw was right.",
      "The owner says no: the ask leaves the list, and the screen goes back to the official state.",
      "A change caused by the other window arrives: I take it, then put my own waiting guesses back on top.",
      "One message can answer several of my asks at once, and I retire all of them together.",
      "I only wake the parts of the page whose own piece of the state actually moved.",
    ],
  },

  page: {
    title: "The app, in plain TypeScript",
    file: "example/index.html · example/renderer.ts",
    steps: [
      "Read the state on my first line. It is already there.",
      "Draw it.",
      "Watch the count and the name separately, and redraw only the one that moved.",
      "A button asks for a change, and the screen updates on that same line.",
      "No framework anywhere in here. The window on the right does the same thing in React.",
    ],
  },

  "page-react": {
    title: "The same app, in React",
    file: "example/renderer-react.tsx · src/react/index.ts",
    steps: [
      "I am the same page as the window on the left, written a different way.",
      "The part that shows the count asks for the count only. The part that shows the name asks for the name only.",
      "React redraws a part when the piece it asked for moves, and leaves it alone otherwise.",
      "Type in the name box here and watch: the count is not redrawn once.",
      "Nothing in the library knows React exists. This is two small pieces of glue over the same copy of the state.",
    ],
  },

  log: {
    title: "What happened, in order",
    file: "every decision, as it was made",
    steps: [
      "The owner reports every ask it got, every rule it ran, and everything it sent.",
      "Each window reports what it guessed, sent and received.",
      "All of it lands here with a timestamp.",
      "The times are real. At real speed a whole round trip is one or two milliseconds, far too fast to watch, so the dots are slowed down. Choose a delay and they move at the true speed instead.",
    ],
  },
};
