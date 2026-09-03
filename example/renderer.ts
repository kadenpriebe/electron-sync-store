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

  function render(state: AppState): void {
    count.textContent = String(state.count);
    user.textContent = state.user;
    if (document.activeElement !== userInput) {
      userInput.value = state.user;
    }
  }

  // A synchronous read on the first line of app code. No await anywhere in
  // this file, and no loading state — the value is already local.
  render(store.getState());

  store.subscribe(render);

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

  el("inc").addEventListener("click", () => send({ type: "increment" }));
  el("dec").addEventListener("click", () => send({ type: "decrement" }));
  userInput.addEventListener("input", () => send({ type: "set-user", user: userInput.value }));
}

start();
