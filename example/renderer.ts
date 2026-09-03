import { createRendererStore } from "../src/renderer";
import type { DemoBridge } from "./preload";
import { reducer, type AppAction, type AppState } from "./state";

declare global {
  interface Window {
    __demo: DemoBridge;
  }
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element: #${id}`);
  return node as T;
}

function start(): void {
  // The same reducer main runs. The mirror uses it to show the result of an
  // action before main has confirmed it.
  const store = createRendererStore<AppState, AppAction>(reducer, {
    // Report the mirror's decisions to the inspector. An app would omit this.
    trace: (event) => window.__demo.trace(event),
  });

  const count = el("count");
  const user = el("user");
  const userInput = el<HTMLInputElement>("user-input");
  const note = el("note");
  const countDraws = el("count-draws");
  const nameDraws = el("name-draws");

  function drawCount(value: number): void {
    count.textContent = String(value);
  }

  function drawName(value: string): void {
    user.textContent = value;
    if (document.activeElement !== userInput) {
      userInput.value = value;
    }
  }

  // A synchronous read on the first line of app code. No await anywhere in
  // this file, and no loading state — the value is already local.
  const first = store.getState();
  drawCount(first.count);
  drawName(first.user);

  // Two watchers, one per piece of the state, rather than one that redraws
  // everything. The counters next to them are the proof: type in the name box
  // and the count is not redrawn once.
  let countRedraws = 0;
  let nameRedraws = 0;

  store.subscribe(
    (state: AppState) => state.count,
    (value) => {
      drawCount(value);
      countRedraws += 1;
      countDraws.textContent = String(countRedraws);
    },
  );

  store.subscribe(
    (state: AppState) => state.user,
    (value) => {
      drawName(value);
      nameRedraws += 1;
      nameDraws.textContent = String(nameRedraws);
    },
  );

  // The page changes on the dispatch line itself. The promise is optional:
  // it says whether main agreed, and here it is used only to dim the number
  // while an answer is outstanding and to explain a rollback if one happens.
  let outstanding = 0;
  function send(action: AppAction): void {
    outstanding += 1;
    count.classList.add("unconfirmed");
    note.textContent = "";
    void store.dispatch(action).then((result) => {
      outstanding -= 1;
      if (outstanding === 0) count.classList.remove("unconfirmed");
      if (result.status === "rejected") note.textContent = `rolled back: ${result.reason}`;
    });
  }

  // The demo's load button: a pile of asks arriving at once, exactly as if a
  // real app were busy. Every one of them is an ordinary dispatch.
  window.__demo.onRush((each) => {
    for (let i = 0; i < each; i++) send({ type: "increment" });
  });

  el("inc").addEventListener("click", () => send({ type: "increment" }));
  el("dec").addEventListener("click", () => send({ type: "decrement" }));
  userInput.addEventListener("input", () => send({ type: "set-user", user: userInput.value }));
}

start();
