/**
 * What each box in the inspector says about itself when clicked.
 *
 * Every panel leads with one plain sentence that carries the whole box, so it
 * can be understood without reading further. The numbered list under it is the
 * detail, in the first person, for someone who has never seen this project.
 */

export type Topic = {
  /** Short name shown as the panel heading. */
  title: string;
  /** The file (or idea) this box stands for. */
  file: string;
  /** The whole box in one sentence. Every topic has one. */
  plain: string;
  /** A sentence or two more, on the panels a button opens. Boxes have none. */
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
    plain:
      "One place owns the state, every window keeps its own copy, and a window has to ask that one place before anything really changes.",
    essence:
      "A window never changes its copy directly: it asks the owner, and the owner tells every window the result.",
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
    plain:
      "A window shows the answer immediately and checks with the owner afterwards, so nothing on screen ever waits for a message.",
    essence:
      "The owner handles one ask at a time, so the busier it gets, the longer its answer takes. A window that waits for that answer feels slow. These windows do not wait.",
    steps: [
      "Click +. The number moves in 0 ms, before any message has left the window.",
      "The window can do that because it has the same rules the owner has, so it already knows the likely answer.",
      "The ask still goes to the owner and the answer still comes back. That is the second number next to the window.",
      'Press "50 clicks at once" to hand the owner a pile of asks, and watch its answer time climb: it answers one at a time, so the last one waits for all the others.',
      "The number on the page never slows down, however long the answer takes.",
      "If the owner says no, that one guess is undone and the number snaps back.",
    ],
  },

  batching: {
    title: "Why fifty asks make three messages",
    file: "src/core/store.ts · one message per moment",
    plain:
      "Everything the owner changes in one moment goes out in a single message, and that message says which changes it covers.",
    essence:
      "Saying which changes a message covers is what keeps \"that was fifty changes at once\" tellable apart from \"I missed fifty\".",
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
    plain:
      "I am the only one allowed to change the state, and I tell every window what I changed.",
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
    plain:
      "I hold a value, I change it only by running the rules, and I tell whoever is watching — once per moment, not once per change.",
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
    plain:
      "Hand me the state and an action, and I hand back the new state — the same answer every time.",
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
    plain:
      "I give a brand-new window its first copy of the state before that window has drawn anything, so its first line of code already has the state.",
    steps: [
      "A brand-new window asks me for the state, and stops until I answer.",
      "That pause is the point, not a cost: it happens before the page exists, so there is nothing on screen and nobody waiting.",
      "I add the window to the list of windows I keep up to date.",
      "I hand back the whole state and its change number.",
      "The window's very first line of code already has the state: no spinner, no loading screen, no waiting written into the app.",
      "This is the only pause in the whole library. Every message after it is sent without anyone waiting on a reply.",
    ],
  },

  "h-snapshot": {
    title: "Fresh copy on request",
    file: "src/main/index.ts · the snapshot handler",
    plain:
      "If a window works out that it missed something, I hand it the whole state again so it can start over from mine.",
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
    plain:
      "I take one window's ask, run it through the rules, and tell that window alone whether it worked.",
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
    plain:
      "Whenever the state changes I send the new state to every window at once, and say which changes that message accounts for.",
    steps: [
      "The state changed — maybe once, maybe fifty times in the same moment.",
      "I number every change: 7, then 8, then 9.",
      "I send one message to every window: the new state, and which changes it covers.",
      "Every window gets the same message. The one that asked is not told twice and is not told first.",
      "A window takes the message if it starts exactly where that window left off.",
      "If it starts anywhere else, the window knows something never reached it, and asks for a fresh copy instead of trusting it.",
    ],
  },

  boundary: {
    title: "The wall between them",
    file: "src/shared/serializable.ts",
    plain:
      "The owner and each window are separate programs with separate memory, so nothing is ever shared between them — only copied — and some things cannot be copied at all.",
    steps: [
      "Neither side can reach into the other's memory. The only thing that can cross is plain data.",
      "So a message is flattened into data, sent, and built back up on the far side. That is one crossing, not two steps that undo each other: it is the only way anything gets across.",
      "What arrives is a different object that happens to hold the same values.",
      "Plain data makes the trip: numbers, text, lists, objects, dates.",
      "A function does not, because a function is not data — it is code that only means anything inside the program it came from. Sending one throws.",
      "Worse, some things arrive broken with no complaint. Anything built from a class arrives as plain data, and every method it had is silently gone.",
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
    plain:
      "I am one window: a page you can see, my own copy of the state, and a small door I use to talk to the owner.",
    steps: [
      "Before my page loads, I fetch the state once.",
      "My page reads that copy instantly, with no waiting anywhere.",
      "When you click, I show the change straight away and ask the owner.",
      "When the owner's answer reaches everyone, I take the official version.",
    ],
  },

  preload: {
    title: "The door",
    file: "src/preload/index.ts · runs before the page exists",
    plain:
      "I run before the page does, fetch its first copy of the state, and hand the page four things and nothing else.",
    steps: [
      "I run inside the window, but before its page exists: no HTML yet, nothing drawn, no one looking.",
      "I ask the owner for the state and wait for the answer. Since nothing is on screen yet, nobody is kept waiting.",
      "I hand the page four things: that first copy, a way to ask for a fresh copy, a way to send an ask, and a way to be told about changes.",
      "The page gets nothing else, so a bad script inside it cannot reach the rest of the computer.",
      "I do not keep the state. I pass the first copy through and after that I am only a set of pipes.",
    ],
  },

  mirror: {
    title: "This window's copy",
    file: "src/renderer/index.ts · the copy, not the page",
    plain:
      "I keep this window's copy of the state, show your change before the owner has answered, and put it right if the answer is no.",
    steps: [
      "You click. I show the result immediately and put the ask on a short waiting list.",
      "I send the ask to the owner.",
      "The owner says yes: the ask leaves the list, and what you already saw was right.",
      "The owner says no: the ask leaves the list, and the screen goes back to the official state.",
      "A change caused by the other window arrives: I take it, then put my own waiting guesses back on top.",
      "One message can answer several of my asks at once, and I retire all of them together.",
      "I only wake the parts of the page whose own piece of the state actually moved.",
      "Nothing in here draws anything. The page is a separate file that reads me.",
    ],
  },

  page: {
    title: "The app, in plain TypeScript",
    file: "example/index.html · example/renderer.ts",
    plain:
      "I am the part you can actually see: buttons, a number, a name box, and no framework anywhere.",
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
    plain:
      "I am the same app as the window on the left, written in React instead of by hand.",
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
    plain:
      "Every decision either side makes shows up here, in the order it actually happened.",
    steps: [
      "The owner reports every ask it got, every rule it ran, and everything it sent.",
      "Each window reports what it guessed, sent and received.",
      "All of it lands here with a timestamp.",
      "The times are real. At real speed a whole round trip is one or two milliseconds, far too fast to watch, so the dots are slowed down. Choose a delay and they move at the true speed instead.",
    ],
  },
};
